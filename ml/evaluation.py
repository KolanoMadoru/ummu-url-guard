"""Metrics consistently use phishing=1 and benign=0."""
import numpy as np
from sklearn.metrics import (accuracy_score, precision_score, recall_score, f1_score,
    confusion_matrix, roc_auc_score, average_precision_score, roc_curve, precision_recall_curve)


def evaluate(y, predicted, scores) -> dict:
    result = {
        "accuracy": float(accuracy_score(y, predicted)),
        "precision": float(precision_score(y, predicted, zero_division=0)),
        "recall": float(recall_score(y, predicted, zero_division=0)),
        "f1": float(f1_score(y, predicted, zero_division=0)),
        "confusion_matrix": confusion_matrix(y, predicted, labels=[0, 1]).tolist(),
        "confusion_labels": ["benign", "phishing"],
        "positive_class": "phishing",
        "class_distribution": {"benign": int(np.sum(np.asarray(y) == 0)), "phishing": int(np.sum(np.asarray(y) == 1))},
        "roc_auc": None, "pr_auc": None, "roc_curve": None, "pr_curve": None,
    }
    if len(set(y)) == 2:
        result["roc_auc"] = float(roc_auc_score(y, scores))
        # Average precision is the non-interpolated area summary, explicitly labeled.
        result["pr_auc"] = float(average_precision_score(y, scores))
        fpr, tpr, _ = roc_curve(y, scores)
        precision, recall, _ = precision_recall_curve(y, scores)
        result["roc_curve"] = {"x": fpr.tolist(), "y": tpr.tolist()}
        result["pr_curve"] = {"x": recall.tolist(), "y": precision.tolist()}
    return result
