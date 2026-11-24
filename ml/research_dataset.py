"""Local research CSV intake. URL and metadata handling here performs no network I/O."""

from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

import pandas as pd

from ml.dataset import normalize_label
from ml.features import MAX_RESEARCH_URL_LENGTH, PSL_VERSION, normalize_url, registered_domain, related_url_key, shortener_provider


PARTITIONS = ("train", "validation", "test")
CATEGORIES = tuple(f"{name}_{label}" for name in ("biasa", "pendek", "merek") for label in (0, 1))
MAX_RESEARCH_BYTES = 100 * 1024 * 1024
MAX_RESEARCH_ROWS = 1_000_000
SPLIT_NAMES = {
    "train": "train", "training": "train", "latih": "train", "pelatihan": "train",
    "val": "validation", "valid": "validation", "validation": "validation", "validasi": "validation",
    "test": "test", "testing": "test", "uji": "test", "pengujian": "test",
}
DOMAIN_FIELDS = ("registrable_domain", "domain_icann_audit")
URL_FIELDS = ("url_asli_pasangan", "url_tujuan_terverifikasi")
AUDIT_KEY_FIELDS = ("kelompok_audit", "url_key_audit")
STATUS_FIELDS = ("keputusan_audit", "status_kategori_audit", "status_redirect_audit", "status_pelatihan_final")
AUDIT_FIELDS = (*DOMAIN_FIELDS, *URL_FIELDS, *AUDIT_KEY_FIELDS, *STATUS_FIELDS)
OPTIONAL_FIELDS = ("split", "split_final", "kategori_audit", "scenario", "source", *AUDIT_FIELDS)
EMPTY_METADATA = {"", "-", "n/a", "na", "null", "none", "unknown", "tidak diketahui"}
INVALID_UTF8 = re.compile(r"[\udc80-\udcff]")


class ResearchDatasetError(ValueError):
    """A rejected intake, with a scoped and URL-free issue report."""

    def __init__(self, summary):
        highlights = ", ".join(dict.fromkeys(issue["code"] for issue in summary["issues"] if issue["severity"] == "error"))
        super().__init__(f"Validasi dataset penelitian gagal ({highlights}). Lihat validation-issues.csv.")
        self.summary = summary


class _DigestReader(io.RawIOBase):
    """Hash the same bytes the parser reads without loading a second copy."""

    def __init__(self, source):
        self.source = source
        self.digest = hashlib.sha256()
        self.size = 0

    def readable(self):
        return True

    def readinto(self, buffer):
        count = self.source.readinto(buffer)
        self.size += count
        if self.size > MAX_RESEARCH_BYTES:
            raise ValueError("file_size_limit")
        self.digest.update(memoryview(buffer)[:count])
        return count


def _issue(issues, code, file="dataset", row=None, row_id=None, severity="error"):
    issues.append({"code": code, "severity": severity, "file": file, "row": row, "row_id": row_id})


def _read_csv(path, role, issues):
    rows, empty, total = [], 0, 0
    digest = None
    line = 1
    reading_records = False
    try:
        with Path(path).open("rb") as raw:
            stream = _DigestReader(raw)
            # Identify invalid byte sequences at their CSV record, even during buffered reads.
            with io.TextIOWrapper(io.BufferedReader(stream), encoding="utf-8-sig", errors="surrogateescape", newline="") as file:
                reader = csv.reader(file, strict=True)
                header = next(reader, None)
                while header is not None and (not header or (len(header) == 1 and not header[0].strip())):
                    empty += 1
                    if empty > MAX_RESEARCH_ROWS:
                        raise ValueError("row_limit")
                    _issue(issues, "blank_record", role, reader.line_num, severity="info")
                    line = reader.line_num + 1
                    header = next(reader, None)
                if header is None:
                    _issue(issues, "missing_header", role)
                elif any(INVALID_UTF8.search(name) for name in header):
                    _issue(issues, "invalid_utf8_header", role, line)
                else:
                    header = [name.strip().lower() for name in header]
                    if len(set(header)) != len(header) or not {"url", "label"}.issubset(header):
                        _issue(issues, "invalid_header", role, line)
                    elif any(not name for name in header):
                        _issue(issues, "unnamed_header", role, line)
                    else:
                        reading_records = True
                        field_positions = [(i, key) for i, key in enumerate(header)
                                           if key in ("url", "label", *OPTIONAL_FIELDS)]
                        while True:
                            line = reader.line_num + 1
                            record = next(reader, None)
                            if record is None:
                                break
                            if not record or (len(record) == 1 and not record[0].strip()):
                                empty += 1
                                if total + empty > MAX_RESEARCH_ROWS:
                                    raise ValueError("row_limit")
                                _issue(issues, "blank_record", role, line, severity="info")
                                continue
                            total += 1
                            if total + empty > MAX_RESEARCH_ROWS:
                                raise ValueError("row_limit")
                            if any(INVALID_UTF8.search(cell) for cell in record):
                                _issue(issues, "invalid_utf8", role, line)
                                continue
                            if len(record) != len(header):
                                _issue(issues, "column_count", role, line)
                                continue
                            row = {name: record[i].strip() for i, name in field_positions}
                            row["row"] = line
                            rows.append(row)
                # Incomplete parsing does not produce a full-file fingerprint.
                if not file.read(1):
                    digest = stream.digest.hexdigest()
    except csv.Error:
        total += int(reading_records)
        _issue(issues, "malformed_csv" if reading_records else "malformed_header", role, line)
    except OSError:
        _issue(issues, "cannot_read_file", role)
    except ValueError as error:
        _issue(issues, str(error), role)
    if not rows and total == 0:
        _issue(issues, "no_records", role)
    return rows, {"total_records": total, "empty_records": empty, "dataset_hash": digest}


def _metadata(row, name):
    value = row.get(name, "")
    return "" if value.casefold() in EMPTY_METADATA else value


def _normalize(value):
    return normalize_url(value, max_length=MAX_RESEARCH_URL_LENGTH)


def _parse_row(raw, role, issues):
    url = raw["url"]
    row_id = hashlib.sha256(url.encode("utf-8")).hexdigest() if url else None
    label = normalize_label(raw["label"])
    if label is None:
        _issue(issues, "invalid_label", role, raw["row"], row_id)
    try:
        normalized_url = _normalize(url)
    except ValueError:
        _issue(issues, "invalid_url", role, raw["row"], row_id)
        return None
    if label is None:
        return None
    split_values = []
    for name in ("split", "split_final"):
        value = _metadata(raw, name)
        if value:
            match = SPLIT_NAMES.get(value.casefold())
            if match is None:
                _issue(issues, f"invalid_{name}", role, raw["row"], row_id)
            else:
                split_values.append(match)
    if len(set(split_values)) > 1:
        _issue(issues, "split_metadata_conflict", role, raw["row"], row_id)
    declared_category = _metadata(raw, "kategori_audit").casefold()
    scenario = _metadata(raw, "scenario").casefold()
    category = declared_category or scenario
    if declared_category in CATEGORIES and (
        (scenario in CATEGORIES and scenario != declared_category)
        or (scenario in ("biasa", "pendek", "merek") and not declared_category.startswith(f"{scenario}_"))
    ):
        _issue(issues, "scenario_category_conflict", role, raw["row"], row_id)
    if category in CATEGORIES and int(category[-1]) != int(label == "phishing"):
        _issue(issues, "category_label_conflict", role, raw["row"], row_id)
    if category not in CATEGORIES:
        if _metadata(raw, "kategori_audit"):
            _issue(issues, "unknown_category", role, raw["row"], row_id, "warning")
        category = None
    for field in ("status_pelatihan_final", "keputusan_audit"):
        value = re.sub(r"[\s_-]+", " ", _metadata(raw, field).casefold())
        if value in {"karantina", "quarantine", "cadangan", "reserve", "perlu review", "needs review", "excluded"}:
            _issue(issues, "excluded_by_metadata", role, raw["row"], row_id)
    parts = urlsplit(normalized_url)
    return {
        "row": raw["row"], "row_id": row_id, "url": url, "normalized_url": normalized_url, "label": label,
        "category": category, "source": _metadata(raw, "source") or None,
        "split": split_values[-1] if split_values else None,
        "registered_domain": registered_domain(parts.hostname), "shortener": shortener_provider(parts.hostname, parts.path),
        **{field: _metadata(raw, field) for field in AUDIT_FIELDS},
    }


def _merge_splits(rows, split_files, issues, hashes, counts):
    if set(split_files) != set(PARTITIONS):
        _issue(issues, "expected_all_three_split_files")
        return
    by_url = {row["url"]: row for row in rows}
    seen = set()
    for partition in PARTITIONS:
        raw_rows, stats = _read_csv(split_files[partition], partition, issues)
        hashes[partition] = stats["dataset_hash"]
        counts[partition] = {k: v for k, v in stats.items() if k != "dataset_hash"}
        for raw in raw_rows:
            candidate = _parse_row(raw, partition, issues)
            if candidate is None:
                continue
            row_id = candidate["row_id"]
            master = by_url.get(candidate["url"])
            if master is None:
                _issue(issues, "split_url_missing_from_master", partition, raw["row"], row_id)
                continue
            if candidate["label"] != master["label"]:
                _issue(issues, "split_label_differs_from_master", partition, raw["row"], row_id)
            if candidate["url"] in seen:
                _issue(issues, "duplicate_split_membership", partition, raw["row"], row_id)
                continue
            if candidate["split"] not in (None, partition) or master["split"] not in (None, partition):
                _issue(issues, "split_differs_from_master_or_filename", partition, raw["row"], row_id)
            master["split"] = partition
            seen.add(candidate["url"])
    for row in rows:
        if row["url"] not in seen:
            _issue(issues, "master_url_missing_from_splits", row=row["row"], row_id=row["row_id"])


def _audit_duplicates(rows, issues):
    exact = Counter(row["url"] for row in rows)
    normalized = defaultdict(list)
    for row in rows:
        normalized[row["normalized_url"]].append(row)
    duplicates, conflicts = 0, 0
    for members in normalized.values():
        if len(members) <= 1:
            continue
        duplicates += len(members) - 1
        conflict = len({row["label"] for row in members}) > 1
        conflicts += int(conflict)
        code = "conflicting_label" if conflict else "duplicate_normalized_url"
        for row in members:
            _issue(issues, code, row=row["row"], row_id=row["row_id"])
    return sum(n - 1 for n in exact.values()), duplicates, conflicts


def _relation_keys(row, issues):
    normalized = row["normalized_url"]
    yield ("exact_url", row["url"])
    yield ("normalized_url", normalized)
    yield ("related_url", related_url_key(normalized))
    yield ("domain", row["registered_domain"])
    for field in URL_FIELDS:
        if row[field]:
            try:
                link = _normalize(row[field])
            except ValueError:
                _issue(issues, f"invalid_{field}", row=row["row"], row_id=row["row_id"])
                continue
            yield ("normalized_url", link)
            yield ("related_url", related_url_key(link))
            yield ("domain", registered_domain(urlsplit(link).hostname))
    for field in DOMAIN_FIELDS:
        if row[field]:
            try:
                parts = urlsplit(_normalize(f"https://{row[field]}"))
                if parts.path != "/" or parts.query or parts.fragment or parts.port:
                    raise ValueError("Expected hostname.")
            except ValueError:
                _issue(issues, f"invalid_{field}", row=row["row"], row_id=row["row_id"])
                continue
            yield ("domain", parts.hostname)
    for field in AUDIT_KEY_FIELDS:
        if row[field]:
            yield (field, row[field])


def _audit_groups(rows, issues):
    parent = list(range(len(rows)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    memberships = defaultdict(list)
    for i, row in enumerate(rows):
        for key in dict.fromkeys(_relation_keys(row, issues)):
            members = memberships[key]
            if members:
                first, current = root(members[0]), root(i)
                parent[max(first, current)] = min(first, current)
            members.append(i)

    overlaps = Counter(dict.fromkeys(("exact_url", "normalized_url", "related_url", "domain", *AUDIT_KEY_FIELDS, "group"), 0))
    for (relation, _), members in memberships.items():
        if len({rows[i]["split"] for i in members if rows[i]["split"]}) > 1:
            overlaps[relation] += 1

    components = defaultdict(list)
    for i, row in enumerate(rows):
        components[root(i)].append(row)
    for members in components.values():
        group = min(row["row_id"] for row in members)
        crossed = len({row["split"] for row in members if row["split"]}) > 1
        overlaps["group"] += int(crossed)
        for row in members:
            row["group"] = group
            if crossed:
                _issue(issues, "cross_split_related_group", row=row["row"], row_id=row["row_id"])
    return dict(overlaps), len(components)


def read_research_dataset(dataset: Path, split_files: dict[str, Path] | None = None) -> tuple[pd.DataFrame, dict]:
    """Audit a selected CSV and optional complete split files, before feature extraction."""
    issues = []
    raw_rows, stats = _read_csv(dataset, "dataset", issues)
    rows = [row for raw in raw_rows if (row := _parse_row(raw, "dataset", issues)) is not None]
    del raw_rows
    hashes = {"dataset": stats["dataset_hash"]}
    counts = {"dataset": {k: v for k, v in stats.items() if k != "dataset_hash"}}
    split_source = "grouped"
    if split_files is not None:
        split_source = "files"
        _merge_splits(rows, split_files, issues, hashes, counts)
    elif any(row["split"] for row in rows):
        split_source = "metadata"
        for row in rows:
            if row["split"] is None:
                _issue(issues, "missing_metadata_split", row=row["row"], row_id=row["row_id"])
    split_distribution = {}
    if split_source != "grouped":
        split_distribution = dict.fromkeys(PARTITIONS, 0)
        for row in rows:
            if row["split"] is not None:
                split_distribution[row["split"]] += 1
        for partition, count in split_distribution.items():
            if count == 0:
                _issue(issues, "empty_partition", partition)

    exact, duplicates, conflicts = _audit_duplicates(rows, issues)
    overlaps, group_count = _audit_groups(rows, issues)
    errors = [item for item in issues if item["severity"] == "error"]
    non_record_codes = {"malformed_header", "invalid_header", "invalid_utf8_header", "unnamed_header"}
    invalid = {item["row"] for item in errors
               if item["file"] == "dataset" and item["row"] is not None and item["code"] not in non_record_codes}
    valid_rows = [row for row in rows if row["row"] not in invalid]
    class_counts = Counter(row["label"] for row in valid_rows)
    dataset_id = None
    if all(hashes.values()):
        dataset_id = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode("utf-8")).hexdigest()
    summary = {
        **stats,
        "dataset_id": dataset_id,
        "input_hashes": hashes,
        "input_counts": counts,
        "valid_records": len(valid_rows),
        "invalid_records": len(invalid),
        "unique_records": len(rows) - duplicates,
        "exact_duplicate_records": exact,
        "duplicate_records": duplicates,
        "conflicting_labels": conflicts,
        "class_distribution": {key: class_counts[key] for key in ("benign", "phishing")},
        "category_distribution": dict(Counter(row["category"] or "unknown" for row in valid_rows)),
        "source_distribution": dict(Counter(row["source"] for row in valid_rows if row["source"])),
        "shortener_distribution": dict(Counter(row["shortener"] for row in valid_rows if row["shortener"])),
        "split_distribution": split_distribution,
        "domain_groups": group_count,
        "split_source": split_source,
        "issues": issues,
        "audit": {
            "passed": not errors,
            "psl_version": PSL_VERSION,
            "preassigned_splits_checked": split_source != "grouped",
            "cross_split_conflicts": overlaps,
            "coverage": {field: sum(bool(row[field]) for row in rows) for field in AUDIT_FIELDS},
            "limitations": [
                "Audit hubungan memakai snapshot PSL lokal dengan bagian private dan tautan yang tercatat dalam CSV.",
                "Domain layanan pemendek ikut dikelompokkan. Domain ICANN dari metadata dapat menghubungkan domain tambahan.",
                "Redirect yang belum diketahui, kemiripan konten, dan validitas label historis belum diverifikasi.",
                "Metadata sumber, kategori dan audit hanya untuk pengelompokan dan pelaporan.",
            ],
        },
    }
    if errors:
        raise ResearchDatasetError(summary)
    return pd.DataFrame(rows), summary
