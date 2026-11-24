import csv
import hashlib
import json

import joblib
import numpy as np
import pandas as pd
import pytest

from ml.features import BASIC_FEATURES, FEATURE_NAMES, extract_features
from ml.model import ProductionModel
from ml.research_experiment import run_research_experiment


@pytest.fixture
def synthetic_partitions():
    # Individually reserved .example domains avoid external requests.
    rows = []
    for split in ("test", "train", "validation"):
        for number in range(12):
            label = number % 2
            scenario = ("biasa", "pendek", "merek")[(number // 2) % 3]
            domain = f"{split}{number}.example"
            url = f"HTTPS://{domain}/{'verify' if label else 'info'}/ü?token=private"
            rows.append({
                "url": url, "label": "phishing" if label else "benign",
                "split": split, "group": domain, "category": f"{scenario}_{label}",
                "row_id": hashlib.sha256(url.encode()).hexdigest(),
            })
    return pd.DataFrame(rows)


def test_research_preserves_splits_and_persists_real_outputs(synthetic_partitions, tmp_path, monkeypatch):
    data = synthetic_partitions
    summary = {"dataset_hash": "synthetic", "audit": {"passed": True}}
    progress = []
    report, bundle = run_research_experiment(
        data, summary, "synthetic.csv", cache_dir=tmp_path / "cache",
        features_dir=tmp_path / "features", models_dir=tmp_path / "models",
        progress=progress.append, experiment_id="synthetic-experiment",
    )
    assert report["split_seed"] is None
    assert report["split"]["test"]["rows"] == 12
    assert [result["configuration_id"] for result in report["results"]] == [f"E{i}" for i in range(1, 7)]
    test_ids = data.loc[data["split"] == "test", "row_id"].tolist()
    for result in report["results"]:
        assert [prediction["row_id"] for prediction in result["testing_predictions"]] == test_ids
        assert sum(map(sum, result["metrics"]["confusion_matrix"])) == len(test_ids)
        assert result["scenario_metrics"]["pendek"]["class_distribution"] == {"benign": 2, "phishing": 2}
        assert result["category_metrics"]["merek_0"]["roc_auc"] is None
        assert result["category_metrics"]["merek_0"]["undefined_reasons"]["roc_auc"] == "requires_both_labels"
        assert result["training_seconds"] > 0 and result["prediction_seconds"] > 0
        artifact = result["artifact"]
        assert hashlib.sha256((tmp_path / "models" / artifact["filename"]).read_bytes()).hexdigest() == artifact["sha256"]

    first = data.iloc[0]
    expected_features = extract_features(first["url"])["features"]
    for group, names in (("basic", BASIC_FEATURES), ("extended", FEATURE_NAMES)):
        with (tmp_path / "features" / f"features_{group}.csv").open(newline="") as source:
            reader = csv.DictReader(source)
            assert reader.fieldnames == ["row_id", "label", "split", *names]
            row = next(reader)
            assert row["split"] == first["split"] and row["row_id"] == first["row_id"]
            assert all(float(row[name]) == expected_features[name] for name in names)

    logistic = joblib.load(tmp_path / "models" / "E5.joblib")["model"]
    training_features = [extract_features(url)["features"] for url in data.loc[data["split"] == "train", "url"]]
    expected_mean = np.mean([[values[name] for name in BASIC_FEATURES] for values in training_features], axis=0)
    np.testing.assert_allclose(logistic.named_steps["standardscaler"].mean_, expected_mean)

    assert [update["processed"] for update in progress if update["stage"] == "features"] == [0, len(data)]
    encoded = json.dumps(report, allow_nan=False)
    assert "token=private" not in encoded
    assert not report["feature_extraction"]["cache_hit"]

    # Use the Random Forest extended artifact via the normal production verification path.
    rf = report["results"][1]["artifact"]
    (tmp_path / "production.joblib").write_bytes((tmp_path / "models" / rf["filename"]).read_bytes())
    info = {key: bundle[key] for key in ("version", "schema_version", "feature_names", "sklearn_version")}
    (tmp_path / "model_metadata.json").write_text(json.dumps({**info, "sha256": rf["sha256"]}))
    assert ProductionModel(tmp_path).predict(extract_features(first["url"]))["available"]

    def unexpected_extract(*args):
        pytest.fail("A structurally valid feature cache should avoid re-extraction.")

    monkeypatch.setattr("ml.research_experiment.extract_features", unexpected_extract)
    cached, _ = run_research_experiment(data, summary, cache_dir=tmp_path / "cache")
    assert cached["feature_extraction"]["cache_hit"]
    assert cached["results"][1]["testing_predictions"] == report["results"][1]["testing_predictions"]


def test_training_rejects_cross_partition_group_before_extraction(synthetic_partitions):
    synthetic_partitions.loc[0, "group"] = synthetic_partitions.loc[12, "group"]
    with pytest.raises(ValueError, match="multiple partitions"):
        run_research_experiment(synthetic_partitions, {"dataset_hash": "synthetic"})
