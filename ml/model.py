"""Bounded online experiments and checksum-verified, deploy-time production inference."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import uuid

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from ml.features import (extract_features, FEATURE_NAMES, BASIC_FEATURES, SCHEMA_VERSION, REFERENCES, KEYWORDS, SHORTENERS, mask_url)
from ml.evaluation import evaluate

ROOT = Path(__file__).resolve().parents[1]
SEED = 42
RF_CONFIG = {"n_estimators": 80, "max_depth": 16, "min_samples_split": 4, "min_samples_leaf": 2, "class_weight": "balanced", "random_state": SEED, "n_jobs": 1}


def split_dataset(df, seed=SEED):
    """Target 70/15/15 of groups, not rows. Require both classes per partition."""
    if len(df) < 30 or df["group"].nunique() < 10:
        raise ValueError("Training needs at least 30 unique URLs and 10 registered-domain groups with both labels spread across groups.")
    y = (df["label"] == "phishing").astype(int).to_numpy()
    if min(np.bincount(y, minlength=2)) < 6:
        raise ValueError("Each label needs at least 6 records for meaningful train/validation/test partitions.")
    for attempt in range(100):
        first = GroupShuffleSplit(n_splits=1, test_size=0.3, random_state=seed + attempt)
        train, held = next(first.split(df, y, df["group"]))
        second = GroupShuffleSplit(n_splits=1, test_size=0.5, random_state=seed + attempt)
        val_idx, test_idx = next(second.split(df.iloc[held], y[held], df.iloc[held]["group"]))
        val, test = held[val_idx], held[test_idx]
        if all(len(set(y[idx])) == 2 for idx in (train, val, test)):
            return train, val, test, y, seed + attempt
    raise ValueError("Could not create disjoint domain groups with both classes in every split. Add more independent domains per label.")


def run_experiment(df, summary, dataset_name="uploaded.csv", feature_sets=("extended",), timeout=35):
    began = time.monotonic()
    train, val, test, y, split_seed = split_dataset(df)
    features = [extract_features(u)["features"] for u in df["url"]]
    matrix = np.array([[row[k] for k in FEATURE_NAMES] for row in features], dtype=float)
    experiment_id = str(uuid.uuid4())
    reports = []
    production = None
    for feature_set in feature_sets:
        names = BASIC_FEATURES if feature_set == "basic" else FEATURE_NAMES
        columns = [FEATURE_NAMES.index(k) for k in names]
        x = matrix[:, columns]
        candidates = {
            "Random Forest": RandomForestClassifier(**RF_CONFIG),
            "Logistic Regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=1500, class_weight="balanced", random_state=SEED)),
            "Decision Tree": DecisionTreeClassifier(max_depth=16, min_samples_leaf=2, class_weight="balanced", random_state=SEED),
        }
        validation = {}
        for name, model in candidates.items():
            if time.monotonic() - began > timeout:
                raise ValueError("Experiment exceeded the online time budget. Use python -m ml.train_local.")
            model.fit(x[train], y[train])
            validation[name] = evaluate(y[val], model.predict(x[val]), model.predict_proba(x[val])[:, 1])
        # Selection is based solely on validation F1, never test performance.
        selected = max(validation, key=lambda key: validation[key]["f1"])
        for name, model in candidates.items():
            predicted = model.predict(x[test])
            scores = model.predict_proba(x[test])[:, 1]
            metrics = evaluate(y[test], predicted, scores)
            errors = [{"url": mask_url(df.iloc[int(idx)]["url"]), "actual": "phishing" if int(actual) else "benign",
                       "predicted": "phishing" if int(pred) else "benign", "type": "false_negative" if actual else "false_positive"}
                      for idx, actual, pred in zip(test, y[test], predicted) if actual != pred]
            importance = dict(zip(names, model.feature_importances_.tolist())) if hasattr(model, "feature_importances_") else None
            reports.append({"model_name": name, "feature_set": feature_set, "metrics": metrics,
                            "validation_metrics": validation[name], "selected_on_validation": name == selected,
                            "feature_importance": importance, "errors": errors, "test_count": len(test)})
        if feature_set == "extended":
            production = {"model": candidates["Random Forest"], "schema_version": SCHEMA_VERSION,
                          "feature_names": list(FEATURE_NAMES), "version": experiment_id, "sklearn_version": sklearn.__version__}
    partitions = {name: {"rows": len(idx), "groups": int(df.iloc[idx]["group"].nunique()),
                         "class_distribution": {"benign": int(sum(y[idx] == 0)), "phishing": int(sum(y[idx] == 1))}}
                  for name, idx in (("train", train), ("validation", val), ("test", test))}
    report = {"experiment_id": experiment_id, "dataset_name": Path(dataset_name).name[:150], "dataset_hash": summary["dataset_hash"],
              "model_version": experiment_id, "schema_version": SCHEMA_VERSION, "random_seed": SEED, "split_seed": split_seed,
              "evaluation_timestamp": datetime.now(timezone.utc).isoformat(), "split": partitions,
              "split_method": "Registered-domain GroupShuffleSplit; target group proportions 70/15/15; actual row counts reported.",
              "rf_configuration": RF_CONFIG, "feature_sets": list(feature_sets), "results": reports,
              "dataset_summary": summary, "references": list(REFERENCES), "keywords": list(KEYWORDS), "shorteners": sorted(SHORTENERS),
              "notes": ["Phishing is the positive class. PR-AUC uses average precision.",
                        "All comparisons share the same held-out test rows; selection uses validation F1 only.",
                        "Models are fit only on training rows; test is evaluated once per model and feature set.",
                        "Repeated experiments can overfit the holdout. Reserve an independent external test set for final research claims.",
                        "Online results never replace the production Random Forest."]}
    if time.monotonic() - began > timeout:
        raise ValueError("Experiment exceeded the time budget. Use local training; no successful experiment is reported.")
    return report, production


class ProductionModel:
    def __init__(self, directory=None):
        self.model = None
        self.metadata = {}
        self.reason = "Prediction unavailable — model not trained"
        folder = Path(directory) if directory else ROOT / "models"
        artifact, metadata = folder / "production.joblib", folder / "model_metadata.json"
        if not artifact.exists():
            return
        try:
            info = json.loads(metadata.read_text())
            if info.get("sha256") != hashlib.sha256(artifact.read_bytes()).hexdigest():
                raise ValueError("Artifact checksum mismatch")
            if info.get("schema_version") != SCHEMA_VERSION or info.get("feature_names") != list(FEATURE_NAMES) or info.get("sklearn_version") != sklearn.__version__:
                raise ValueError("Artifact metadata is incompatible")
            # Only this fixed deployment-owned path is deserialized. No upload API exists.
            bundle = joblib.load(artifact)
            if bundle["schema_version"] != SCHEMA_VERSION or bundle["feature_names"] != list(FEATURE_NAMES) or list(bundle["model"].classes_) != [0, 1] or bundle.get("version") != info.get("version") or not info.get("version") or bundle["model"].n_features_in_ != len(FEATURE_NAMES):
                raise ValueError("Artifact feature schema or classes mismatch")
            self.model, self.metadata = bundle["model"], info
            self.reason = None
        except Exception:
            self.reason = "Production model could not be verified; regenerate the trusted artifact."

    def predict(self, extraction):
        if self.model is None:
            return {"available": False, "prediction": None, "probability": None, "model_version": None, "reason": self.reason}
        x = np.array([[extraction["features"][k] for k in FEATURE_NAMES]])
        probability = float(self.model.predict_proba(x)[0, 1])
        return {"available": True, "prediction": "phishing" if int(self.model.predict(x)[0]) else "benign",
                "probability": probability, "probability_label": "Uncalibrated model estimate for phishing, not a safety guarantee",
                "model_version": self.metadata["version"], "feature_importance": dict(zip(FEATURE_NAMES, self.model.feature_importances_.tolist()))}
