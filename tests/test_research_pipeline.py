"""Exercise the public pipeline with synthetic, offline-only research inputs."""

import csv
import json
from zipfile import ZIP_DEFLATED, ZipFile

from ml.model import ProductionModel
from ml.research_pipeline import MASTER, SPLITS, main


def package_fixture(path, *, mismatched=False):
    rows = []
    for split in SPLITS:
        for scenario in ("biasa", "pendek", "merek"):
            for label in (0, 1):
                url = f"https://{split}-{scenario}-{label}.example/path?note=a,b"
                rows.append((url, label, split, f"{scenario}_{label}"))
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        master = "url,label,split_final,kategori_audit,source\n" + "".join(
            f'"{url}",{label},{split},{category},Synthetic fixture\n' for url, label, split, category in rows
        )
        archive.writestr(f"embedded/{MASTER}", master.encode("utf-8-sig"))
        for split in SPLITS:
            data = "url,label\n" + "".join(
                f'"{url}",{1 - label if mismatched and split == "test" else label}\n'
                for url, label, partition, _ in rows if partition == split
            )
            archive.writestr(f"embedded/{split.upper()}.csv", data)
        archive.writestr("../../04_KARANTINA_DAN_PERLU_REVIEW.csv", "not valid CSV")


def test_research_zip_reaches_deployable_model_and_private_reports(tmp_path):
    source, output = tmp_path / "package.zip", tmp_path / "runs"
    package_fixture(source)
    assert main([str(source), "--output", str(output), "--dataset-version", "synthetic-v1"]) == 0
    runs = [path for path in output.iterdir() if not path.name.startswith(".")]
    assert len(runs) == 1
    run = runs[0]
    assert json.loads((run / "status.json").read_text())["status"] == "completed"
    results = run / "results"
    summary_path = results / "research-summary.json"
    summary = json.loads(summary_path.read_text())
    assert summary["split_method"] == "predefined"
    assert summary["rows"] == 18
    assert summary["split"]["test"] == {"rows": 6, "benign": 3, "phishing": 3}
    assert summary["categories"]["merek_1"] == 3
    assert len(summary["results"]) == 6
    assert summary["results"][1]["scenarios"]["pendek"]["rows"] == 2
    assert "https://" not in summary_path.read_text()
    assert ProductionModel(results / "deployment-model").model is not None
    assert len(list((results / "models").glob("*.joblib"))) == 6
    with (results / "metrics.csv").open() as stream:
        assert len(list(csv.DictReader(stream))) == 24


def test_invalid_split_keeps_audit_and_prevents_training(tmp_path):
    source, output = tmp_path / "package.zip", tmp_path / "runs"
    package_fixture(source, mismatched=True)
    assert main([str(source), "--output", str(output)]) == 1
    run, = output.iterdir()
    assert (run / "audit.json").is_file()
    assert (run / "validation-issues.csv").is_file()
    assert json.loads((run / "status.json").read_text())["status"] == "failed"
    assert not (run / "results").exists()


def test_zip_rejects_ambiguous_master_names(tmp_path):
    source, output = tmp_path / "package.zip", tmp_path / "runs"
    package_fixture(source)
    with ZipFile(source, "a") as archive:
        archive.writestr(f"other/{MASTER}", "url,label\n")
    assert main([str(source), "--output", str(output), "--audit-only"]) == 1
    assert not (tmp_path / MASTER).exists()
