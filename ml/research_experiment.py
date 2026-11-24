"""Offline, auditable training with an explicit held-out evaluation."""
from collections import Counter
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile
import time
import uuid
from zipfile import BadZipFile

import idna
import joblib
import numpy as np
import pandas as pd
import scipy
import sklearn

from ml.evaluation import evaluate
from ml.features import (
    BASIC_FEATURES,
    FEATURE_NAMES,
    KEYWORDS,
    PSL_VERSION,
    REFERENCES,
    REFERENCE_VERSION,
    SCHEMA_VERSION,
    SHORTENERS,
    SHORTENER_VERSION,
    extract_features,
    mask_url,
)
from ml.model import RF_CONFIG, SEED, model_candidates, production_bundle, split_dataset

PARTITIONS = ("train", "validation", "test")
FEATURE_SETS = {"basic": BASIC_FEATURES, "extended": FEATURE_NAMES}
CONFIGURATIONS = (
    ("E1", "Random Forest", "basic"),
    ("E2", "Random Forest", "extended"),
    ("E3", "Decision Tree", "basic"),
    ("E4", "Decision Tree", "extended"),
    ("E5", "Logistic Regression", "basic"),
    ("E6", "Logistic Regression", "extended"),
)
SCENARIOS = ("biasa", "pendek", "merek")
CATEGORIES = tuple(f"{scenario}_{label}" for scenario in SCENARIOS for label in (0, 1))
MIN_SHORTENER_TEST_ROWS = 20


def _partitions(df):
    if "split" not in df or df["split"].isna().all():
        train, val, test, labels, seed = split_dataset(df)
        method = "Pembagian kelompok terkait dengan sasaran 70/15/15. Proporsi baris mengikuti ukuran kelompok."
        return (train, val, test), labels, seed, method

    if not df["split"].isin(PARTITIONS).all():
        raise ValueError("Every record must have an audited train, validation, or test assignment.")
    groups = df.groupby("group")["split"].nunique()
    if groups.gt(1).any():
        raise ValueError("Audited split assigns related groups to multiple partitions.")
    labels = df["label"].eq("phishing").astype(int).to_numpy()
    partitions = tuple(np.flatnonzero(df["split"].eq(name)) for name in PARTITIONS)
    if any(len(set(labels[indices])) != 2 for indices in partitions):
        raise ValueError("Train, validation, and test must each contain both labels.")
    return partitions, labels, None, "Pembagian yang diaudit dipertahankan tanpa pengacakan ulang."


def _notify(callback, stage, processed, total, started, failed=0, **extra):
    if callback:
        callback({
            "stage": stage,
            "processed": processed,
            "total": total,
            "percentage": 100 * processed / total,
            "successful": processed - failed,
            "failed": failed,
            "elapsed_seconds": time.monotonic() - started,
            **extra,
        })


def _cache_path(directory, urls, dataset_id):
    provenance = (
        dataset_id, SCHEMA_VERSION, PSL_VERSION, REFERENCE_VERSION, SHORTENER_VERSION,
        idna.__version__, FEATURE_NAMES,
    )
    digest = hashlib.sha256(json.dumps(provenance).encode())
    for url in urls:
        # Valid URLs never contain newlines, so ordered records are unambiguous.
        digest.update(b"\n")
        digest.update(url.encode())
    return Path(directory) / f"{digest.hexdigest()}.npz"


def _extract(df, row_ids, dataset_id, cache_dir, features_dir, progress):
    started = time.monotonic()
    urls = df["url"].tolist()
    shape = (len(urls), len(FEATURE_NAMES))
    path = _cache_path(cache_dir, urls, dataset_id) if cache_dir is not None else None
    _notify(progress, "features", 0, len(urls), started)
    if path is not None and path.is_file():
        try:
            with np.load(path, allow_pickle=False) as cache:
                matrix, providers = cache["matrix"], cache["providers"]
            if (
                matrix.shape == shape
                and matrix.dtype == np.float64
                and np.isfinite(matrix).all()
                and providers.shape == (len(urls),)
                and providers.dtype.kind == "U"
                and set(providers) <= (SHORTENERS | {""})
            ):
                _notify(progress, "features", len(urls), len(urls), started, cached=True)
                return matrix, providers, time.monotonic() - started, True
        except (OSError, BadZipFile, EOFError, KeyError, TypeError, ValueError):
            # Rebuild an incomplete or incompatible numeric checkpoint.
            pass

    matrix = np.empty(shape, dtype=float)
    providers = []
    failures = []
    for pos, url in enumerate(urls):
        try:
            extracted = extract_features(url)
            values = [extracted["features"][name] for name in FEATURE_NAMES]
            if not np.isfinite(values).all():
                raise ValueError("Feature result is not finite.")
            matrix[pos] = values
            providers.append(extracted["shortener_provider"] or "")
        except (ValueError, TypeError, ArithmeticError):
            failures.append(row_ids[pos])
        finished = pos + 1
        if finished % 250 == 0 or finished == len(urls):
            _notify(progress, "features", finished, len(urls), started, len(failures), cached=False)
    if failures:
        if features_dir is not None:
            features_dir = Path(features_dir)
            features_dir.mkdir(parents=True, exist_ok=True)
            with (features_dir / "feature_failures.csv").open("w", encoding="utf-8", newline="") as out:
                writer = csv.writer(out)
                writer.writerow(("row_id", "reason"))
                writer.writerows((row_id, "invalid_feature_vector") for row_id in failures)
        raise ValueError(f"Feature extraction failed for {len(failures)} records. No model was trained.")

    providers = np.asarray(providers, dtype=str)
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(dir=path.parent, prefix=".features-", delete=False) as temp:
            temp_path = Path(temp.name)
            try:
                np.savez_compressed(temp, matrix=matrix, providers=providers)
                temp.close()
                temp_path.replace(path)
            finally:
                temp_path.unlink(missing_ok=True)
    return matrix, providers, time.monotonic() - started, False


def _export_features(directory, matrices, row_ids, labels, partitions):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    split_names = np.empty(len(labels), dtype="<U10")
    for name, indices in zip(PARTITIONS, partitions, strict=True):
        split_names[indices] = name
    for group, names in FEATURE_SETS.items():
        with (directory / f"features_{group}.csv").open("w", encoding="utf-8", newline="") as out:
            writer = csv.writer(out)
            writer.writerow(("row_id", "label", "split", *names))
            for row_id, label, split, row in zip(row_ids, labels, split_names, matrices[group], strict=True):
                writer.writerow((row_id, label, split, *row))


def _metrics(actual, predicted, scores):
    if not len(actual):
        return None
    metrics = evaluate(actual, predicted, scores)
    (tn, fp), (fn, tp) = metrics["confusion_matrix"]
    negatives, positives = tn + fp, fn + tp
    metrics["rows"] = len(actual)
    metrics["specificity"] = tn / negatives if negatives else None
    metrics["false_positive_rate"] = fp / negatives if negatives else None
    metrics["false_negative_rate"] = fn / positives if positives else None
    unavailable = {}
    if not negatives:
        unavailable.update(specificity="no_actual_negatives", false_positive_rate="no_actual_negatives")
    if not positives:
        unavailable.update(recall="no_actual_positives", false_negative_rate="no_actual_positives")
    if not (tp + fp):
        unavailable["precision"] = "no_predicted_positives"
    if not (tp + fp + fn):
        unavailable["f1"] = "no_actual_or_predicted_positives"
    if not negatives or not positives:
        unavailable.update(roc_auc="requires_both_labels", pr_auc="requires_both_labels")
    metrics.update({metric: None for metric in unavailable})
    metrics["undefined_reasons"] = unavailable
    return metrics


def _prediction(model, features):
    began = time.monotonic()
    actual_predictions = model.predict(features)
    probs = model.predict_proba(features)[:, 1]
    return actual_predictions, probs, time.monotonic() - began


def _model_parameters(model):
    if hasattr(model, "steps"):
        return {name: step.get_params(deep=False) for name, step in model.steps}
    return model.get_params(deep=False)


def _persist_model(directory, configuration_id, model, feature_set, experiment_id):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{configuration_id}.joblib"
    joblib.dump({
        "model": model,
        "schema_version": SCHEMA_VERSION,
        "feature_names": list(FEATURE_SETS[feature_set]),
        "version": experiment_id,
        "sklearn_version": sklearn.__version__,
    }, path, compress=3)
    with path.open("rb") as artifact:
        digest = hashlib.file_digest(artifact, "sha256").hexdigest()
    return {"filename": path.name, "sha256": digest}


def run_research_experiment(
    df,
    summary,
    dataset_name="uploaded.csv",
    *,
    cache_dir=None,
    features_dir=None,
    models_dir=None,
    progress=None,
    experiment_id=None,
):
    """Train six configurations solely on training records and reuse their audited partitions."""
    if summary.get("audit", {}).get("passed") is False:
        raise ValueError("The dataset failed its audit and cannot be used for training.")
    if not df["label"].isin(("benign", "phishing")).all() or df["group"].isna().any():
        raise ValueError("Every record needs an unambiguous binary label and group.")
    experiment_id = experiment_id or str(uuid.uuid4())
    partitions, labels, split_seed, split_method = _partitions(df)
    train, validation, test = partitions
    row_ids = (
        df["row_id"].tolist() if "row_id" in df else
        [hashlib.sha256(url.encode()).hexdigest() for url in df["url"]]
    )
    if len(set(row_ids)) != len(row_ids):
        raise ValueError("Duplicate record IDs must be resolved before training.")
    dataset_id = summary.get("dataset_id") or summary["dataset_hash"]
    matrix, providers, feature_seconds, cache_hit = _extract(
        df, row_ids, dataset_id, cache_dir, features_dir, progress
    )
    matrices = {
        "basic": matrix[:, [FEATURE_NAMES.index(name) for name in BASIC_FEATURES]],
        "extended": matrix,
    }
    if features_dir is not None:
        _export_features(features_dir, matrices, row_ids, labels, partitions)

    # Complete all fitting and validation comparison before reading any test metrics.
    candidates = {feature_set: model_candidates() for feature_set in FEATURE_SETS}
    results = []
    began = time.monotonic()
    _notify(progress, "train", 0, len(CONFIGURATIONS), began)
    for index, (configuration_id, name, feature_set) in enumerate(CONFIGURATIONS, 1):
        x = matrices[feature_set]
        model = candidates[feature_set][name]
        fit_started = time.monotonic()
        model.fit(x[train], labels[train])
        training_seconds = time.monotonic() - fit_started
        predicted, scores, validation_seconds = _prediction(model, x[validation])
        results.append({
            "configuration_id": configuration_id,
            "model_name": name,
            "feature_set": feature_set,
            "feature_names": list(FEATURE_SETS[feature_set]),
            "hyperparameters": _model_parameters(model),
            "training_seconds": training_seconds,
            "validation_prediction_seconds": validation_seconds,
            "validation_metrics": _metrics(labels[validation], predicted, scores),
        })
        _notify(progress, "train", index, len(CONFIGURATIONS), began, configuration_id=configuration_id)
    selected = max(results, key=lambda result: result["validation_metrics"]["f1"])
    selected_by_set = {
        key: max(
            (r for r in results if r["feature_set"] == key),
            key=lambda r: r["validation_metrics"]["f1"],
        )["configuration_id"]
        for key in FEATURE_SETS
    }

    actual = labels[test]
    test_providers = providers[test]
    categories = (
        df.iloc[test]["category"].fillna("").to_numpy(dtype=str) if "category" in df else
        np.full(len(test), "")
    )
    masks = {key: categories == key for key in CATEGORIES}
    test_ids = [row_ids[index] for index in test]
    masked_urls = [mask_url(url) for url in df.iloc[test]["url"]]
    provider_masks = {provider: test_providers == provider for provider in sorted(set(test_providers) - {""})}
    began = time.monotonic()
    _notify(progress, "evaluate", 0, len(results), began)
    for index, result in enumerate(results, 1):
        configuration_id, feature_set = result["configuration_id"], result["feature_set"]
        model = candidates[feature_set][result["model_name"]]
        predicted, scores, prediction_seconds = _prediction(model, matrices[feature_set][test])

        def subset_metrics(mask):
            return _metrics(actual[mask], predicted[mask], scores[mask])

        errors, predictions = [], []
        for row_id, url, truth, prediction, score, category, provider in zip(
            test_ids, masked_urls, actual, predicted, scores, categories, test_providers, strict=True
        ):
            predictions.append({
                "row_id": row_id,
                "actual": int(truth),
                "predicted": int(prediction),
                "phishing_score": float(score),
                "category": category or None,
                "shortener_provider": provider or None,
            })
            if truth != prediction:
                errors.append({
                    "row_id": row_id,
                    "url": url,
                    "actual": "phishing" if truth else "benign",
                    "predicted": "phishing" if prediction else "benign",
                    "type": "false_negative" if truth else "false_positive",
                })
        result.update({
            "metrics": _metrics(actual, predicted, scores),
            "selected_on_validation": configuration_id == selected_by_set[feature_set],
            "prediction_seconds": prediction_seconds,
            "test_count": len(test),
            "feature_importance": (
                dict(zip(FEATURE_SETS[feature_set], model.feature_importances_.tolist(), strict=True))
                if hasattr(model, "feature_importances_") else None
            ),
            "errors": errors,
            "testing_predictions": predictions,
            "category_metrics": {key: subset_metrics(mask) for key, mask in masks.items()},
            "scenario_metrics": {
                scenario: subset_metrics(masks[f"{scenario}_0"] | masks[f"{scenario}_1"])
                for scenario in SCENARIOS
            },
            "shortener_metrics": {
                key: subset_metrics(mask) for key, mask in provider_masks.items()
                if mask.sum() >= MIN_SHORTENER_TEST_ROWS and len(set(actual[mask])) == 2
            },
        })
        if models_dir is not None:
            result["artifact"] = _persist_model(models_dir, configuration_id, model, feature_set, experiment_id)
        _notify(progress, "evaluate", index, len(results), began, configuration_id=configuration_id)

    report = {
        "experiment_id": experiment_id,
        "model_version": experiment_id,
        "dataset_name": Path(dataset_name).name[:150],
        "dataset_id": dataset_id,
        "dataset_hash": summary["dataset_hash"],
        "schema_version": SCHEMA_VERSION,
        "reference_version": REFERENCE_VERSION,
        "shortener_version": SHORTENER_VERSION,
        "psl_version": PSL_VERSION,
        "random_seed": SEED,
        "split_seed": split_seed,
        "split_method": split_method,
        "evaluation_timestamp": datetime.now(timezone.utc).isoformat(),
        "split": {
            name: {
                "rows": len(indices),
                "groups": int(df.iloc[indices]["group"].nunique()),
                "class_distribution": {
                    "benign": int(np.sum(labels[indices] == 0)),
                    "phishing": int(np.sum(labels[indices] == 1)),
                },
            }
            for name, indices in zip(PARTITIONS, partitions, strict=True)
        },
        "rf_configuration": RF_CONFIG,
        "feature_sets": list(FEATURE_SETS),
        "feature_extraction": {
            "processed": len(df),
            "successful": len(df),
            "failed": 0,
            "elapsed_seconds": feature_seconds,
            "cache_hit": cache_hit,
        },
        "selected_configuration_id": selected["configuration_id"],
        "results": results,
        "dataset_summary": summary,
        "references": list(REFERENCES),
        "keywords": list(KEYWORDS),
        "shorteners": sorted(SHORTENERS),
        "test_category_rows": {key: int(mask.sum()) for key, mask in masks.items()},
        "test_rows_without_category": int(np.sum(~np.isin(categories, CATEGORIES))),
        "shortener_test_rows": {key: int(mask.sum()) for key, mask in provider_masks.items()},
        "shortener_distribution": dict(sorted(Counter(provider for provider in providers if provider).items())),
        "minimum_shortener_test_rows": MIN_SHORTENER_TEST_ROWS,
        "dependency_versions": {
            "python": sys.version.split()[0],
            "idna": idna.__version__,
            "joblib": joblib.__version__,
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "scikit-learn": sklearn.__version__,
            "scipy": scipy.__version__,
        },
        "notes": [
            "Kelas positif adalah phishing. Skor phishing merupakan estimasi yang belum dikalibrasi.",
            "Seluruh model dilatih pada partisi training. Konfigurasi dipilih berdasarkan F1 validasi, dengan ID konfigurasi terendah saat seri.",
            "Waktu prediksi mencakup penghitungan kelas dan skor phishing.",
            "Metrik skenario hanya mencakup baris test dengan metadata kategori yang tersedia.",
            "Evaluasi per layanan pemendek memerlukan minimal 20 tautan uji dan kedua kelas.",
            "Hubungan redirect historis dan kemiripan konten yang belum diketahui berada di luar cakupan audit.",
            "Penggunaan berulang partisi uji yang sama dapat menimbulkan bias. Simpan data uji eksternal untuk kesimpulan akhir.",
        ],
    }
    return report, production_bundle(candidates["extended"]["Random Forest"], experiment_id)
