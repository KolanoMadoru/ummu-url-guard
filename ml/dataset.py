import csv
import hashlib
import io
import re

import pandas as pd

from ml.features import normalize_url, registered_domain, mask_url
from urllib.parse import urlsplit

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
LABELS = {"phishing": "phishing", "benign": "benign", "1": "phishing", "0": "benign"}
RESEARCH_METADATA_COLUMNS = frozenset({
    "split", "split_final", "scenario", "kategori_audit", "source",
    "registrable_domain", "url_asli_pasangan", "url_tujuan_terverifikasi",
    "domain_icann_audit", "url_key_audit", "kelompok_audit", "keputusan_audit",
    "status_kategori_audit", "status_redirect_audit", "status_pelatihan_final",
})


def normalize_label(value: str) -> str | None:
    token = value.strip().lower()
    numeric = re.fullmatch(r"([01])\.0+", token)
    return LABELS.get(numeric[1] if numeric else token)


def read_dataset(content: bytes, max_rows: int | None = MAX_ROWS) -> tuple[pd.DataFrame, dict]:
    if not content:
        raise ValueError("Dataset is empty.")
    if max_rows is not None and len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("CSV exceeds the 2 MiB online upload limit; use local training.")
    header = None
    rows = []
    blank_rows = 0
    try:
        # Text only; never evaluate strings or deserialize uploaded models.
        decoded = content.decode("utf-8-sig", errors="strict")
        for record_number, row in enumerate(csv.reader(io.StringIO(decoded, newline=""), strict=True), 1):
            if not row or (len(row) == 1 and not row[0].strip()):
                blank_rows += 1
                continue
            if header is None:
                header = [name.strip().lower() for name in row]
                if "" in header or len(set(header)) != len(header) or not {"url", "label"}.issubset(header):
                    raise ValueError("CSV must contain distinct url,label columns and at least one row.")
                url_index, label_index = header.index("url"), header.index("label")
                continue
            if len(row) != len(header):
                raise ValueError(f"Malformed CSV on record {record_number}: field count differs from the header.")
            if max_rows is not None and len(rows) == max_rows:
                raise ValueError(f"Online datasets are limited to {max_rows} rows; use the local script.")
            rows.append((row[url_index].strip(), row[label_index].strip(), record_number))
    except (UnicodeError, csv.Error):
        raise ValueError("Invalid CSV. Use UTF-8 text with url,label columns.") from None
    if not rows:
        raise ValueError("CSV must contain url,label columns and at least one row.")
    df = pd.DataFrame(rows, columns=["url", "label", "record_number"])
    missing = int(((df["url"] == "") | (df["label"] == "")).sum())
    if missing:
        raise ValueError(f"Dataset has {missing} rows with missing URL or label; clean it before upload.")
    df["label"] = df["label"].map(normalize_label)
    if df["label"].isna().any():
        raise ValueError("Labels must be phishing/benign (or 1/0, respectively).")
    normalized = []
    for row in df.itertuples():
        try:
            normalized.append(normalize_url(row.url))
        except ValueError:
            raise ValueError(f"Invalid URL on CSV row {row.record_number}; URL values are not logged.") from None
    df["normalized_url"] = normalized
    conflicts = df.groupby("normalized_url")["label"].nunique().gt(1).sum()
    if conflicts:
        raise ValueError(f"Conflicting labels for {conflicts} identical normalized URLs.")
    duplicates = int(df.duplicated("normalized_url").sum())
    total = len(df)
    df = df.drop_duplicates("normalized_url").drop(columns="record_number").reset_index(drop=True)
    df["group"] = df["normalized_url"].map(lambda u: registered_domain(urlsplit(u).hostname))
    has_research_metadata = bool(RESEARCH_METADATA_COLUMNS.intersection(header))
    summary = {"total_records": total, "unique_records": len(df), "missing_values": missing,
               "blank_rows_ignored": blank_rows, "has_research_metadata": has_research_metadata,
               "duplicate_records": duplicates, "conflicting_labels": 0, "domain_groups": int(df["group"].nunique()),
               "class_distribution": {k: int((df["label"] == k).sum()) for k in ("benign", "phishing")},
               "dataset_hash": hashlib.sha256(content).hexdigest(),
               "preview": [{"url": mask_url(r.url), "label": r.label} for r in df.head(10).itertuples()],
               "storage": "Processed for this request only; not stored permanently.",
               "validation": "Valid basic fields; research metadata requires the local audited pipeline."
               if has_research_metadata else "Valid; exact normalized duplicates removed."}
    return df, summary
