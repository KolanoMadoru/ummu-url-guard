"""Bounded, stateless training on lexical feature batches supplied by the browser."""

from datetime import datetime, timezone
import hashlib
import platform
import time

import numpy as np
import sklearn

from ml.features import FEATURE_NAMES, MAX_RESEARCH_URL_LENGTH, SCHEMA_VERSION
from ml.model import SEED, model_candidates
from ml.research_experiment import CONFIGURATIONS, FEATURE_SETS, _metrics, _model_parameters, _prediction

MATRIX_DTYPE = np.dtype("<f4")
BYTES_PER_ROW = len(FEATURE_NAMES) * MATRIX_DTYPE.itemsize + 3
MAX_BROWSER_TRAINING_ROWS = 50_000
MAX_BROWSER_TRAINING_BYTES = MAX_BROWSER_TRAINING_ROWS * BYTES_PER_ROW
WEB_FOREST_MAX_LEAVES = 64
CURVE_MAX_POINTS = 512
SHORT_LINK = 1
BRAND_SIMILARITY = 2
DOCUMENTED_FAILED_RESOLUTION = 4
CONFIGURATION_BY_ID = {
    configuration_id: (model_name, feature_set)
    for configuration_id, model_name, feature_set in CONFIGURATIONS
}


def _decode_batch(body):
    """Decode the feature matrix, then the label, split, and scenario byte columns."""
    rows, remainder = divmod(len(body), BYTES_PER_ROW)
    if remainder or not 0 < rows <= MAX_BROWSER_TRAINING_ROWS:
        raise ValueError("Ukuran batch fitur tidak valid atau melebihi 50.000 baris.")

    items = rows * len(FEATURE_NAMES)
    matrix = np.frombuffer(body, dtype=MATRIX_DTYPE, count=items).reshape(rows, len(FEATURE_NAMES))
    labels, splits, scenarios = np.frombuffer(
        body, dtype=np.uint8, offset=items * MATRIX_DTYPE.itemsize
    ).reshape(3, rows)
    if not np.isfinite(matrix).all() or matrix.min() < 0 or matrix.max() > MAX_RESEARCH_URL_LENGTH:
        raise ValueError("Batch fitur berisi nilai numerik di luar batas fitur leksikal.")
    if labels.max() > 1 or splits.max() > 2 or scenarios.max() > 7:
        raise ValueError("Label, partisi, atau penanda skenario tidak valid.")
    if np.any(((scenarios & DOCUMENTED_FAILED_RESOLUTION) != 0) & ((scenarios & SHORT_LINK) == 0)):
        raise ValueError("Kegagalan resolusi hanya berlaku pada penanda skenario URL pendek.")

    partitions = tuple(np.flatnonzero(splits == code) for code in (0, 1, 2))
    if any(len(np.unique(labels[indices])) != 2 for indices in partitions):
        raise ValueError("Partisi pelatihan, validasi, dan pengujian masing-masing harus memiliki kedua kelas.")
    return matrix, labels, partitions, scenarios


def _display_metrics(actual, predicted, scores):
    result = _metrics(actual, predicted, scores)
    if result is None:
        return None
    # Only the graph view is sampled. All scalar metrics use every row.
    for key in ("roc_curve", "pr_curve"):
        curve = result[key]
        if curve and len(curve["x"]) > CURVE_MAX_POINTS:
            samples = np.linspace(0, len(curve["x"]) - 1, CURVE_MAX_POINTS, dtype=int)
            result[key] = {axis: [values[index] for index in samples] for axis, values in curve.items()}
    return result


def _portable_forest(model, names):
    trees = []
    for estimator in model.estimators_:
        tree = estimator.tree_
        nodes = []
        for position, child_left in enumerate(tree.children_left):
            if child_left == -1:
                weights = tree.value[position, 0]
                nodes.append([-1, float(weights[1] / weights.sum()), 0, 0])
            else:
                nodes.append([
                    int(tree.feature[position]),
                    float(tree.threshold[position]),
                    int(child_left),
                    int(tree.children_right[position]),
                ])
        trees.append(nodes)
    return {
        "schema": "ummu-random-forest-v1",
        "schema_version": SCHEMA_VERSION,
        "feature_names": list(names),
        "classes": [0, 1],
        "trees": trees,
    }


def train_browser_experiment(configuration_id: str, body: bytes) -> dict:
    """Fit one fixed configuration from a numeric feature batch."""
    if configuration_id not in CONFIGURATION_BY_ID:
        raise ValueError("Konfigurasi eksperimen harus E1 hingga E6.")
    matrix, labels, (train, validation, test), flags = _decode_batch(body)
    model_name, feature_set = CONFIGURATION_BY_ID[configuration_id]
    model = model_candidates()[model_name]
    if model_name == "Random Forest":
        # Keep the same fixed budget for the 7- and 19-feature forests.
        model.set_params(max_leaf_nodes=WEB_FOREST_MAX_LEAVES)
    names = FEATURE_SETS[feature_set]
    features = matrix[:, [FEATURE_NAMES.index(name) for name in names]] if feature_set == "basic" else matrix

    start = time.monotonic()
    model.fit(features[train], labels[train])
    training_seconds = time.monotonic() - start
    val_predictions, val_scores, validation_seconds = _prediction(model, features[validation])
    predictions, scores, prediction_seconds = _prediction(model, features[test])
    actual, scenario = labels[test], flags[test]
    is_shortened = (scenario & SHORT_LINK) != 0
    masks = {"biasa": ~is_shortened, "pendek": is_shortened, "merek": (scenario & BRAND_SIMILARITY) != 0}
    result = {
        "configuration_id": configuration_id,
        "model_name": model_name,
        "feature_set": feature_set,
        "feature_names": list(names),
        "schema_version": SCHEMA_VERSION,
        "matrix_sha256": hashlib.sha256(body).hexdigest(),
        "random_seed": SEED,
        "dependency_versions": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scikit-learn": sklearn.__version__,
        },
        "evaluation_timestamp": datetime.now(timezone.utc).isoformat(),
        "hyperparameters": _model_parameters(model),
        "train_count": len(train),
        "validation_count": len(validation),
        "test_count": len(test),
        "training_seconds": training_seconds,
        "validation_prediction_seconds": validation_seconds,
        "prediction_seconds": prediction_seconds,
        "curve_max_points": CURVE_MAX_POINTS,
        "metrics": _display_metrics(actual, predictions, scores),
        "validation_metrics": _display_metrics(labels[validation], val_predictions, val_scores),
        "scenario_metrics": {
            name: _display_metrics(actual[mask], predictions[mask], scores[mask])
            for name, mask in masks.items()
        },
        "test_predictions": list(zip(predictions.tolist(), scores.tolist(), strict=True)),
        "feature_importance": (
            dict(zip(names, model.feature_importances_.tolist(), strict=True))
            if hasattr(model, "feature_importances_") else None
        ),
    }
    if configuration_id == "E2":
        result["model"] = _portable_forest(model, names)
    if configuration_id == "E1":
        failed = (flags & DOCUMENTED_FAILED_RESOLUTION) != 0
        failed_train, failed_validation, failed_test = (failed[split] for split in (train, validation, test))
        # Require evidence from both classes in each partition. Use the existing
        # E1 predictions so the failure subset never changes model fitting.
        if all(len(np.unique(labels[split][mask])) == 2 for split, mask in (
            (train, failed_train), (validation, failed_validation), (test, failed_test)
        )):
            result["fallback"] = {
                "basis": "url_awal",
                "training_rows": int(failed_train.sum()),
                "validation": _display_metrics(
                    labels[validation][failed_validation], val_predictions[failed_validation], val_scores[failed_validation]
                ),
                "testing": _display_metrics(actual[failed_test], predictions[failed_test], scores[failed_test]),
            }
            result["model"] = _portable_forest(model, names)
    return result
