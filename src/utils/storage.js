export const HISTORY_KEY = "ummu_url_guard_history";
export const SUMMARY_KEY = "ummu_url_guard_experiment_summaries";
const MAX_HISTORY = 200;
let storageWarning = "";
export function getStorageWarning() {
  return storageWarning;
}
function read(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    storageWarning =
      "Browser storage is unavailable or damaged. History may not persist.";
    return [];
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    storageWarning =
      "Browser storage is full or blocked. Export results before leaving.";
    return false;
  }
}
export function maskURL(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol)
      ? `${u.origin}/…`
      : "[invalid URL]";
  } catch {
    return "[invalid URL]";
  }
}
export function history() {
  return read(HISTORY_KEY)
    .filter((x) => x && typeof x.id === "string")
    .slice(0, MAX_HISTORY);
}
export function saveScan(result) {
  const record = {
    id: result.id,
    url: maskURL(result.url),
    final_url: result.online?.final_url
      ? maskURL(result.online.final_url)
      : null,
    prediction: result.prediction,
    probability: result.probability,
    online_status: result.online?.status,
    redirects: result.online?.redirect_count ?? 0,
    timestamp: result.timestamp,
    model_version: result.model_version,
    shortener: Boolean(result.shortener_provider),
    typosquatting: Boolean(result.typosquatting?.indicator),
  };
  const previous = history().filter((entry) => entry.id !== record.id);
  return write(HISTORY_KEY, [record, ...previous].slice(0, MAX_HISTORY));
}
export function deleteScan(id) {
  return write(
    HISTORY_KEY,
    history().filter((x) => x.id !== id),
  );
}
export function clearHistory() {
  return write(HISTORY_KEY, []);
}
export function saveSummary(report) {
  // Store metrics and reproducibility metadata only, never full datasets or error URLs.
  const summary = {
    experiment_id: report.experiment_id,
    dataset_hash: report.dataset_hash,
    evaluation_timestamp: report.evaluation_timestamp,
    results: report.results.map((r) => ({
      model_name: r.model_name,
      feature_set: r.feature_set,
      metrics: Object.fromEntries(
        ["accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc"].map(
          (k) => [k, r.metrics[k]],
        ),
      ),
    })),
  };
  return write(SUMMARY_KEY, [summary, ...read(SUMMARY_KEY)].slice(0, 10));
}
export function summaries() {
  return read(SUMMARY_KEY);
}
export function csv(rows) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const cell = (value) => {
    let text = value == null ? "" : String(value);
    // Neutralize spreadsheet formulas, including prefixes hidden behind whitespace/control chars.
    if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))
      text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [keys, ...rows.map((r) => keys.map((k) => r[k]))]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
export function download(name, value, type = "application/json") {
  const data =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const blob = new Blob([data], { type });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
