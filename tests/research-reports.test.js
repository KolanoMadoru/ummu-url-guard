import test from "node:test";
import assert from "node:assert/strict";
import { researchReport } from "./fixtures/research-report.js";
import { renderResearchEvaluation } from "../src/components/research-workspace.js";
import {
  parseResearchReport,
  importResearchReport,
  currentResearchReport,
  researchReports,
  selectResearchReport,
  removeResearchReport,
  RESEARCH_STORAGE_KEY,
} from "../src/utils/research-reports.js";

test("retains aggregate fields and excludes potentially private or executable data", () => {
  const report = researchReport();
  report.sources["<script>alert(1)</script>"] = 10;
  report.sources["https://example.test/path?token=private"] = 10;
  report.results[0].testing_predictions = [{ url: "https://example.test/raw" }];
  report.results[0].metrics.roc_curve = { x: [0, 1], y: [0, 1] };
  const parsed = parseResearchReport(report);
  assert.equal(parsed.rows, 12);
  assert.deepEqual(parsed.sources, { Synthetic: 12 });
  assert.deepEqual(Object.keys(parsed.results[0].scenarios), ["biasa"]);
  assert.equal(parsed.results[0].metrics.roc_auc, null);
  assert.deepEqual(parsed.results[0].metrics.confusion_matrix, [[0, 1], [0, 1]]);
  assert.doesNotMatch(JSON.stringify(parsed), /https:\/\/|testing_predictions|roc_curve|alert/);
});

test("rejects mismatched, repeated, and incomplete results", () => {
  const report = researchReport();
  assert.throws(() => parseResearchReport({ ...report, rows: 50 }), /tidak konsisten/);
  assert.throws(() => parseResearchReport({ ...report, results: report.results.slice(0, 5) }), /setelah eksperimen selesai/);
  report.results[1] = report.results[0];
  assert.throws(() => parseResearchReport(report), /satu kali/);
});

test("preserves bounded automatic experiment metadata and separate validation aggregates", () => {
  const report = researchReport();
  report.dataset_name = "Dataset Riset (Sintetis).CSV";
  report.scenario_kind = "heuristic";
  report.preprocessing = {
    source_rows: 15, valid_rows: 12, invalid_rows: 1, duplicate_rows: 2,
    conflicting_rows: 0, url: "https://example.test/private",
  };
  report.results[0].error_counts = { false_positive: 1, false_negative: 0, benign: 1 };
  report.results[0].validation_metrics = {
    rows: 2, benign: 1, phishing: 1, accuracy: 1,
    predictions: ["https://example.test/private"],
  };
  const parsed = parseResearchReport(report);
  assert.equal(parsed.dataset_name, report.dataset_name);
  assert.equal(parsed.scenario_kind, "heuristic");
  assert.deepEqual(parsed.preprocessing, {
    source_rows: 15, valid_rows: 12, invalid_rows: 1, duplicate_rows: 2, conflicting_rows: 0,
  });
  assert.deepEqual(parsed.results[0].error_counts, { false_positive: 1, false_negative: 0 });
  assert.equal(parsed.results[0].validation_metrics.accuracy, 1);
  assert.equal(parsed.results[0].metrics.accuracy, 0.5);
  assert.doesNotMatch(JSON.stringify(parsed), /private|predictions/);
  assert.equal(parseResearchReport({ ...report, dataset_name: "../../private.csv" }).dataset_name, null);
  assert.equal(parseResearchReport({ ...report, scenario_kind: "verified" }).scenario_kind, null);
});

test("keeps shortener coverage bounded and renders false positives with actual denominators", () => {
  const report = researchReport();
  report.shortener_coverage = {
    providers: [
      {
        name: "T.LY",
        train: { benign: 2, phishing: 1, private_url: "https://example.test/token" },
        validation: { benign: 0, phishing: 0 },
        test: { benign: 0, phishing: 0 },
      },
      {
        name: "bit.ly",
        train: { benign: 0, phishing: 0 },
        validation: { benign: 0, phishing: 0 },
        test: { benign: 1, phishing: 1 },
      },
    ],
    groups: { benign: 2, phishing: 2 },
    warnings: ["Penyedia URL pendek terbatas.", "<script>", "https://example.test/token"],
  };
  for (const result of report.results) result.scenarios.pendek = result.metrics;
  const parsed = parseResearchReport(report);
  assert.equal(parsed.shortener_coverage.providers[0].name, "t.ly");
  assert.deepEqual(parsed.shortener_coverage.warnings, ["Penyedia URL pendek terbatas."]);
  assert.deepEqual(parsed.shortener_coverage.providers[0].train, { benign: 2, phishing: 1 });
  assert.doesNotMatch(JSON.stringify(parsed.shortener_coverage), /https:\/\/|<script>/);
  const view = renderResearchEvaluation(parsed);
  assert.match(view, /Pengujian benign/);
  assert.match(view, /Penyedia URL pendek terbatas/);
  assert.match(view, /<td>E1<\/td><td>1 dari 1<\/td><td>100\.0%<\/td>/);
  report.shortener_coverage.providers[0].train.benign = 5;
  assert.equal(parseResearchReport(report).shortener_coverage, null);

  const withoutShortBenign = researchReport();
  for (const result of withoutShortBenign.results)
    result.scenarios.pendek = { rows: 1, benign: 0, phishing: 1, confusion_matrix: [[0, 0], [0, 1]] };
  assert.match(renderResearchEvaluation(parseResearchReport(withoutShortBenign)),
    /<td>E2<\/td><td>0 dari 0<\/td><td>Tidak Tersedia<\/td>/);
});

test("preserves distinct experiments and updates the selected summary", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key),
    setItem: (key, value) => store.set(key, value),
  };
  const first = researchReport("first-test");
  assert.equal(importResearchReport(first), true);
  assert.equal(importResearchReport(researchReport("second-test")), true);
  const conflicting = { ...first, dataset_hash: "2".repeat(64) };
  assert.throws(() => importResearchReport(conflicting), /isi berbeda/);
  const coverage = { providers: [], groups: { benign: 0, phishing: 0 }, warnings: [] };
  const enriched = { ...first, shortener_coverage: coverage };
  assert.throws(() => importResearchReport(enriched), /isi berbeda/);
  assert.throws(() => importResearchReport({ ...conflicting, shortener_coverage: coverage },
    { allowCoverageEnrichment: true }), /isi berbeda/);
  assert.equal(importResearchReport(enriched, { allowCoverageEnrichment: true }), true);
  assert.deepEqual(currentResearchReport().shortener_coverage, coverage);
  assert.throws(() => importResearchReport(first, { allowCoverageEnrichment: true }), /isi berbeda/);
  selectResearchReport(first.experiment_id);
  assert.equal(currentResearchReport().experiment_id, "first-test");
  assert.equal(researchReports().length, 2);
  assert.equal(JSON.parse(store.get(RESEARCH_STORAGE_KEY)).active, "first-test");
  removeResearchReport("first-test");
  assert.equal(currentResearchReport().experiment_id, "second-test");
  assert.equal(researchReports().length, 1);
});
