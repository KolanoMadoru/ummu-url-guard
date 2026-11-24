import csv
import hashlib

import pytest

from ml.research_dataset import ResearchDatasetError, read_research_dataset


def write_csv(path, header, rows, encoding="utf-8"):
    with path.open("w", newline="", encoding=encoding) as stream:
        writer = csv.writer(stream)
        writer.writerow(header)
        writer.writerows(rows)
    return path


def error_codes(error):
    return {issue["code"] for issue in error.value.summary["issues"]}


def test_simple_bom_csv_keeps_original_url_and_counts_blank_records(tmp_path):
    path = tmp_path / "simple.csv"
    original = "HTTP://Bücher.example:80/Case?key=a,b#first"
    write_csv(path, ("url", "label"), [(original, "0.0"), (), ("https://other.example/", "1.00")], encoding="utf-8-sig")
    frame, summary = read_research_dataset(path)
    assert list(frame["url"]) == [original, "https://other.example/"]
    assert frame.iloc[0]["normalized_url"] == "http://xn--bcher-kva.example/Case?key=a,b#first"
    assert frame.iloc[0]["row_id"] == hashlib.sha256(original.encode()).hexdigest()
    assert summary["dataset_hash"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert summary["split_source"] == "grouped"
    assert frame["split"].isna().all()
    assert summary["class_distribution"] == {"benign": 1, "phishing": 1}
    assert summary["category_distribution"] == {"unknown": 2}
    assert summary["empty_records"] == 1
    assert summary["valid_records"] == 2
    assert summary["audit"]["preassigned_splits_checked"] is False
    assert summary["issues"] == [{"code": "blank_record", "severity": "info", "file": "dataset", "row": 3, "row_id": None}]


def test_large_synthetic_master_keeps_all_rows_categories_and_partitions(tmp_path):
    columns = ["url", "label", "split", "split_final", "kategori_audit", "source"]
    columns += [f"audit_extra_{i}" for i in range(47)]
    rows = (
        (f"https://site{i}.example/Path?code={i}", i % 2, split, split, f"biasa_{i % 2}", "Fixture",
         *("synthetic metadata" for _ in range(47)))
        for i, split in enumerate(["train"] * 13233 + ["validation"] * 2753 + ["test"] * 2736)
    )
    path = write_csv(tmp_path / "synthetic-master.csv", columns, rows)
    assert path.stat().st_size > 8 * 1024 * 1024
    frame, summary = read_research_dataset(path)
    assert len(frame) == summary["valid_records"] == summary["unique_records"] == 18_722
    assert summary["class_distribution"] == {"benign": 9361, "phishing": 9361}
    assert summary["split_distribution"] == {"train": 13233, "validation": 2753, "test": 2736}
    assert summary["category_distribution"] == {"biasa_0": 9361, "biasa_1": 9361}
    assert summary["source_distribution"] == {"Fixture": 18722}
    assert summary["audit"]["preassigned_splits_checked"] is True
    assert summary["audit"]["passed"]
    assert not any(summary["audit"]["cross_split_conflicts"].values())


def test_separate_splits_match_master_exactly(tmp_path):
    train, val, test = "https://train.example/", "https://val.example/", "https://test.example/"
    master = write_csv(tmp_path / "master.csv", ("url", "label", "scenario", "split_final"),
                       [(train, 0, "biasa_0", ""), (val, 1, "merek_1", "validasi"), (test, 1, "pendek_1", "")])
    split_files = {
        name: write_csv(tmp_path / (name + ".csv"), ("url", "label"), [(url, label)])
        for name, url, label in [("train", train, 0), ("validation", val, 1), ("test", test, 1)]
    }
    frame, summary = read_research_dataset(master, split_files)
    assert list(frame["split"]) == ["train", "validation", "test"]
    assert list(frame["category"]) == ["biasa_0", "merek_1", "pendek_1"]
    assert summary["split_source"] == "files"
    assert summary["dataset_id"] != summary["dataset_hash"]
    assert set(summary["input_hashes"]) == {"dataset", "train", "validation", "test"}

    write_csv(split_files["test"], ("url", "label"), [(train, 1), (val.upper(), 1)])
    with pytest.raises(ResearchDatasetError) as error:
        read_research_dataset(master, split_files)
    assert {
        "split_url_missing_from_master", "split_label_differs_from_master",
        "duplicate_split_membership", "master_url_missing_from_splits",
    }.issubset(error_codes(error))


def test_split_conflicts_and_label_conflicts_report_all_affected_rows(tmp_path):
    dataset = write_csv(tmp_path / "master.csv", ("url", "label", "split", "split_final"), [
        ("https://same.example", 0, "train", "test"),
        ("https://SAME.example/", 1, "validation", "validation"),
        ("https://unknown.example/", 0, "", ""),
        ("https://invalidlabel.example/", "2", "test", "test"),
        ("", 1, "test", "test"),
    ])
    with pytest.raises(ResearchDatasetError) as error:
        read_research_dataset(dataset)
    summary = error.value.summary
    assert {"split_metadata_conflict", "conflicting_label", "missing_metadata_split",
            "invalid_label", "invalid_url"}.issubset(error_codes(error))
    assert summary["conflicting_labels"] == 1
    assert summary["duplicate_records"] == 1
    assert summary["valid_records"] == 0
    assert summary["invalid_records"] == 5
    assert summary["audit"]["cross_split_conflicts"]["normalized_url"] == 1
    assert all("https://" not in str(item) for item in summary["issues"])


def test_known_scenario_and_category_conflict_is_not_silently_ignored(tmp_path):
    dataset = write_csv(tmp_path / "master.csv", ("url", "label", "scenario", "kategori_audit"), [
        ("https://example.com", 0, "pendek", "biasa_0"),
        ("https://example.org", 1, "biasa_0", "biasa_1"),
        ("https://example.net", 1, "unrecognized fixture metadata", "merek_1"),
    ])
    with pytest.raises(ResearchDatasetError) as error:
        read_research_dataset(dataset)
    summary = error.value.summary
    assert {issue["row"] for issue in summary["issues"] if issue["code"] == "scenario_category_conflict"} == {2, 3}
    assert summary["invalid_records"] == 2
    assert summary["category_distribution"] == {"merek_1": 1}


def test_transitive_grouping_uses_audited_pairs_destinations_and_group_keys(tmp_path):
    columns = ("url", "label", "split", "url_asli_pasangan", "url_tujuan_terverifikasi", "kelompok_audit")
    rows = [
        ("http://www.primary.example/Path?q=%7e#one", 0, "train", "", "", "bridge"),
        ("https://other.example/x", 1, "validation", "https://primary.example/Path?q=~", "", ""),
        ("https://third.example/", 1, "test", "", "https://other.example/x", ""),
        ("https://fourth.example/", 0, "train", "", "", "bridge"),
    ]
    path = write_csv(tmp_path / "metadata.csv", columns, rows)
    with pytest.raises(ResearchDatasetError) as error:
        read_research_dataset(path)
    audit = error.value.summary["audit"]
    assert audit["cross_split_conflicts"]["normalized_url"] == 1
    assert audit["cross_split_conflicts"]["related_url"] == 2
    assert audit["cross_split_conflicts"]["domain"] == 1
    assert audit["cross_split_conflicts"]["group"] == 1
    assert {issue["row"] for issue in error.value.summary["issues"] if issue["code"] == "cross_split_related_group"} == {2, 3, 4, 5}

    write_csv(path, columns, [(url, label, "", *edges) for url, label, _, *edges in rows])
    frame, summary = read_research_dataset(path)
    assert len(frame["group"].unique()) == 1
    assert summary["audit"]["coverage"]["url_asli_pasangan"] == 1
    assert summary["audit"]["coverage"]["url_tujuan_terverifikasi"] == 1


@pytest.mark.parametrize(("content", "code"), [
    (b"url,label\nhttps://example.com,\xff", "invalid_utf8"),
    (b"url,label\n\"https://example.com,0", "malformed_csv"),
    (b"url,label,label\nhttps://example.com,0,0", "invalid_header"),
    (b"url,label\nhttps://example.com,0,extra", "column_count"),
    (b"url,label,status_pelatihan_final\nhttps://example.com,0,karantina", "excluded_by_metadata"),
])
def test_rejects_invalid_csv_or_explicit_quarantine(tmp_path, content, code):
    path = tmp_path / "raw.csv"
    path.write_bytes(content)
    with pytest.raises(ResearchDatasetError) as error:
        read_research_dataset(path)
    assert code in error_codes(error)
    summary = error.value.summary
    if code != "invalid_header":
        assert next(issue for issue in summary["issues"] if issue["code"] == code)["row"] == 2
        assert summary["invalid_records"] == summary["total_records"] == 1
