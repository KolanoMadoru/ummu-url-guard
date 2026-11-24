import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  prepareAutomaticData,
  readAutomaticCSV,
  splitAutomaticData,
} from "../src/utils/automatic-data.js";

const csv = (source) => new File([source], "synthetic.csv");
const extraction = (normalized, domain, extra = {}) => ({
  normalized, related: normalized.replace(/^https?:/u, ""), domain,
  features: Array(19).fill(0), provider: null, brand: false, ...extra,
});

test("automatic intake reads quoted URL and BOM and disregards contradictory metadata", async () => {
  const source = [
    "\ufeffsplit,URL,LaBeL,split_final,note",
    'train,"https://bücher.example/Case?keep=a,b#part",0,test,"two\r\nlines"',
    "",
    "test,https://example.test/private,1,train,metadata",
    "train,,1,train,note",
    "test,https://example.org/,benign,test,note",
    "test,https://example.net/,1,test",
  ].join("\r\n");
  const intake = await readAutomaticCSV(csv(source));
  assert.deepEqual(intake.rows, [
    { row: 2, url: "https://bücher.example/Case?keep=a,b#part", label: 0 },
    { row: 4, url: "https://example.test/private", label: 1 },
  ]);
  assert.equal(intake.totalRecords, 5);
  assert.equal(intake.blankRecords, 1);
  assert.equal(intake.datasetHash, createHash("sha256").update(source).digest("hex"));
  assert.deepEqual(intake.issues.map(({ row, code }) => [row, code]), [
    [3, "blank"], [5, "missing_url"], [6, "invalid_label"], [7, "malformed"],
  ]);
  assert.doesNotMatch(JSON.stringify(intake.issues), /https?:\/\//u);
});

test("automatic intake fails clearly for malformed quotes or repeated required headers", async () => {
  await assert.rejects(readAutomaticCSV(csv('url,label\n"https://example.com,0')), /record 2/u);
  await assert.rejects(readAutomaticCSV(csv("url,url,label\nx,x,0")), /satu kolom url dan label/u);
});

test("50,000 synthetic source records over 2 MiB stream without reading the entire file", async () => {
  const lines = Array.from({ length: 50_000 }, (_, i) =>
    `https://site-${i}.example/Case?source=synthetic-fixture,${i % 2}\n`);
  const source = new File(["url,label\n", ...lines], "synthetic-large.csv");
  source.text = () => { throw new Error("Unexpected whole-file read"); };
  source.arrayBuffer = () => { throw new Error("Unexpected whole-file read"); };
  assert.ok(source.size > 2 * 1024 * 1024);
  const progress = [];
  const intake = await readAutomaticCSV(source, { onProgress: (update) => progress.push(update) });
  assert.equal(intake.totalRecords, 50_000);
  assert.equal(intake.rows.length, 50_000);
  assert.equal(intake.rows.filter(({ label }) => label === 1).length, 25_000);
  assert.equal(progress.at(-1).rows, 50_000);
  assert.equal(progress.at(-1).bytes, source.size);
  assert.equal(progress.at(-1).percent, 100);
  assert.ok(progress.length > 2);
  await assert.rejects(
    readAutomaticCSV(new File(["url,label\n", ...lines, lines[0]], "oversize.csv")),
    /melebihi batas/u,
  );
});

test("preprocessing keeps originals, reports duplicates and quarantines all conflict rows", () => {
  const urls = [
    "https://example.test/Private?secret=x", "https://EXAMPLE.test/Private?secret=x",
    "http://example.test/Private?secret=x#fragment", "https://conflict.test/",
    "https://CONFLICT.test", "ftp://invalid.test/",
  ];
  const normalized = [
    extraction(urls[0], "example.test"), extraction(urls[0], "example.test"),
    extraction(urls[2], "example.test"), extraction(urls[3], "conflict.test"),
    extraction(urls[3], "conflict.test"), null,
  ];
  const rows = urls.map((url, i) => ({
    url, row: i + 2, label: i === 4 ? 1 : 0,
  }));
  const prepared = prepareAutomaticData(rows, normalized);
  assert.deepEqual(prepared.rows.map(({ url }) => url), [urls[0], urls[2]]);
  assert.deepEqual(prepared.groups, [[0, 1]]);
  const { summary, issues } = prepared;
  assert.equal(summary.source_rows, 6);
  assert.equal(summary.valid_rows, 2);
  assert.equal(summary.duplicate_rows, 1);
  assert.equal(summary.conflict_groups, 1);
  assert.equal(summary.conflicting_rows, 2);
  assert.equal(summary.invalid_rows, 1);
  assert.equal(summary.benign, 2);
  assert.deepEqual(issues.map(({ row, code }) => [row, code]), [
    [3, "duplicate"], [5, "conflict"], [6, "conflict"], [7, "invalid_url"],
  ]);
  assert.deepEqual(summary.preview.map(({ url }) => url), ["https://example.test/…", "http://example.test/…"]);
});

test("seeded domain split is reproducible and retains transitive groups", () => {
  const urls = Array.from({ length: 150 }, (_, i) =>
    `https://example-${i % 30}.test/synthetic-${i}`);
  const rows = urls.map((url, i) => ({ row: i + 2, url, label: i % 2 }));
  const extracted = urls.map((url, i) => extraction(url, `example-${i % 30}.test`, {
    provider: i % 5 === 0 ? "fixture.test" : null,
    ...(i === 0 || i === 1 ? { related: "linked-1" } : {}),
    ...(i === 31 || i === 2 ? { related: "linked-2" } : {}),
  }));
  const prepared = prepareAutomaticData(rows, extracted);
  const split = splitAutomaticData(prepared);
  assert.deepEqual(splitAutomaticData(prepared), split);
  assert.equal(split.seed, 42);
  assert.deepEqual(split.summary.audit, {
    passed: true, domainConflicts: 0, relatedConflicts: 0, normalizedConflicts: 0,
  });
  const sets = [split.train, split.validation, split.test];
  assert.equal(new Set(sets.flat()).size, rows.length);
  const linked = sets.find((indices) => indices.includes(0));
  assert.ok([1, 2, 31, 32].every((i) => linked.includes(i)));
  for (const [name, target] of [["train", 70], ["validation", 15], ["test", 15]]) {
    assert.ok(Math.abs(split.summary[name].percent - target) < 5);
    assert.ok(split.summary[name].benign > 0 && split.summary[name].phishing > 0);
    assert.ok(split.summary[name].shorteners > 0);
  }
});

test("oversized provider prefixes stay together with a split imbalance warning", () => {
  const urls = Array.from({ length: 100 }, (_, i) =>
    i < 92 ? `https://t.ly/synthetic-${i}` : `https://fixture-${i}.test/`);
  const rows = urls.map((url, i) => ({ row: i + 2, url, label: i % 2 }));
  const prepared = prepareAutomaticData(rows, urls.map((url, i) =>
    extraction(url, i < 92 ? "t.ly" : `fixture-${i}.test`, { provider: i < 92 ? "t.ly" : null })));
  const split = splitAutomaticData(prepared);
  assert.equal(split.summary.audit.passed, true);
  assert.equal(split.summary.train.shorteners, 92);
  assert.equal(split.summary.validation.shorteners + split.summary.test.shorteners, 0);
  assert.ok(split.summary.warnings.length > 0);
});

test("split cannot be fabricated when a label is confined to two groups", () => {
  const urls = Array.from({ length: 12 }, (_, i) => `https://site-${i % 2}.test/synthetic-${i}`);
  const rows = urls.map((url, i) => ({ row: i + 2, url, label: i % 2 }));
  const prepared = prepareAutomaticData(rows, urls.map((url, i) =>
    extraction(url, `site-${i % 2}.test`)));
  assert.throws(() => splitAutomaticData(prepared), /tiga kelompok domain/u);
});
