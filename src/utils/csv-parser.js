import Papa from "papaparse";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { DATASET_LIMITS, ONLINE_LIMITS } from "./dataset-config.js";

const encoder = new TextEncoder();
const LABELS = new Map([
  ["benign", "benign"],
  ["0", "benign"],
  ["phishing", "phishing"],
  ["1", "phishing"],
]);
const RESEARCH_COLUMNS = [
  "split", "split_final", "scenario", "kategori_audit", "source",
  "registrable_domain", "url_asli_pasangan", "url_tujuan_terverifikasi",
  "domain_icann_audit", "url_key_audit", "kelompok_audit", "keputusan_audit",
  "status_kategori_audit", "status_redirect_audit", "status_pelatihan_final",
];
const SPLIT_ALIASES = new Map([
  ...["train", "training", "pelatihan", "latih"].map((name) => [name, "train"]),
  ...["val", "valid", "validation", "validasi"].map((name) => [name, "validation"]),
  ...["test", "testing", "uji", "pengujian"].map((name) => [name, "test"]),
]);
const CATEGORY_LABELS = new Map([
  ["biasa_0", "benign"], ["biasa_1", "phishing"],
  ["pendek_0", "benign"], ["pendek_1", "phishing"],
  ["merek_0", "benign"], ["merek_1", "phishing"],
]);
const EMPTY_METADATA = new Set(["", "-", "n/a", "na", "null", "none", "unknown", "tidak diketahui"]);
const metadataValue = (value = "") => {
  const text = value.trim().toLowerCase();
  return EMPTY_METADATA.has(text) ? "" : text;
};

function readMetadata(row, label, columns, metadata, problems) {
  metadata.records_read++;
  if (metadata.split_distribution) {
    const split = metadataValue(row[columns.get("split")]);
    const final = metadataValue(row[columns.get("split_final")]);
    const part = SPLIT_ALIASES.get(split);
    const finalPart = SPLIT_ALIASES.get(final);
    if ((split && !part) || (final && !finalPart)) {
      metadata.invalid_split_records++;
      metadata.split_distribution.unknown++;
      problems.push("Invalid split. Use train, validation, or test.");
    } else if (part && finalPart && part !== finalPart) {
      metadata.split_conflict_records++;
      metadata.split_distribution.unknown++;
      problems.push("Conflicting split and split_final");
    } else {
      metadata.split_distribution[finalPart || part || "unknown"]++;
    }
  }
  if (metadata.category_distribution) {
    const category = row[columns.get("kategori_audit")].trim().toLowerCase();
    const expectedLabel = CATEGORY_LABELS.get(category);
    metadata.category_distribution[expectedLabel ? category : "unknown"]++;
    if (expectedLabel && label && label !== expectedLabel) {
      metadata.category_label_conflict_records++;
      problems.push("Category and label disagree");
    }
  }
}

export function normalizeDatasetURL(value) {
  const input = value.trim();
  if (!input || input.length > DATASET_LIMITS.maxURLLength || /[\s\x00-\x20\x7f\\]/u.test(input))
    throw new Error("Invalid URL syntax");
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/iu.exec(
    input,
  );
  if (!match) throw new Error("Use an absolute HTTP/HTTPS URL");
  if (match[2].includes("%"))
    throw new Error("Encoded hostname characters are not allowed");
  const parsed = new URL(input);
  if (parsed.username || parsed.password || match[2].includes("@"))
    throw new Error("URL credentials are not allowed");
  if (
    !parsed.hostname ||
    parsed.hostname.length > 253 ||
    parsed.port === "0" ||
    /[%]/u.test(parsed.hostname)
  )
    throw new Error("Invalid hostname or port");
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    !hostname.startsWith("[") &&
    hostname
      .split(".")
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label))
  )
    throw new Error("Invalid domain label");
  // Preserve path/query/fragment semantics instead of silently deleting them for deduplication.
  // URL is used for IDNA, scheme, port and authority validation; Python revalidates online input.
  const encode = (text) =>
    encodeURI(text)
      .replace(/%25/gu, "%")
      .replace(/[\[\]]/gu, (c) => (c === "[" ? "%5B" : "%5D"));
  const normalized = `${parsed.protocol}//${hostname}${parsed.port ? `:${parsed.port}` : ""}${encode(match[3] || "/")}${encode(match[4] || "")}${encode(match[5] || "")}`;
  if (normalized.length > DATASET_LIMITS.maxURLLength)
    throw new Error(`Normalized URL exceeds ${DATASET_LIMITS.maxURLLength} characters`);
  return {
    normalized,
    masked: `${parsed.protocol}//${hostname}${parsed.port ? `:${parsed.port}` : ""}/…`,
  };
}

export async function streamCSVRecords(file, {
  limits = DATASET_LIMITS,
  chunkBytes = limits.chunkBytes,
  onProgress = () => {},
  rowsProcessed = () => 0,
  onRecord,
  signal,
} = {}) {
  if (!file || !file.size)
    throw new Error("CSV is empty. Select a file with url,label and data rows.");
  if (file.name && !/\.csv$/iu.test(file.name))
    throw new Error("Select a .csv file containing UTF-8 text.");
  if (file.size > limits.maxFileBytes)
    throw new Error(
      `File exceeds the ${(limits.maxFileBytes / 1048576).toFixed(0)} MiB browser validation limit.`,
    );
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 1048576)
    throw new Error("Invalid parser chunk size.");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const hash = sha256.create();
  let newline = null, pending = "", offset = 0;
  onProgress({
    bytes: 0,
    totalBytes: file.size,
    rows: 0,
    percent: 0,
    phase: "Validating",
  });
  while (offset < file.size) {
    if (signal?.aborted)
      throw new DOMException("Processing cancelled.", "AbortError");
    const data = new Uint8Array(
      await file.slice(offset, offset + chunkBytes).arrayBuffer(),
    );
    offset += data.length;
    hash.update(data);
    try {
      pending += decoder.decode(data, { stream: offset < file.size });
    } catch {
      throw new Error(
        "Invalid UTF-8 encoding. Save the CSV as UTF-8 and select it again.",
      );
    }
    const final = offset === file.size;
    if (!newline) {
      const end = pending.indexOf("\n");
      if (end >= 0)
        newline = end > 0 && pending[end - 1] === "\r" ? "\r\n" : "\n";
      else if (final) newline = "\n";
    }
    if (newline) {
      const result = new Papa.Parser({
        delimiter: ",",
        newline,
        fastMode: false,
      }).parse(pending, 0, !final);
      const invalidRows = new Set(result.errors.map((e) => e.row));
      result.data.forEach((row, i) => {
        // Papa emits an empty terminal row for a trailing newline.
        if (
          final &&
          i === result.data.length - 1 &&
          row.length === 1 &&
          !row[0] &&
          pending.endsWith(newline)
        )
          return;
        if (encoder.encode(row.join(",")).byteLength > limits.maxRecordBytes)
          throw new Error("A CSV record exceeds the 256 KiB resource limit.");
        onRecord(row, invalidRows.has(i));
      });
      pending = pending.slice(result.meta.cursor);
    }
    if (encoder.encode(pending).byteLength > limits.maxRecordBytes)
      throw new Error("A CSV record exceeds the 256 KiB resource limit.");
    onProgress({
      bytes: offset,
      totalBytes: file.size,
      rows: rowsProcessed(),
      percent: Math.floor((offset / file.size) * 100),
      phase: "Processing",
    });
  }
  return bytesToHex(hash.digest());
}

export async function analyzeCSV(
  file,
  {
    limits = DATASET_LIMITS,
    chunkBytes = limits.chunkBytes,
    onProgress = () => {},
    signal,
  } = {},
) {
  const seen = new Map(); // SHA-256 keys across ALL chunks, bounded by maxUniqueURLs.
  const preview = [],
    errors = [];
  const summary = {
    dataset_name: file?.name || "dataset.csv",
    file_size: file?.size,
    source: "browser",
    total_records: 0,
    valid_records: 0,
    invalid_records: 0,
    unique_records: 0,
    missing_values: 0,
    missing_urls: 0,
    missing_labels: 0,
    invalid_urls: 0,
    urls_over_online_limit: 0,
    invalid_labels: 0,
    duplicate_records: 0,
    conflicting_labels: 0,
    conflicting_records: 0,
    blank_rows_ignored: 0,
    csv_error_records: 0,
    class_distribution: { benign: 0, phishing: 0 },
    normalization:
      "HTTP(S), IDNA hostname, default ports, UTF-8 percent encoding; backend revalidates original file for online training.",
    counting:
      "Valid records exclude invalid rows and every intrinsically valid row in a conflicting URL group. Consistent duplicate rows remain counted, and are separately reported; Python removes them before training.",
    storage:
      "File reference and bounded summary in session memory only; never localStorage.",
  };
  let columns = null, recordNumber = 0;
  const issue = (row, message) => {
    if (errors.length < 100) errors.push({ row, message });
  };
  function consume(row, csvError = false) {
    recordNumber++;
    if (row.length === 1 && row[0] === "") {
      summary.blank_rows_ignored++;
      return;
    }
    if (!columns) {
      columns = new Map(row.map((s, i) => [s.trim().toLowerCase(), i]));
      if (
        columns.size !== row.length ||
        !columns.has("url") ||
        !columns.has("label") ||
        csvError
      )
        throw new Error(
          "CSV requires distinct url,label headers (additional columns are allowed).",
        );
      summary.hasResearchMetadata = RESEARCH_COLUMNS.some((key) => columns.has(key));
      if (summary.hasResearchMetadata) {
        const metadata = {
          records_read: 0,
          split_conflict_records: 0,
          invalid_split_records: 0,
          category_label_conflict_records: 0,
        };
        if (columns.has("split") || columns.has("split_final"))
          metadata.split_distribution = { train: 0, validation: 0, test: 0, unknown: 0 };
        if (columns.has("kategori_audit"))
          metadata.category_distribution = Object.fromEntries(
            [...CATEGORY_LABELS.keys(), "unknown"].map((key) => [key, 0]),
          );
        summary.metadata_validation = metadata;
      }
      return;
    }
    const count = ++summary.total_records;
    if (count > limits.maxRows)
      throw new Error(
        `Dataset exceeds the ${limits.maxRows.toLocaleString()} record resource limit. Use local processing.`,
      );
    const problems = [];
    const malformed = row.length !== columns.size || csvError;
    if (malformed) {
      problems.push("Malformed CSV or inconsistent field count");
      summary.csv_error_records++;
    }
    const raw = (row[columns.get("url")] || "").trim();
    const rawLabel = (row[columns.get("label")] || "").trim().toLowerCase();
    const label = LABELS.get(rawLabel.replace(/^([01])\.0+$/u, "$1"));
    if (!malformed && summary.metadata_validation)
      readMetadata(row, label, columns, summary.metadata_validation, problems);
    if (!raw) {
      summary.missing_urls++;
      problems.push("Missing URL");
    }
    if (!rawLabel) {
      summary.missing_labels++;
      problems.push("Missing label");
    }
    if (!raw || !rawLabel) summary.missing_values++;
    if (rawLabel && !label) {
      summary.invalid_labels++;
      problems.push("Invalid label; use benign=0 or phishing=1");
    }
    let key, parsed, entry;
    try {
      if (raw) parsed = normalizeDatasetURL(raw);
    } catch {
      summary.invalid_urls++;
      problems.push("Invalid HTTP/HTTPS URL syntax");
    }
    if (parsed) {
      if (Math.max(raw.length, parsed.normalized.length) > ONLINE_LIMITS.maxURLLength)
        summary.urls_over_online_limit++;
      key = bytesToHex(sha256(encoder.encode(parsed.normalized)));
      entry = seen.get(key);
      if (entry) summary.duplicate_records++;
      else {
        if (seen.size >= limits.maxUniqueURLs)
          throw new Error(
            `Dataset exceeds the ${limits.maxUniqueURLs.toLocaleString()} unique URL resource limit. Use local processing.`,
          );
        entry = { mask: 0, benign: 0, phishing: 0 };
        seen.set(key, entry);
      }
    }
    if (!problems.length) {
      const bit = label === "benign" ? 1 : 2;
      const next = entry.mask | bit;
      if (next === 3) {
        if (entry.mask !== 3) {
          summary.conflicting_labels++;
          const previous = entry.benign + entry.phishing;
          summary.conflicting_records += previous;
          summary.valid_records -= previous;
          summary.invalid_records += previous;
          summary.class_distribution.benign -= entry.benign;
          summary.class_distribution.phishing -= entry.phishing;
          entry.benign = entry.phishing = 0;
        }
        summary.conflicting_records++;
        problems.push("Conflicting labels");
      } else {
        summary.valid_records++;
        summary.class_distribution[label]++;
        entry[label]++;
      }
      entry.mask = next;
    }
    if (problems.length) {
      summary.invalid_records++;
      issue(recordNumber, problems.join("; "));
    }
    if (preview.length < limits.previewRows)
      preview.push({
        url: parsed?.masked || "[invalid URL]",
        label: label || "[invalid label]",
        status:
          problems.join("; ") ||
          (entry && entry.benign + entry.phishing > 1
            ? "Valid · duplicate URL"
            : "Valid"),
        key,
      });
  }
  summary.dataset_hash = await streamCSVRecords(file, {
    limits, chunkBytes, signal, onProgress,
    rowsProcessed: () => summary.total_records,
    onRecord: consume,
  });
  if (!columns || !summary.total_records)
    throw new Error(
      "CSV must contain url,label headers and at least one data row.",
    );
  summary.unique_records = seen.size;
  summary.valid =
    summary.invalid_records === 0 && summary.conflicting_labels === 0;
  summary.validation_status = summary.valid ? "Validated" : "Validation Failed";
  summary.preview = preview.map(({ key, ...item }) => ({
    ...item,
    status:
      seen.get(key)?.mask === 3 ? "Conflicting labels · invalid" : item.status,
  }));
  summary.errors = errors;
  summary.errors_truncated = summary.invalid_records > errors.length;
  return summary;
}
