// Only bounded aggregate results from the local pipeline may be retained in the browser.
export const RESEARCH_SCHEMA = "ummu-research-summary-v1";
export const RESEARCH_STORAGE_KEY = "ummu_url_guard_research_reports";
export const MAX_RESEARCH_REPORT_BYTES = 256 * 1024;
const MAX_REPORTS = 10;

export const categories = {
  biasa_0: "Benign biasa",
  biasa_1: "Phishing biasa",
  pendek_0: "Tautan pendek benign",
  pendek_1: "Tautan pendek phishing historis",
  merek_0: "Benign mirip merek",
  merek_1: "Kandidat phishing typosquatting",
};
export const scenarios = {
  biasa: "URL biasa",
  pendek: "URL pendek",
  merek: "Kemiripan merek dan typosquatting",
};
export const partitions = {
  train: "Pelatihan",
  validation: "Validasi",
  test: "Pengujian",
};
export const metrics = {
  accuracy: "Akurasi",
  precision: "Presisi",
  recall: "Recall",
  f1: "Skor F1",
  roc_auc: "ROC-AUC",
  pr_auc: "PR-AUC (AP)",
  specificity: "Spesifisitas",
  false_positive_rate: "Tingkat positif palsu",
  false_negative_rate: "Tingkat negatif palsu",
};
const configurations = [
  ["Random Forest", "basic"],
  ["Random Forest", "extended"],
  ["Decision Tree", "basic"],
  ["Decision Tree", "extended"],
  ["Logistic Regression", "basic"],
  ["Logistic Regression", "extended"],
];
const featureNames = [
  "url_length", "domain_length", "path_length", "query_length", "dot_count",
  "hyphen_count", "digit_count", "special_count", "subdomain_count",
  "keyword_count", "ip_address", "https", "shortener", "domain_entropy",
  "digit_ratio", "special_ratio", "typo_similarity", "registered_length",
  "suffix_length",
];

const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const seconds = (value) => Number.isFinite(value) && value >= 0 ? value : null;
const rate = (value) => Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
const token = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9_.+-]{0,79}$/i.test(value) ? value : null;
const reportName = (value) => /^[\p{L}\p{N}][\p{L}\p{N} ._+&()\[\]-]{0,79}$/u.test(value);
const csvFilename = (value) =>
  typeof value === "string" && /^[\p{L}\p{N} ._+&()\[\]-]{1,146}\.csv$/iu.test(value) ? value : null;
const own = (source, key) => source && Object.hasOwn(source, key) ? source[key] : undefined;
const preprocessingKeys = [
  "source_rows", "valid_rows", "invalid_rows", "duplicate_rows", "conflicting_rows", "blank_rows",
];

function safeCounts(value, knownKeys) {
  const keys = knownKeys ?? Object.keys(value ?? {}).filter(reportName).slice(0, 100);
  return Object.fromEntries(
    keys.flatMap((key) => {
      const n = count(own(value, key));
      return n == null ? [] : [[key, n]];
    }),
  );
}
function safeMetrics(value) {
  const matrix = value?.confusion_matrix;
  const validMatrix = Array.isArray(matrix) && matrix.length === 2 &&
    matrix.every((row) => Array.isArray(row) && row.length === 2 &&
      row.every((cell) => count(cell) != null));
  return {
    rows: count(value?.rows),
    benign: count(value?.benign),
    phishing: count(value?.phishing),
    ...Object.fromEntries(Object.keys(metrics).map((key) => [key, rate(own(value, key))])),
    confusion_matrix: validMatrix ? matrix : null,
  };
}
function safeResult(result) {
  const expected = /^E[1-6]$/.test(result?.id) && configurations[Number(result.id[1]) - 1];
  if (!expected || !result.metrics ||
      expected[0] !== result.model_name || expected[1] !== result.feature_set)
    throw new Error("Konfigurasi eksperimen dalam ringkasan tidak valid.");
  return {
    id: result.id,
    model_name: result.model_name,
    feature_set: result.feature_set,
    train_seconds: seconds(result.train_seconds),
    prediction_seconds: seconds(result.prediction_seconds),
    metrics: safeMetrics(result.metrics),
    validation_metrics: result.validation_metrics ? safeMetrics(result.validation_metrics) : null,
    error_counts: safeCounts(result.error_counts, ["false_positive", "false_negative"]),
    scenarios: Object.fromEntries(Object.keys(scenarios).flatMap((key) =>
      own(result.scenarios, key) ? [[key, safeMetrics(result.scenarios[key])]] : [])),
    shortener_scenarios: Object.fromEntries(
      Object.entries(result.shortener_scenarios ?? {}).filter(([name]) => reportName(name))
        .slice(0, 30).map(([name, value]) => [name, safeMetrics(value)]),
    ),
    feature_importance: Object.fromEntries(featureNames.flatMap((key) => {
      const importance = rate(own(result.feature_importance, key));
      return importance == null ? [] : [[key, importance]];
    })),
  };
}

export function parseResearchReport(report) {
  if (report?.schema !== RESEARCH_SCHEMA || !token(report.experiment_id) ||
      typeof report.dataset_hash !== "string" || !/^[a-f0-9]{64}$/i.test(report.dataset_hash) ||
      !count(report.rows) || !Array.isArray(report.results) || report.results.length !== 6 ||
      report.audit?.status !== "passed" || !["predefined", "grouped"].includes(report.split_method))
    throw new Error("Pilih research-summary.json yang dihasilkan pipeline penelitian setelah eksperimen selesai.");
  const results = report.results.map(safeResult).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(results.map((result) => result.id)).size !== 6)
    throw new Error("Ringkasan harus memuat masing-masing konfigurasi E1–E6 satu kali.");

  const split = Object.fromEntries(Object.keys(partitions).map((key) => [
    key, safeCounts(report.split?.[key], ["rows", "benign", "phishing"]),
  ]));
  if (Object.values(split).some((part) => !part.rows || part.rows !== part.benign + part.phishing) ||
      Object.values(split).reduce((sum, part) => sum + part.rows, 0) !== report.rows)
    throw new Error("Jumlah kelas atau partisi dalam ringkasan tidak konsisten.");

  return {
    schema: RESEARCH_SCHEMA,
    experiment_id: report.experiment_id,
    dataset_hash: report.dataset_hash.toLowerCase(),
    dataset_name: csvFilename(report.dataset_name),
    dataset_version: token(report.dataset_version),
    preprocessing: safeCounts(report.preprocessing, preprocessingKeys),
    scenario_kind: report.scenario_kind === "heuristic" ? "heuristic" : null,
    feature_schema: token(report.feature_schema),
    brand_reference_version: token(report.brand_reference_version),
    shortener_registry_version: token(report.shortener_registry_version),
    psl_version: typeof report.psl_version === "string" &&
      /^tldextract-[a-z0-9.+-]+:sha256:[a-f0-9]{64}:private$/i.test(report.psl_version)
      ? report.psl_version : null,
    selected_configuration_id: results.some(({ id }) => id === report.selected_configuration_id)
      ? report.selected_configuration_id : null,
    evaluation_timestamp: typeof report.evaluation_timestamp === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(report.evaluation_timestamp)
      ? report.evaluation_timestamp : null,
    rows: report.rows,
    split,
    split_method: report.split_method,
    categories: safeCounts(report.categories, [...Object.keys(categories), "unknown"]),
    sources: safeCounts(report.sources),
    shorteners: safeCounts(report.shorteners),
    audit: {
      status: "passed",
      metadata: report.audit.metadata === true,
      checks: safeCounts(report.audit.checks),
      coverage: safeCounts(report.audit.coverage),
    },
    results,
  };
}
let workspace;
function currentReports() {
  if (!workspace) {
    workspace = { active: null, reports: [] };
    try {
      const stored = JSON.parse(localStorage.getItem(RESEARCH_STORAGE_KEY) || "null");
      workspace = {
        active: token(stored?.active),
        reports: Array.isArray(stored?.reports)
          ? stored.reports.slice(0, MAX_REPORTS).flatMap((value) => {
            try {
              return [parseResearchReport(value)];
            } catch {
              return [];
            }
          })
          : [],
      };
    } catch {
      // Report imports remain usable in memory if browser storage is blocked.
    }
  }
  return workspace;
}
export function researchReports() {
  return currentReports().reports;
}
export function currentResearchReport() {
  const { active, reports } = currentReports();
  return reports.find((report) => report.experiment_id === active) ?? reports[0] ?? null;
}
function saveReports(active, reports) {
  workspace = { active, reports };
  try {
    localStorage.setItem(RESEARCH_STORAGE_KEY, JSON.stringify(workspace));
    return true;
  } catch {
    return false;
  }
}
export function importResearchReport(value) {
  const report = parseResearchReport(value);
  const id = report.experiment_id;
  const previous = researchReports().find((item) => item.experiment_id === id);
  if (previous && JSON.stringify(previous) !== JSON.stringify(report))
    throw new Error("ID eksperimen yang sama sudah tersimpan dengan isi berbeda.");
  return saveReports(id, [
    report, ...researchReports().filter((item) => item.experiment_id !== id),
  ].slice(0, MAX_REPORTS));
}
export function selectResearchReport(id) {
  return saveReports(id, researchReports());
}
export function removeResearchReport(id) {
  return saveReports(null, researchReports().filter((item) => item.experiment_id !== id));
}
