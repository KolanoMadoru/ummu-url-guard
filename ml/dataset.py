import hashlib
import io

import pandas as pd

from ml.features import normalize_url, registered_domain, mask_url
from urllib.parse import urlsplit

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
LABELS = {"phishing": "phishing", "benign": "benign", "1": "phishing", "0": "benign"}


def read_dataset(content: bytes, max_rows: int | None = MAX_ROWS) -> tuple[pd.DataFrame, dict]:
    if not content:
        raise ValueError("Dataset is empty.")
    if max_rows is not None and len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("CSV exceeds the 2 MiB online upload limit; use local training.")
    try:
        # Text only; never evaluate strings or deserialize uploaded models.
        decoded = content.decode("utf-8-sig", errors="strict")
        df = pd.read_csv(io.StringIO(decoded), dtype=str, keep_default_na=False, nrows=(max_rows + 1) if max_rows else None)
    except (UnicodeError, pd.errors.ParserError, pd.errors.EmptyDataError, ValueError):
        raise ValueError("Invalid CSV. Use UTF-8 text with url,label columns.") from None
    if max_rows and len(df) > max_rows:
        raise ValueError(f"Online datasets are limited to {max_rows} rows; use the local script.")
    if not {"url", "label"}.issubset(df.columns) or len(df) == 0:
        raise ValueError("CSV must contain url,label columns and at least one row.")
    df = df[["url", "label"]].copy()
    missing = int(((df["url"].str.strip() == "") | (df["label"].str.strip() == "")).sum())
    if missing:
        raise ValueError(f"Dataset has {missing} rows with missing URL or label; clean it before upload.")
    df["label"] = df["label"].str.strip().str.lower().map(LABELS)
    if df["label"].isna().any():
        raise ValueError("Labels must be phishing/benign (or 1/0, respectively).")
    normalized = []
    for i, url in enumerate(df["url"], 2):
        try:
            normalized.append(normalize_url(url.strip()))
        except ValueError:
            raise ValueError(f"Invalid URL on CSV row {i}; URL values are not logged.") from None
    df["url"] = normalized
    conflicts = df.groupby("url")["label"].nunique().gt(1).sum()
    if conflicts:
        raise ValueError(f"Conflicting labels for {conflicts} identical normalized URLs.")
    duplicates = int(df.duplicated("url").sum())
    total = len(df)
    df = df.drop_duplicates("url").reset_index(drop=True)
    df["group"] = df["url"].map(lambda u: registered_domain(urlsplit(u).hostname))
    summary = {"total_records": total, "unique_records": len(df), "missing_values": missing,
               "duplicate_records": duplicates, "conflicting_labels": 0, "domain_groups": int(df["group"].nunique()),
               "class_distribution": {k: int((df["label"] == k).sum()) for k in ("benign", "phishing")},
               "dataset_hash": hashlib.sha256(content).hexdigest(),
               "preview": [{"url": mask_url(r.url), "label": r.label} for r in df.head(10).itertuples()],
               "storage": "Processed for this request only; not stored permanently.",
               "validation": "Valid; exact normalized duplicates removed."}
    return df, summary
