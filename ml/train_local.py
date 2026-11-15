"""Train only on a user-supplied, provenance-checked labeled CSV."""
import argparse
import hashlib
import json
from pathlib import Path

import joblib
import sklearn

from ml.dataset import read_dataset
from ml.features import FEATURE_NAMES, SCHEMA_VERSION
from ml.model import run_experiment, ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "models")
    args = parser.parse_args()
    df, summary = read_dataset(args.dataset.read_bytes(), max_rows=None)
    report, bundle = run_experiment(df, summary, args.dataset.name, ("basic", "extended"), timeout=float("inf"))
    args.output.mkdir(parents=True, exist_ok=True)
    artifact = args.output / "production.joblib"
    joblib.dump(bundle, artifact)
    metadata = {"version": bundle["version"], "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
                "schema_version": SCHEMA_VERSION, "feature_names": list(FEATURE_NAMES), "sklearn_version": sklearn.__version__,
                "trained_at": report["evaluation_timestamp"], "dataset_hash": summary["dataset_hash"],
                "metrics": next(r["metrics"] for r in report["results"] if r["model_name"] == "Random Forest" and r["feature_set"] == "extended")}
    (args.output / "model_metadata.json").write_text(json.dumps(metadata, indent=2))
    (args.output / "experiment.json").write_text(json.dumps(report, indent=2))
    print(f"Trained a real Random Forest. Trusted artifact, checksum, and report written to {args.output}.")
    print("Review dataset provenance and held-out performance before deploying. Restart API after replacing artifacts.")


if __name__ == "__main__":
    main()
