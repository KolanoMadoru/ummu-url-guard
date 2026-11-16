import test from "node:test";
import assert from "node:assert/strict";
import { displayText, classLabel, errorText, featureLabel, featureDefinition } from "../src/utils/i18n.js";
import { analyzeCSV } from "../src/utils/csv-parser.js";

test("dynamic diagnostics retain their counts, limits and field paths in Indonesian", () => {
  assert.equal(displayText("Invalid URL on CSV row 17; URL values are not logged."), "URL Tidak Valid pada baris CSV 17; nilai URL tidak dicatat dalam log.");
  assert.equal(displayText("File exceeds the 25 MiB browser validation limit."), "File melebihi batas validasi browser 25 MiB.");
  assert.equal(displayText("body.url: Field required; body.label: Invalid value"), "body.url: Kolom wajib diisi; body.label: Nilai tidak valid");
  assert.match(displayText("Invalid URL: Credentials in URLs are not allowed."), /URL Tidak Valid: Kredensial/);
  assert.equal(displayText("DNS resolution failed."), "Resolusi DNS gagal.");
  assert.equal(displayText("Request timed out. For large training jobs, use the local Python script."), "Waktu Permintaan Habis. Untuk pelatihan besar, gunakan skrip Python lokal.");
  assert.match(errorText(new Error("Unknown provider error: X42")), /Operasi gagal.*X42/);
  assert.equal(classLabel("benign"), "Aman (benign)");
  assert.equal(classLabel(null), "Tidak Tersedia");
  assert.equal(displayText("Random Forest"), "Random Forest");
  assert.equal(displayText("https://example.com/path?label=benign"), "https://example.com/path?label=benign");
});

test("all feature names and descriptions have display mappings without changing the CSV contract", async () => {
  const keys = ["url_length", "domain_length", "path_length", "query_length", "dot_count", "hyphen_count", "digit_count", "special_count", "subdomain_count", "keyword_count", "ip_address", "https", "shortener", "domain_entropy", "digit_ratio", "special_ratio", "typo_similarity", "registered_length", "suffix_length"];
  for (const key of keys) {
    assert.notEqual(featureLabel(key), key);
    assert.notEqual(featureDefinition(key, "untranslated"), "untranslated");
  }
  assert.equal(featureLabel("future_feature"), "future_feature");
  const summary = await analyzeCSV(new File(["url,label\nhttps://example.com,benign"], "sample.csv"));
  const snapshot = JSON.stringify(summary);
  assert.equal(displayText(summary.validation_status), "Validasi Berhasil");
  assert.equal(classLabel(summary.preview[0].label), "Aman (benign)");
  assert.equal(JSON.stringify(summary), snapshot);
  assert.equal(summary.validation_status, "Validated");
  assert.equal(summary.preview[0].label, "benign");
});
