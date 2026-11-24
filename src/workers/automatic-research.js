import { prepareAutomaticData, readAutomaticCSV, splitAutomaticData } from "../utils/automatic-data.js";
import { compareHistoricalRedirects, redirectKeys } from "../utils/redirect-comparison.js";
import { csv } from "../utils/storage.js";

const STAGES = ["prepare", "split", "features", "train", "evaluate"];
const CONFIGURATIONS = ["E1", "E2", "E3", "E4", "E5", "E6"];
const PARTITIONS = ["train", "validation", "test"];
const BATCH_ROWS = 2500;
const BATCH_BYTES = 1_250_000;
const encoder = new TextEncoder();
const empty = () => ({ completed: [], dataset: null, results: [] });
const notify = (type, fields = {}) => postMessage({ type, ...fields });
let checkpoint = empty(), database, currentRun, comparisonRun, operation, pendingReset;
let phase = "idle", stage = null, progress = null, error = "", storageWarning = "";

function redirectComparisonReady() {
  return Boolean(checkpoint.keySalt && checkpoint.report);
}

function snapshot() {
  notify("snapshot", { snapshot: {
    phase, stage, progress, error, storageWarning,
    completed: checkpoint.completed,
    dataset: checkpoint.dataset,
    report: checkpoint.report ?? null,
    redirectComparisonReady: redirectComparisonReady(),
    redirectComparisonRunning: Boolean(comparisonRun),
    redirectComparison: checkpoint.redirectComparison?.summary ?? null,
  } });
}

function advance(processed, total, message) {
  progress = { processed, total, message };
  snapshot();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ummu-automatic-research", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Penyimpanan penelitian dipakai oleh tab lain."));
  });
}

function readCheckpoint() {
  return new Promise((resolve, reject) => {
    const request = database.transaction("workspace").objectStore("workspace").get("current");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveCheckpoint() {
  if (!database) return;
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("workspace", "readwrite");
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.objectStore("workspace").put(checkpoint, "current");
    });
  } catch {
    storageWarning = "Penyimpanan browser tidak tersedia atau penuh. Unduh hasil sebelum meninggalkan halaman.";
  }
}

function activateModel() {
  const result = checkpoint.results.find((entry) => entry.configuration_id === "E2");
  const model = checkpoint.report && result?.model
    ? { forest: result.model, version: checkpoint.report.experiment_id, datasetHash: checkpoint.dataset.hash }
    : null;
  notify("model", { model });
}

async function load() {
  try {
    database = await openDatabase();
    checkpoint = await readCheckpoint() ?? empty();
    if (checkpoint.completed.length) phase = "complete";
  } catch {
    storageWarning = "Penyimpanan browser tidak tersedia. Hasil hanya bertahan selama halaman ini terbuka.";
  }
  activateModel();
  if (checkpoint.report) notify("report", { report: checkpoint.report });
  snapshot();
  notify("ready");
}

async function request(path, body, type, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.throwIfAborted();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 65000);
  try {
    const response = await fetch(`/api/research/${path}`, {
      method: "POST", body, signal: controller.signal, cache: "no-store",
      headers: { "Content-Type": type },
    });
    const json = response.headers.get("content-type")?.includes("application/json");
    const data = json ? await response.json() : null;
    if (!response.ok || !data) {
      const detail = typeof data?.detail === "string" ? data.detail : null;
      const cause = new Error(detail || `Server tidak bisa menyelesaikan tahap ini (HTTP ${response.status}). Coba lagi.`);
      cause.status = response.status;
      throw cause;
    }
    signal.throwIfAborted();
    return data;
  } catch (failure) {
    signal.throwIfAborted();
    if (controller.signal.aborted) throw new Error("Permintaan melebihi waktu server. Tahap terakhir yang berhasil tetap tersimpan.");
    if (failure instanceof TypeError) throw new Error("Koneksi ke API terputus. Periksa koneksi dan ulangi tahap ini.");
    throw failure;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

function* batches(urls) {
  let values = [], bytes = 11;
  for (const url of urls) {
    const value = JSON.stringify(url);
    const size = encoder.encode(value).length + 1;
    if (values.length >= BATCH_ROWS || (values.length && bytes + size > BATCH_BYTES)) {
      yield values;
      values = [];
      bytes = 11;
    }
    values.push(value);
    bytes += size;
  }
  if (values.length) yield values;
}

async function getFeatures(values, signal) {
  try {
    return [await request("features", `{"urls":[${values.join(",")}]}`, "application/json", signal)];
  } catch (failure) {
    if (failure.status !== 413 || values.length < 2) throw failure;
    const middle = Math.floor(values.length / 2);
    const first = await getFeatures(values.slice(0, middle), signal);
    return [...first, ...await getFeatures(values.slice(middle), signal)];
  }
}

async function extractURLs(urls, signal, { expected, onProgress } = {}) {
  let info = expected;
  const extracted = [];
  for (const batch of batches(urls)) {
    signal.throwIfAborted();
    const responses = await getFeatures(batch, signal);
    for (const { rows, ...metadata } of responses) {
      if (!Array.isArray(rows) || !Array.isArray(metadata.feature_names) || metadata.feature_names.length !== 19 ||
          !Array.isArray(metadata.basic_features) || metadata.basic_features.length !== 7)
        throw new Error("API mengembalikan skema fitur yang tidak sesuai.");
      if (info && (
        info.schema_version !== metadata.schema_version ||
        info.reference_version !== metadata.reference_version ||
        info.shortener_version !== metadata.shortener_version ||
        info.psl_version !== metadata.psl_version ||
        info.feature_names.join() !== metadata.feature_names.join() ||
        info.basic_features.join() !== metadata.basic_features.join()
      ))
        throw new Error("Skema fitur berubah selama pemrosesan. Ulangi dengan versi server yang sama.");
      info = metadata;
      for (const row of rows) extracted.push(row);
    }
    onProgress?.(extracted.length);
  }
  if (extracted.length !== urls.length) throw new Error("Jumlah fitur dari API berbeda dari jumlah baris input.");
  return { extracted, metadata: info };
}

async function prepare(file, signal) {
  if (!file) throw new Error("Pilih satu file CSV dan mulai pemrosesan.");
  advance(0, file.size, "Membaca dan memvalidasi struktur CSV");
  const parsed = await readAutomaticCSV(file, {
    signal, onProgress: (value) => advance(value.bytes, file.size, "Membaca dan memvalidasi struktur CSV"),
  });
  const featureProgress = (count) => advance(count, parsed.rows.length, "Memeriksa URL dan menghitung fitur leksikal");
  featureProgress(0);
  const { extracted, metadata } = await extractURLs(parsed.rows.map((row) => row.url), signal, { onProgress: featureProgress });
  const prepared = prepareAutomaticData(parsed.rows, extracted);
  const { summary, rows, groups } = prepared;
  checkpoint.dataset = {
    ...summary,
    name: file.name, bytes: file.size, hash: parsed.datasetHash,
    source_rows: parsed.totalRecords,
    invalid_rows: summary.invalid_rows + parsed.totalRecords - parsed.rows.length,
    blank_rows: parsed.blankRecords,
  };
  checkpoint.issues = [...parsed.issues, ...prepared.issues].sort((a, b) => a.row - b.row);
  checkpoint.dataset.issues = checkpoint.issues.slice(0, 20);
  checkpoint.metadata = metadata;
  checkpoint.experimentId = crypto.randomUUID();
  // Keep audit equality keys so a later evidence file can be matched without storing raw URLs.
  checkpoint.keySalt = crypto.randomUUID();
  checkpoint.prepared = {
    groups, summary,
    rows: rows.map((original) => {
      const { row, label, provider, brand, group, features } = original;
      return { row, label, provider, brand, group, ...redirectKeys(original, checkpoint.keySalt), features: new Float32Array(features) };
    }),
  };
}

function split() {
  const { prepared } = checkpoint;
  const { train, validation, test, summary } = splitAutomaticData(prepared);
  checkpoint.split = { train, validation, test };
  const { audit, warnings, ...partitions } = summary;
  Object.assign(checkpoint.dataset, { split: partitions, audit, warnings });
  advance(prepared.rows.length, prepared.rows.length, "Pembagian dan audit lintas partisi selesai");
}

function extract() {
  const { metadata, prepared } = checkpoint;
  checkpoint.dataset.features = {
    names: metadata.feature_names, basic_names: metadata.basic_features,
    preview: prepared.rows.slice(0, 20).map((row) => [row.row, row.label, ...row.features]),
  };
  advance(prepared.rows.length, prepared.rows.length, "Fitur 7 dan 19 kolom siap");
}

function matrix() {
  const rows = checkpoint.prepared.rows;
  const count = rows.length;
  const bytes = new ArrayBuffer(count * 79);
  const view = new DataView(bytes);
  const labels = new Uint8Array(bytes, count * 76, count);
  const partitions = new Uint8Array(bytes, count * 77, count);
  const flags = new Uint8Array(bytes, count * 78, count);
  for (const [i, row] of rows.entries()) {
    for (const [j, value] of row.features.entries()) view.setFloat32((i * 19 + j) * 4, value, true);
    labels[i] = row.label;
    flags[i] = (row.provider ? 1 : 0) | (row.brand ? 2 : 0);
  }
  for (const [number, part] of PARTITIONS.entries())
    for (const i of checkpoint.split[part]) partitions[i] = number;
  return bytes;
}

async function train(signal) {
  const body = matrix();
  for (const id of CONFIGURATIONS) {
    if (checkpoint.results.some((result) => result.configuration_id === id)) continue;
    advance(checkpoint.results.length, CONFIGURATIONS.length, `Melatih konfigurasi ${id}`);
    const result = await request(`train/${id}`, body, "application/octet-stream", signal);
    if (result.configuration_id !== id || result.schema_version !== checkpoint.metadata.schema_version ||
        !result.validation_metrics || !result.metrics || result.test_predictions?.length !== checkpoint.split.test.length ||
        (id === "E2" && !result.model))
      throw new Error(`Hasil ${id} dari server tidak lengkap atau tidak cocok dengan data yang disiapkan.`);
    if (checkpoint.results.length && result.matrix_sha256 !== checkpoint.results[0].matrix_sha256)
      throw new Error("Hasil model menggunakan matriks yang berbeda.");
    checkpoint.results.push(result);
    await saveCheckpoint();
    advance(checkpoint.results.length, CONFIGURATIONS.length, `Konfigurasi ${id} selesai`);
  }
}

function compactMetrics(metrics) {
  if (!metrics) return { rows: 0, benign: 0, phishing: 0 };
  const { roc_curve, pr_curve, class_distribution, ...compact } = metrics;
  return { ...compact, ...class_distribution };
}

function evaluate() {
  const { dataset, metadata, results } = checkpoint;
  // Fixed candidates are compared using validation F1 only, independent of testing metrics.
  const selected = results.reduce((best, candidate) =>
    (candidate.validation_metrics.f1 ?? -1) > (best.validation_metrics.f1 ?? -1) ? candidate : best);
  checkpoint.report = {
    schema: "ummu-research-summary-v1",
    experiment_id: checkpoint.experimentId,
    dataset_name: dataset.name,
    dataset_hash: dataset.hash,
    feature_schema: metadata.schema_version,
    brand_reference_version: metadata.reference_version,
    shortener_registry_version: metadata.shortener_version,
    psl_version: metadata.psl_version,
    split_method: "grouped",
    selected_configuration_id: selected.configuration_id,
    scenario_kind: "heuristic",
    evaluation_timestamp: new Date().toISOString(),
    rows: dataset.valid_rows,
    split: dataset.split,
    shorteners: dataset.shorteners,
    preprocessing: Object.fromEntries(
      ["source_rows", "valid_rows", "invalid_rows", "duplicate_rows", "conflicting_rows", "blank_rows"].map((key) => [key, dataset[key]]),
    ),
    audit: {
      status: "passed", metadata: false, checks: {
        domain: dataset.audit.domainConflicts,
        normalized_url: dataset.audit.normalizedConflicts,
        related_url: dataset.audit.relatedConflicts,
      },
    },
    results: results.map((result) => ({
      id: result.configuration_id, model_name: result.model_name, feature_set: result.feature_set,
      train_seconds: result.training_seconds, prediction_seconds: result.prediction_seconds,
      metrics: compactMetrics(result.metrics), validation_metrics: compactMetrics(result.validation_metrics),
      scenarios: Object.fromEntries(Object.entries(result.scenario_metrics).map(([key, metrics]) => [key, compactMetrics(metrics)])),
      feature_importance: result.feature_importance,
      error_counts: {
        false_positive: result.metrics.confusion_matrix[0][1],
        false_negative: result.metrics.confusion_matrix[1][0],
      },
    })),
  };
  advance(results.length, results.length, "Laporan pengujian siap");
}

async function run(file, throughStage) {
  const end = STAGES.indexOf(throughStage);
  if (currentRun || end < 0) return;
  currentRun = new AbortController();
  const { signal } = currentRun;
  phase = "running";
  error = "";
  snapshot();
  try {
    for (const name of STAGES.slice(0, end + 1)) {
      signal.throwIfAborted();
      if (checkpoint.completed.includes(name)) continue;
      stage = name;
      progress = null;
      snapshot();
      if (name === "prepare") await prepare(file, signal);
      else if (name === "split") split();
      else if (name === "features") extract();
      else if (name === "train") await train(signal);
      else evaluate();
      checkpoint.completed.push(name);
      await saveCheckpoint();
      snapshot();
    }
    phase = "complete";
    if (throughStage === "evaluate") {
      activateModel();
      notify("report", { report: checkpoint.report });
    }
  } catch (failure) {
    phase = "failed";
    error = signal.aborted ? "Pemrosesan dibatalkan. Tahap yang sudah selesai tetap tersimpan." : failure.message;
  } finally {
    currentRun = null;
    snapshot();
  }
}

function exportData(kind) {
  if (kind === "redirects" && checkpoint.redirectComparison) {
    const { summary, pairs } = checkpoint.redirectComparison;
    return JSON.stringify({ ...summary, pairs }, null, 2);
  }
  if (kind === "issues" && checkpoint.issues) {
    return checkpoint.issues.length ? csv(checkpoint.issues) : "row,code,message\r\n";
  }
  if (kind === "results" && checkpoint.report) {
    const { report, results, dataset, metadata, split: partitions, prepared } = checkpoint;
    const test = [...partitions.test].sort((a, b) => a - b);
    return JSON.stringify({
      ...report, random_seed: 42, feature_names: metadata.feature_names, basic_features: metadata.basic_features,
      preprocessing_method: "trim, validate HTTP(S), deduplicate normalized URLs, quarantine conflicting labels",
      split_warnings: dataset.warnings,
      experiments: results.map(({ model, test_predictions, ...result }) => ({
        ...result,
        test_predictions: test_predictions.map(([prediction, score], i) => ({
          row: prepared.rows[test[i]].row, label: prepared.rows[test[i]].label, prediction, phishing_score: score,
        })),
      })),
    }, null, 2);
  }
  if (checkpoint.split && ["split", "basic", "extended"].includes(kind)) {
    const { prepared, split: partitions, metadata, dataset } = checkpoint;
    if (kind !== "split" && !dataset.features) throw new Error("Siapkan tabel fitur sebelum mengekspor.");
    const headers = kind === "basic" ? metadata.basic_features : metadata.feature_names;
    const indices = headers.map((name) => metadata.feature_names.indexOf(name));
    return csv(PARTITIONS.flatMap((splitName) => partitions[splitName].map((i) => {
      const record = prepared.rows[i];
      const values = kind === "split" ? {} : Object.fromEntries(headers.map((name, j) => [name, record.features[indices[j]]]));
      return { row: record.row, label: record.label, split: splitName, ...values };
    })));
  }
  throw new Error("Selesaikan tahap terkait sebelum mengunduh hasil.");
}

async function compareRedirects(file, id) {
  if (!redirectComparisonReady()) {
    notify("redirectComparison", { id, error: "Selesaikan penelitian dengan versi aplikasi ini untuk membandingkan pasangan redirect." });
    return;
  }
  comparisonRun = new AbortController();
  snapshot();
  try {
    const result = await compareHistoricalRedirects({
      file, checkpoint, signal: comparisonRun.signal,
      extract: async (urls, signal) => (await extractURLs(urls, signal, { expected: checkpoint.metadata })).extracted,
    });
    comparisonRun.signal.throwIfAborted();
    checkpoint.redirectComparison = result;
    await saveCheckpoint();
    notify("redirectComparison", { id, content: result.summary });
  } catch (failure) {
    notify("redirectComparison", { id, error: comparisonRun.signal.aborted ? "Perbandingan dibatalkan." : failure.message });
  } finally {
    comparisonRun = null;
    snapshot();
  }
}

async function reset(id) {
  checkpoint = empty();
  phase = "idle";
  stage = progress = null;
  error = "";
  activateModel();
  await saveCheckpoint();
  snapshot();
  notify("reset", { id });
}

self.onmessage = ({ data }) => {
  switch (data.type) {
    case "load":
      operation = load();
      break;
    case "run":
      if (!currentRun && !comparisonRun && !pendingReset) operation = run(data.file, data.throughStage);
      break;
    case "cancel":
      currentRun?.abort();
      break;
    case "reset": {
      currentRun?.abort();
      comparisonRun?.abort();
      const pending = Promise.resolve(operation).then(() => reset(data.id));
      operation = pendingReset = pending;
      pending.then(() => {
        if (pendingReset === pending) pendingReset = null;
      });
      break;
    }
    case "redirectComparison":
      if (currentRun || comparisonRun || pendingReset) {
        notify("redirectComparison", { id: data.id, error: "Tunggu proses penelitian yang sedang berjalan." });
      } else {
        operation = compareRedirects(data.file, data.id);
      }
      break;
    case "export":
      try {
        notify("export", { id: data.id, content: exportData(data.kind) });
      } catch (failure) {
        notify("export", { id: data.id, error: failure.message });
      }
      break;
  }
};
