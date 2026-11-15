import Papa from "papaparse";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { DATASET_LIMITS } from "./dataset-config.js";

const encoder = new TextEncoder();
const LABELS = new Map([
  ["benign", "benign"],
  ["0", "benign"],
  ["phishing", "phishing"],
  ["1", "phishing"],
]);

export function normalizeDatasetURL(value) {
  const input = value.trim();
  if (!input || input.length > 4096 || /[\s\x00-\x20\x7f\\]/u.test(input))
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
  if (normalized.length > 4096)
    throw new Error("Normalized URL exceeds 4096 characters");
  return {
    normalized,
    masked: `${parsed.protocol}//${hostname}${parsed.port ? `:${parsed.port}` : ""}/…`,
  };
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
  if (!file || !file.size)
    throw new Error(
      "CSV is empty. Select a file with url,label and data rows.",
    );
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
  const seen = new Map(); // SHA-256 keys across ALL chunks, bounded by maxUniqueURLs.
  const preview = [],
    errors = [];
  const summary = {
    dataset_name: file.name || "dataset.csv",
    file_size: file.size,
    source: "browser",
    total_records: 0,
    valid_records: 0,
    invalid_records: 0,
    unique_records: 0,
    missing_values: 0,
    missing_urls: 0,
    missing_labels: 0,
    invalid_urls: 0,
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
  let headers = null,
    newline = null,
    pending = "",
    offset = 0;
  const issue = (row, message) => {
    if (errors.length < 100) errors.push({ row, message });
  };
  function consume(row, csvError = false) {
    if (row.length === 1 && row[0] === "") {
      summary.blank_rows_ignored++;
      return;
    }
    if (encoder.encode(row.join(",")).byteLength > limits.maxRecordBytes)
      throw new Error("A CSV record exceeds the 256 KiB resource limit.");
    if (!headers) {
      headers = row.map((s) => s.trim());
      if (
        new Set(headers).size !== headers.length ||
        !headers.includes("url") ||
        !headers.includes("label") ||
        csvError
      )
        throw new Error(
          "CSV requires distinct url,label headers (additional columns are allowed).",
        );
      return;
    }
    const count = ++summary.total_records;
    if (count > limits.maxRows)
      throw new Error(
        `Dataset exceeds the ${limits.maxRows.toLocaleString()} record resource limit. Use local processing.`,
      );
    const problems = [];
    if (row.length !== headers.length || csvError) {
      problems.push("Malformed CSV or inconsistent field count");
      summary.csv_error_records++;
    }
    const raw = (row[headers.indexOf("url")] || "").trim();
    const rawLabel = (row[headers.indexOf("label")] || "").trim().toLowerCase();
    const label = LABELS.get(rawLabel);
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
      issue(count + 1, problems.join("; "));
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
        // Papa emits an empty terminal row for a trailing newline; it is not a data record.
        if (
          final &&
          i === result.data.length - 1 &&
          row.length === 1 &&
          !row[0] &&
          pending.endsWith(newline)
        )
          return;
        consume(row, invalidRows.has(i));
      });
      pending = pending.slice(result.meta.cursor);
    }
    if (encoder.encode(pending).byteLength > limits.maxRecordBytes)
      throw new Error("A CSV record exceeds the 256 KiB resource limit.");
    onProgress({
      bytes: offset,
      totalBytes: file.size,
      rows: summary.total_records,
      percent: Math.floor((offset / file.size) * 100),
      phase: "Processing",
    });
  }
  if (!headers || !summary.total_records)
    throw new Error(
      "CSV must contain url,label headers and at least one data row.",
    );
  summary.unique_records = seen.size;
  summary.dataset_hash = bytesToHex(hash.digest());
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
