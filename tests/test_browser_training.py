"""Use only synthetic numeric features to exercise the stateless training transport."""
import hashlib
import json

import numpy as np
import pytest

from ml.browser_training import (
    MAX_BROWSER_TRAINING_BYTES,
    WEB_FOREST_MAX_LEAVES,
    train_browser_experiment,
)
from ml.features import BASIC_FEATURES, FEATURE_NAMES, SCHEMA_VERSION


def pack(matrix, labels, splits, scenarios):
    return b"".join((
        np.asarray(matrix, dtype="<f4").tobytes(),
        np.asarray(labels, dtype=np.uint8).tobytes(),
        np.asarray(splits, dtype=np.uint8).tobytes(),
        np.asarray(scenarios, dtype=np.uint8).tobytes(),
    ))


@pytest.fixture
def batch():
    rows = 120
    index = np.arange(rows)
    labels = (index // 3) % 2
    splits = index % 3
    flags = (index // 4) % 4
    matrix = np.random.default_rng(42).uniform(0, 1, (rows, len(FEATURE_NAMES))).astype(np.float32)
    matrix[:, 0] += labels
    return matrix, labels, splits, flags


def predict_forest(model, row):
    scores = []
    for tree in model["trees"]:
        node = 0
        while True:
            feature, threshold, left, right = tree[node]
            if feature == -1:
                scores.append(threshold)
                break
            node = left if float(row[feature]) <= threshold else right
    return sum(scores) / len(scores)


def test_stateless_random_forest_uses_test_order_and_valid_portable_nodes(batch):
    payload = pack(*batch)
    result = train_browser_experiment("E2", payload)
    assert result["configuration_id"] == "E2"
    assert result["feature_names"] == list(FEATURE_NAMES)
    assert result["schema_version"] == SCHEMA_VERSION
    assert result["matrix_sha256"] == hashlib.sha256(payload).hexdigest()
    assert result["hyperparameters"]["max_leaf_nodes"] == WEB_FOREST_MAX_LEAVES
    assert result["training_seconds"] > 0
    serialized = json.dumps(result, allow_nan=False)
    assert len(serialized.encode()) < MAX_BROWSER_TRAINING_BYTES

    model = result["model"]
    assert model["schema"] == "ummu-random-forest-v1"
    assert model["classes"] == [0, 1]
    assert len(model["trees"]) == result["hyperparameters"]["n_estimators"]
    assert all(len(tree) <= 2 * WEB_FOREST_MAX_LEAVES - 1 for tree in model["trees"])
    matrix, labels, splits, flags = batch
    test = splits == 2
    expected_scores = np.array([predict_forest(model, row) for row in matrix[test]])
    predicted, scored = np.asarray(result["test_predictions"]).T
    np.testing.assert_allclose(scored, expected_scores, rtol=0, atol=1e-12)
    np.testing.assert_array_equal(predicted, expected_scores > 0.5)
    assert result["metrics"]["accuracy"] == pytest.approx(np.mean(predicted == labels[test]))
    assert result["metrics"]["rows"] == result["test_count"] == len(predicted)
    assert result["scenario_metrics"]["biasa"]["rows"] == int(np.sum((flags[test] & 1) == 0))
    assert result["scenario_metrics"]["pendek"]["rows"] == int(np.sum((flags[test] & 1) != 0))
    assert result["scenario_metrics"]["merek"]["rows"] == int(np.sum((flags[test] & 2) != 0))


@pytest.mark.parametrize(("configuration_id", "name", "names"), [
    ("E1", "Random Forest", BASIC_FEATURES),
    ("E3", "Decision Tree", BASIC_FEATURES),
    ("E4", "Decision Tree", FEATURE_NAMES),
    ("E5", "Logistic Regression", BASIC_FEATURES),
    ("E6", "Logistic Regression", FEATURE_NAMES),
])
def test_other_configurations_return_comparison_metrics_only(batch, configuration_id, name, names):
    result = train_browser_experiment(configuration_id, pack(*batch))
    assert result["model_name"] == name
    assert result["feature_names"] == list(names)
    assert "model" not in result
    assert result["validation_metrics"]["roc_auc"] is not None


def test_test_labels_do_not_change_training_or_validation_metrics(batch):
    matrix, labels, splits, flags = batch
    original = train_browser_experiment("E6", pack(*batch))
    modified_labels = np.where(splits == 2, 1 - labels, labels)
    changed = train_browser_experiment("E6", pack(matrix, modified_labels, splits, flags))
    assert original["test_predictions"] == changed["test_predictions"]
    assert original["validation_metrics"] == changed["validation_metrics"]
    assert original["metrics"]["confusion_matrix"] != changed["metrics"]["confusion_matrix"]


def test_scenario_metrics_report_unavailable_values(batch):
    matrix, labels, splits, _ = batch
    flags = np.where(labels == 0, 1, 0)
    result = train_browser_experiment("E4", pack(matrix, labels, splits, flags))
    shortener = result["scenario_metrics"]["pendek"]
    assert shortener["class_distribution"]["phishing"] == 0
    assert shortener["roc_auc"] is None
    assert shortener["undefined_reasons"]["roc_auc"] == "requires_both_labels"
    assert result["scenario_metrics"]["merek"] is None


def test_invalid_batches_rejected_before_training(batch):
    matrix, labels, splits, flags = batch
    with pytest.raises(ValueError, match="E1 hingga E6"):
        train_browser_experiment("E7", pack(*batch))
    with pytest.raises(ValueError, match="Ukuran batch"):
        train_browser_experiment("E2", pack(*batch)[:-1])
    with pytest.raises(ValueError, match="Ukuran batch"):
        train_browser_experiment("E2", bytes(MAX_BROWSER_TRAINING_BYTES + 79))
    with pytest.raises(ValueError, match="Label, partisi"):
        train_browser_experiment("E2", pack(matrix, labels + 1, splits, flags))
    with pytest.raises(ValueError, match="Label, partisi"):
        train_browser_experiment("E2", pack(matrix, labels, splits + 1, flags))
    with pytest.raises(ValueError, match="penanda skenario"):
        train_browser_experiment("E2", pack(matrix, labels, splits, flags + 4))
    with pytest.raises(ValueError, match="kedua kelas"):
        train_browser_experiment("E2", pack(matrix, labels, np.minimum(splits, 1), flags))
    matrix[0, 0] = np.nan
    with pytest.raises(ValueError, match="nilai numerik"):
        train_browser_experiment("E2", pack(*batch))
