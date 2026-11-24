import test from "node:test";
import assert from "node:assert/strict";
import { researchReport } from "./fixtures/research-report.js";
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
  selectResearchReport(first.experiment_id);
  assert.equal(currentResearchReport().experiment_id, "first-test");
  assert.equal(researchReports().length, 2);
  assert.equal(JSON.parse(store.get(RESEARCH_STORAGE_KEY)).active, "first-test");
  removeResearchReport("first-test");
  assert.equal(currentResearchReport().experiment_id, "second-test");
  assert.equal(researchReports().length, 1);
});
