import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { predictBrowserForest } from "./browser-prediction.js";
import { streamCSVRecords } from "./csv-parser.js";
import { DATASET_LIMITS } from "./dataset-config.js";

const encoder = new TextEncoder();
const KEY_FIELDS = ["normalized", "related", "domain"];
const COLUMNS = ["row", "url_awal", "url_tujuan", "sumber"];
const EVIDENCE_ROW_LIMIT = Math.min(50000, DATASET_LIMITS.maxRows);

export function redirectKeys(row, salt) {
  return Object.fromEntries(KEY_FIELDS.map((key) => [
    key, bytesToHex(sha256(encoder.encode(`${salt}\0${key}\0${row[key]}`))),
  ]));
}

async function readEvidence(file, testRows, signal) {
  if (!file?.size) throw new Error("Pilih CSV bukti redirect yang tidak kosong.");
  const evidence = new Map();
  let columns, width, record = 0, ignored = 0;
  const evidenceSha256 = await streamCSVRecords(file, {
    signal,
    onRecord(cells, malformed) {
      record++;
      if (malformed) throw new Error(`CSV bukti tidak dapat dibaca pada record ${record}.`);
      if (record > EVIDENCE_ROW_LIMIT + 1)
        throw new Error(`CSV bukti melebihi batas ${EVIDENCE_ROW_LIMIT} record data.`);
      if (cells.length === 1 && !cells[0].trim()) return;
      if (!columns) {
        const headers = cells.map((cell) => cell.trim().toLowerCase());
        columns = COLUMNS.map((key) => headers.indexOf(key));
        if (COLUMNS.some((key, i) => columns[i] < 0 || columns[i] !== headers.lastIndexOf(key)))
          throw new Error("CSV bukti harus memuat satu kolom row, url_awal, url_tujuan, dan sumber.");
        width = cells.length;
        return;
      }
      const [id, initial, destination, source] = columns.map((i) => cells[i]?.trim() ?? "");
      const row = Number(id);
      if (!/^[1-9]\d*$/u.test(id) || !Number.isSafeInteger(row) || !testRows.has(row)) {
        ignored++;
        return;
      }
      if (evidence.has(row)) {
        evidence.set(row, { exclusion: "ambiguous_evidence" });
        return;
      }
      if (cells.length !== width || !initial || !destination || !source ||
          initial.length > DATASET_LIMITS.maxURLLength || destination.length > DATASET_LIMITS.maxURLLength ||
          source.length > 200 || /[\x00-\x1f\x7f]|https?:\/\//iu.test(source)) {
        evidence.set(row, { exclusion: "invalid_evidence" });
        return;
      }
      evidence.set(row, { initial, destination, source });
    },
  });
  if (!columns) throw new Error("CSV bukti tidak memiliki header.");
  return { evidence, ignored, evidenceSha256 };
}

function keysOutsideTest(checkpoint) {
  const used = Object.fromEntries(KEY_FIELDS.map((key) => [key, new Set()]));
  for (const name of ["train", "validation"]) {
    for (const i of checkpoint.split[name]) {
      const row = checkpoint.prepared.rows[i];
      for (const key of KEY_FIELDS) used[key].add(row[key]);
    }
  }
  return used;
}

function rate(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function rocAuc(predictions, positives) {
  const negatives = predictions.length - positives;
  if (!positives || !negatives) return null;
  predictions.sort((a, b) => a.score - b.score);
  let rankSum = 0, first = 0;
  while (first < predictions.length) {
    const score = predictions[first].score;
    let end = first, tiedPositives = 0;
    while (end < predictions.length && predictions[end].score === score) {
      tiedPositives += predictions[end].label;
      end++;
    }
    rankSum += tiedPositives * (first + 1 + end) / 2;
    first = end;
  }
  return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

function metrics(pairs, side) {
  if (!pairs.length) return null;
  const matrix = [[0, 0], [0, 0]];
  const scores = pairs.map(({ label, [side]: result }) => {
    matrix[label][result.prediction === "phishing" ? 1 : 0]++;
    return { label, score: result.score };
  });
  const [[tn, fp], [fn, tp]] = matrix;
  return {
    rows: pairs.length,
    benign: tn + fp,
    phishing: tp + fn,
    accuracy: (tn + tp) / pairs.length,
    precision: rate(tp, tp + fp),
    recall: rate(tp, tp + fn),
    f1: rate(2 * tp, 2 * tp + fp + fn),
    roc_auc: rocAuc(scores, tp + fn),
    confusion_matrix: matrix,
  };
}

function classify(model, metadata, values) {
  const result = predictBrowserForest(model, {
    schema_version: metadata.schema_version,
    features: Object.fromEntries(metadata.feature_names.map((name, i) => [name, values[i]])),
  });
  if (!result) throw new Error("Model E2 atau tabel fitur tidak cocok dengan penelitian aktif.");
  return { prediction: result.prediction, score: result.probability };
}

async function extractRows(entries, field, extract, signal) {
  if (!entries.length) return [];
  const rows = await extract(entries.map((entry) => entry.evidence[field]), signal);
  if (!Array.isArray(rows) || rows.length !== entries.length)
    throw new Error("Jumlah hasil ekstraksi fitur tidak cocok dengan bukti redirect.");
  return rows;
}

export async function compareHistoricalRedirects({ file, checkpoint, extract, signal }) {
  const { keySalt, report, metadata, results, split, prepared } = checkpoint;
  const model = results?.find((result) => result.configuration_id === "E2")?.model;
  if (!keySalt || !report || !model) {
    throw new Error("Selesaikan penelitian pada versi ini untuk membandingkan pasangan URL uji.");
  }
  const testRows = new Map();
  for (const i of split.test) {
    const row = prepared.rows[i];
    if (row.provider) testRows.set(row.row, row);
  }
  const { evidence, ignored, evidenceSha256 } = await readEvidence(file, testRows, signal);
  const exclusions = {
    no_evidence: 0, ambiguous_evidence: 0, invalid_evidence: 0, initial_url_mismatch: 0,
    invalid_destination: 0, unchanged_destination: 0, destination_overlap: 0,
  };
  const candidates = [];
  for (const [id, row] of testRows) {
    const evidenceRow = evidence.get(id);
    if (!evidenceRow) exclusions.no_evidence++;
    else if (evidenceRow.exclusion) exclusions[evidenceRow.exclusion]++;
    else candidates.push({ row, evidence: evidenceRow });
  }
  const initialRows = await extractRows(candidates, "initial", extract, signal);
  const matched = candidates.filter(({ row }, i) => {
    const initial = initialRows[i];
    if (initial?.provider && redirectKeys(initial, keySalt).normalized === row.normalized) return true;
    exclusions.initial_url_mismatch++;
    return false;
  });
  const destinations = await extractRows(matched, "destination", extract, signal);
  const outside = keysOutsideTest(checkpoint);
  const sources = new Map(), pairs = [];
  let documented = 0;
  for (const [i, { row, evidence: evidenceRow }] of matched.entries()) {
    signal?.throwIfAborted();
    const destination = destinations[i];
    if (!destination) {
      exclusions.invalid_destination++;
      continue;
    }
    const keys = redirectKeys(destination, keySalt);
    if (keys.normalized === row.normalized) {
      exclusions.unchanged_destination++;
      continue;
    }
    documented++;
    if (KEY_FIELDS.some((key) => outside[key].has(keys[key]))) {
      exclusions.destination_overlap++;
      continue;
    }
    const { source } = evidenceRow;
    const initialFeatures = Array.from(row.features);
    const destinationFeatures = destination.features.map((value) => Math.fround(value));
    pairs.push({
      row: row.row,
      label: row.label,
      source,
      initial: {
        ...classify(model, metadata, initialFeatures),
        features: initialFeatures,
      },
      destination: {
        ...classify(model, metadata, destinationFeatures),
        features: destinationFeatures,
      },
    });
    sources.set(source, (sources.get(source) ?? 0) + 1);
  }
  return {
    summary: {
      experiment_id: report.experiment_id,
      dataset_hash: report.dataset_hash,
      evidence_sha256: evidenceSha256,
      model_version: report.experiment_id,
      feature_schema: metadata.schema_version,
      feature_names: metadata.feature_names,
      evaluated_at: new Date().toISOString(),
      counts: {
        test_short_links: testRows.size,
        documented_pairs: documented,
        evaluated_pairs: pairs.length,
        not_evaluated: testRows.size - pairs.length,
      },
      exclusions,
      ignored_evidence_records: ignored,
      sources: Object.fromEntries(sources),
      metrics: { initial: metrics(pairs, "initial"), destination: metrics(pairs, "destination") },
    },
    pairs,
  };
}
