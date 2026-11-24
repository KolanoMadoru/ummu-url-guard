"""Audit and train on private research files outside the Vercel request path."""

import argparse
from contextlib import contextmanager
import csv
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
import uuid
from zipfile import BadZipFile, ZipFile

import joblib
import sklearn

from ml.features import FEATURE_NAMES, REFERENCE_VERSION, SCHEMA_VERSION, SHORTENER_VERSION
from ml.research_dataset import ResearchDatasetError, read_research_dataset
from ml.research_experiment import run_research_experiment


SPLITS = ("train", "validation", "test")
MASTER = "01_MASTER_EKSPERIMEN_METADATA.csv"
PACKAGE_LIMIT = 128 * 1024 * 1024
MEMBER_LIMIT = 64 * 1024 * 1024
ISSUE_FIELDS = ("code", "severity", "file", "row", "row_id")
METRIC_FIELDS = ("rows", "accuracy", "precision", "recall", "f1", "specificity", "false_positive_rate",
                 "false_negative_rate", "roc_auc", "pr_auc", "confusion_matrix")


@contextmanager
def research_inputs(dataset, split_files):
    if dataset.suffix.lower() != ".zip":
        yield dataset, split_files
        return
    if split_files:
        raise ValueError("Paket ZIP sudah membawa berkas split. Pilih salah satu metode impor.")
    # Copy only explicitly recognized files. ZIP paths never become local paths.
    required = (MASTER, *(f"{name.upper()}.csv" for name in SPLITS))
    if dataset.stat().st_size > PACKAGE_LIMIT:
        raise ValueError("Ukuran paket penelitian melebihi 128 MiB.")
    with ZipFile(dataset) as archive, tempfile.TemporaryDirectory(prefix="ummu-research-") as temporary:
        files = {}
        for member in archive.infolist():
            name = PurePosixPath(member.filename).name
            if member.is_dir() or name not in required:
                continue
            if name in files:
                raise ValueError(f"Paket berisi nama berkas ganda: {name}")
            files[name] = member
        missing = set(required) - files.keys()
        if missing:
            raise ValueError(f"Berkas paket tidak lengkap: {', '.join(sorted(missing))}")
        if (any(member.file_size > MEMBER_LIMIT or member.flag_bits & 1 for member in files.values())
                or sum(member.file_size for member in files.values()) > PACKAGE_LIMIT):
            raise ValueError("Berkas penelitian terenkripsi atau melebihi batas ukuran ekstraksi.")
        directory = Path(temporary)
        for name, member in files.items():
            with archive.open(member) as source, (directory / name).open("xb") as target:
                shutil.copyfileobj(source, target)
        yield directory / MASTER, {name: directory / f"{name.upper()}.csv" for name in SPLITS}


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def write_audit(directory, summary):
    write_json(directory / "audit.json", summary)
    with (directory / "validation-issues.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=ISSUE_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(summary.get("issues", []))


def browser_summary(report, summary, dataset_version):
    """Publish a compact subset whose fields contain no URLs or row-level research data."""
    audit = summary["audit"]
    source_counts = sorted(summary["source_distribution"].items(), key=lambda entry: (-entry[1], entry[0]))
    sources = dict([(name, count) for name, count in source_counts
                   if re.fullmatch(r"[^\W_][\w .+&()\[\]-]{0,79}", name)][:100])
    split = {
        name: {"rows": part["rows"], **part["class_distribution"]}
        for name, part in report["split"].items()
    }
    def compact_metrics(metrics):
        if metrics is None:
            return None
        return {
            **{name: metrics.get(name) for name in METRIC_FIELDS},
            **metrics["class_distribution"],
        }

    results = [
        {
            "id": result["configuration_id"],
            "model_name": result["model_name"],
            "feature_set": result["feature_set"],
            "train_seconds": result["training_seconds"],
            "prediction_seconds": result["prediction_seconds"],
            "metrics": compact_metrics(result["metrics"]),
            "scenarios": {name: compact_metrics(metrics) for name, metrics in result["scenario_metrics"].items()},
            "feature_importance": result["feature_importance"],
            "shortener_scenarios": {name: compact_metrics(metrics)
                                    for name, metrics in result.get("shortener_metrics", {}).items()},
        }
        for result in report["results"]
    ]
    return {
        "schema": "ummu-research-summary-v1",
        "experiment_id": report["experiment_id"],
        "dataset_hash": summary["dataset_hash"],
        "dataset_version": dataset_version,
        "feature_schema": SCHEMA_VERSION,
        "brand_reference_version": REFERENCE_VERSION,
        "shortener_registry_version": SHORTENER_VERSION,
        "psl_version": audit["psl_version"],
        "evaluation_timestamp": report["evaluation_timestamp"],
        "selected_configuration_id": report["selected_configuration_id"],
        "split_method": "grouped" if summary["split_source"] == "grouped" else "predefined",
        "rows": sum(part["rows"] for part in split.values()),
        "split": split,
        "categories": summary["category_distribution"],
        "sources": sources,
        "shorteners": report.get("shortener_distribution", {}),
        "audit": {
            "status": "passed",
            "metadata": any(audit["coverage"].values()),
            "checks": audit["cross_split_conflicts"],
            "coverage": audit["coverage"],
        },
        "results": results,
    }


def write_metrics(path, results):
    keys = ("accuracy", "precision", "recall", "f1", "specificity", "false_positive_rate",
            "false_negative_rate", "roc_auc", "pr_auc")
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("experiment", "model", "features", "subset", "training_seconds", "prediction_seconds", *keys))
        for result in results:
            subsets = {"global": result["metrics"], **result["scenarios"]}
            for subset, metrics in subsets.items():
                if metrics is not None:
                    writer.writerow((result["id"], result["model_name"], result["feature_set"], subset,
                                     result["train_seconds"], result["prediction_seconds"],
                                     *(metrics.get(key) for key in keys)))


def print_progress(progress):
    suffix = f" ({progress['configuration_id']})" if "configuration_id" in progress else ""
    print(f"{progress['stage']}{suffix}: {progress['processed']}/{progress['total']} ({progress['percentage']:.1f}%) — "
          f"{progress['successful']} berhasil, {progress['failed']} gagal, "
          f"{progress['elapsed_seconds']:.1f} dtk", file=sys.stderr, flush=True)


def run(args):
    experiment_id = str(uuid.uuid4())
    args.output.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory = args.output / experiment_id
    directory.mkdir(mode=0o700)
    status = "failed"
    try:
        split_files = {name: getattr(args, name) for name in SPLITS if getattr(args, name)}
        with research_inputs(args.dataset, split_files) as (dataset, files):
            try:
                frame, summary = read_research_dataset(dataset, files or None)
            except ResearchDatasetError as error:
                write_audit(directory, error.summary)
                raise
        write_audit(directory, summary)
        if args.audit_only:
            status = "audited"
            return directory
        cache = args.output / ".feature-cache"
        cache.mkdir(mode=0o700, exist_ok=True)
        # Keep the audit even when training fails. Publish results as a complete directory.
        with tempfile.TemporaryDirectory(prefix=".stage-", dir=directory) as staging:
            stage = Path(staging) / "results"
            stage.mkdir(mode=0o700)
            try:
                report, production = run_research_experiment(
                    frame, summary, args.dataset.name, cache_dir=cache, progress=print_progress,
                    features_dir=stage / "features", models_dir=stage / "models", experiment_id=experiment_id,
                )
            except ValueError:
                if (failed_features := stage / "features" / "feature_failures.csv").is_file():
                    shutil.copyfile(failed_features, directory / "feature-failures.csv")
                raise
            report["dataset_version"] = args.dataset_version
            write_json(stage / "experiment.json", report)
            compact = browser_summary(report, summary, args.dataset_version)
            write_json(stage / "research-summary.json", compact)
            write_metrics(stage / "metrics.csv", compact["results"])

            deployment = stage / "deployment-model"
            deployment.mkdir()
            artifact = deployment / "production.joblib"
            joblib.dump(production, artifact, compress=3)
            with artifact.open("rb") as stream:
                checksum = hashlib.file_digest(stream, "sha256").hexdigest()
            deployed = next(result for result in compact["results"] if result["id"] == "E2")
            write_json(deployment / "model_metadata.json", {
                "version": production["version"],
                "sha256": checksum,
                "schema_version": SCHEMA_VERSION,
                "feature_names": list(FEATURE_NAMES),
                "sklearn_version": sklearn.__version__,
                "trained_at": report["evaluation_timestamp"],
                "dataset_hash": summary["dataset_hash"],
                "dataset_version": args.dataset_version,
                "metrics": deployed["metrics"],
            })
            stage.rename(directory / "results")
        status = "completed"
        return directory
    finally:
        write_json(directory / "status.json", {"experiment_id": experiment_id, "status": status})
        print(f"Laporan penelitian: {directory}", file=sys.stderr)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path, help="CSV sederhana, CSV master, atau paket ZIP penelitian.")
    for name in SPLITS:
        parser.add_argument(f"--{name}", type=Path)
    parser.add_argument("--output", type=Path, default=Path(".research-runs"))
    parser.add_argument("--dataset-version", default="unversioned")
    parser.add_argument("--audit-only", action="store_true")
    args = parser.parse_args(argv)
    if 0 < sum(bool(getattr(args, name)) for name in SPLITS) < len(SPLITS):
        parser.error("--train, --validation, dan --test harus diberikan bersama.")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,59}", args.dataset_version):
        parser.error("--dataset-version harus berupa pengenal singkat tanpa spasi.")
    try:
        run(args)
    except (ValueError, OSError, BadZipFile, NotImplementedError, RuntimeError) as error:
        print(f"Pipeline gagal: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
