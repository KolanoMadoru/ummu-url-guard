import test from "node:test";
import assert from "node:assert/strict";
import {
  history,
  saveScan,
  deleteScan,
  clearHistory,
  maskURL,
  csv,
  getStorageWarning,
  saveSummary,
} from "../src/utils/storage.js";
import { escape } from "../src/utils/ui.js";
const data = new Map();
global.localStorage = {
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, value),
};

test("history is bounded, masked, searchable data and removable", () => {
  clearHistory();
  for (let i = 0; i < 205; i++)
    saveScan({
      id: String(i),
      url: "https://example.com/secret?token=password#private",
      online: { final_url: "https://other.com/key?token=secret" },
      timestamp: new Date().toISOString(),
    });
  assert.equal(history().length, 200);
  assert.equal(history()[0].url, "https://example.com/…");
  assert.equal(history()[0].final_url, "https://other.com/…");
  assert.equal(JSON.stringify(history()).includes("password"), false);
  deleteScan("204");
  assert.equal(history().length, 199);
  clearHistory();
  assert.deepEqual(history(), []);
});
test("CSV protects formulas and preserves quotes/newlines", () => {
  const result = csv([
    { value: '=HYPERLINK("evil")' },
    { value: "\t+cmd" },
    { value: "safe,quoted" },
  ]);
  assert.ok(result.includes("'=HYPERLINK"));
  assert.ok(result.includes("'\t+cmd"));
  assert.ok(result.includes('"safe,quoted"'));
});
test("mask invalid URLs and escape untrusted content", () => {
  assert.equal(maskURL("javascript:alert(1)"), "[invalid URL]");
  assert.equal(
    escape('<img src=x onerror="attack()">'),
    "&lt;img src=x onerror=&quot;attack()&quot;&gt;",
  );
});
test("storage failures do not crash a scan", () => {
  const original = global.localStorage;
  global.localStorage = {
    getItem() {
      throw new Error();
    },
    setItem() {
      throw new Error();
    },
  };
  assert.deepEqual(history(), []);
  assert.equal(saveScan({ id: "failed", url: "https://example.com" }), false);
  assert.ok(getStorageWarning());
  global.localStorage = original;
});
test("summaries omit dataset contents and error URLs", () => {
  saveSummary({
    experiment_id: "test",
    results: [
      {
        model_name: "RF",
        feature_set: "extended",
        metrics: { accuracy: 0.5 },
        errors: ["secret-url"],
      },
    ],
  });
  assert.equal([...data.values()].join("").includes("secret-url"), false);
});
