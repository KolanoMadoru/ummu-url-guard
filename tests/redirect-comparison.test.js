import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compareHistoricalRedirects, redirectKeys } from "../src/utils/redirect-comparison.js";

const salt = "synthetic-workspace";
const featureNames = Array.from({ length: 19 }, (_, i) => `feature-${i}`);
const vector = (first) => [first, ...Array(18).fill(0)];
const schemaVersion = "lexical-v2";
const model = {
  schema: "ummu-random-forest-v1",
  schema_version: schemaVersion,
  feature_names: featureNames,
  trees: [[[0, 0.5, 1, 2], [-1, 0.1, 0, 0], [-1, 0.9, 0, 0]]],
};
const header = "row,url_awal,url_tujuan,sumber";
const file = (rows, columns = header) => new File([
  `\ufeff${columns}\r\n${rows.join("\r\n")}\r\n`,
], "synthetic-evidence.csv");

function extraction(value, first = 0) {
  if (!value.startsWith("https://")) return null;
  const url = new URL(value);
  return {
    normalized: url.href,
    related: `${url.host}${url.pathname}${url.search}`,
    domain: url.hostname,
    provider: url.hostname === "t.ly" && url.pathname !== "/" ? "t.ly" : null,
    features: vector(first),
  };
}

function research() {
  const original = (row) => {
    if (row === 2) return "https://training.example/source";
    if (row === 3) return "https://validation.example/source";
    if (row === 14) return "https://ordinary.example/source";
    return `https://t.ly/token-${row}`;
  };
  const rows = Array.from({ length: 13 }, (_, i) => {
    const row = i + 2;
    const extracted = extraction(original(row));
    return {
      row, label: row % 2, provider: extracted.provider,
      ...redirectKeys(extracted, salt), features: new Float32Array(vector(1)),
    };
  });
  return {
    keySalt: salt,
    report: { experiment_id: "synthetic-experiment", dataset_hash: "synthetic-digest" },
    metadata: { schema_version: schemaVersion, feature_names: featureNames },
    results: [{ configuration_id: "E2", model }],
    split: { train: [0], validation: [1], test: rows.slice(2).map((_, i) => i + 2) },
    prepared: { rows },
  };
}

test("salted keys preserve equality within the workspace and partition related keys by field", () => {
  const data = { normalized: "same", related: "same", domain: "same" };
  const first = redirectKeys(data, salt);
  assert.deepEqual(redirectKeys({ ...data }, salt), first);
  assert.equal(new Set(Object.values(first)).size, 3);
  assert.notDeepEqual(redirectKeys(data, "different-workspace"), first);
  assert.ok(Object.values(first).every((key) => /^[0-9a-f]{64}$/u.test(key)));
});

test("compares only compatible test pairs on the same label and accounts for exclusions", async () => {
  const inputs = file([
    '4,https://T.LY/token-4,"https://landing.example/docs?q=a,b","Arsip sintetis, A"',
    "5,https://t.ly/token-5,https://landing.example/alert,Arsip sintetis B",
    "7,https://t.ly/token-7,https://landing.example/one,Arsip 1",
    "7,https://t.ly/token-7,https://landing.example/two,Arsip 2",
    "8,https://t.ly/token-8,https://landing.example/no-source,",
    "9,https://t.ly/wrong-token,https://landing.example/mismatch,Arsip 3",
    "10,https://t.ly/token-10,ftp://landing.example/invalid,Arsip 4",
    "11,https://t.ly/token-11,https://t.ly/token-11,Arsip 5",
    "12,https://t.ly/token-12,https://training.example/another,Arsip 6",
    "13,https://t.ly/token-13,https://another.example/linked,Arsip 7",
    "2,https://training.example/source,https://landing.example/ignored,Arsip 8",
    "14,https://ordinary.example/source,https://landing.example/ignored,Arsip 9",
    "NaN,https://t.ly/token-X,https://landing.example/ignored,Arsip 10",
  ]);
  const calls = [];
  const extract = async (urls) => {
    calls.push(urls);
    return urls.map((url) => {
      const result = extraction(url, Number(url.endsWith("/alert")));
      if (url.endsWith("/linked")) result.related = "validation.example/source";
      return result;
    });
  };
  const { summary, pairs } = await compareHistoricalRedirects({ file: inputs, checkpoint: research(), extract });
  assert.equal(summary.evidence_sha256, createHash("sha256").update(await inputs.bytes()).digest("hex"));
  assert.equal(summary.feature_schema, schemaVersion);
  assert.deepEqual(summary.feature_names, featureNames);
  assert.deepEqual(summary.counts, {
    test_short_links: 10, documented_pairs: 4, evaluated_pairs: 2, not_evaluated: 8,
  });
  assert.deepEqual(summary.exclusions, {
    no_evidence: 1, ambiguous_evidence: 1, invalid_evidence: 1, initial_url_mismatch: 1,
    invalid_destination: 1, unchanged_destination: 1, destination_overlap: 2,
  });
  assert.equal(summary.ignored_evidence_records, 3);
  assert.deepEqual(summary.sources, { "Arsip sintetis, A": 1, "Arsip sintetis B": 1 });
  assert.deepEqual(summary.metrics.initial.confusion_matrix, [[0, 1], [0, 1]]);
  assert.equal(summary.metrics.initial.roc_auc, 0.5);
  assert.equal(summary.metrics.destination.roc_auc, 1);
  assert.equal(summary.metrics.destination.f1, 1);
  assert.deepEqual(pairs.map(({ row, label, initial, destination }) => [
    row, label, initial.score, destination.score,
  ]), [[4, 0, 0.9, 0.1], [5, 1, 0.9, 0.9]]);
  assert.deepEqual(pairs[0].initial.features, vector(1));
  assert.deepEqual(pairs[0].destination.features, vector(0));
  assert.equal(calls.length, 2);
  assert.ok(calls.flat().every((url) => !/(ignored|no-source|mismatch|token-7)/u.test(url)));
  assert.doesNotMatch(JSON.stringify({ summary, pairs }), /https?:\/\//u);
});

test("reports undefined single-class metrics and excludes source URLs from persisted citations", async () => {
  const { summary } = await compareHistoricalRedirects({
    file: file([
      "4,https://t.ly/token-4,https://landing.example/docs,Sitasi A",
      "5,https://t.ly/token-5,https://landing.example/docs,https://archive.example/evidence",
    ]),
    checkpoint: research(),
    extract: async (urls) => urls.map((url) => extraction(url)),
  });
  assert.equal(summary.exclusions.invalid_evidence, 1);
  assert.equal(summary.metrics.destination.phishing, 0);
  assert.equal(summary.metrics.destination.roc_auc, null);
  assert.equal(summary.metrics.destination.precision, null);
  assert.equal(summary.metrics.destination.recall, null);
  assert.equal(summary.metrics.destination.f1, null);
});

test("requires unique evidence columns and a compatible active research run", async () => {
  const extract = () => { throw new Error("No extraction expected"); };
  await assert.rejects(compareHistoricalRedirects({
    file: file([], "row,url_awal,url_tujuan,sumber,sumber"), checkpoint: research(), extract,
  }), /satu kolom/u);
  await assert.rejects(compareHistoricalRedirects({
    file: file([]), checkpoint: { ...research(), keySalt: undefined }, extract,
  }), /Selesaikan penelitian/u);
  const { summary, pairs } = await compareHistoricalRedirects({
    file: file([]), checkpoint: research(), extract,
  });
  assert.equal(summary.exclusions.no_evidence, 10);
  assert.deepEqual(summary.metrics, { initial: null, destination: null });
  assert.deepEqual(pairs, []);
});
