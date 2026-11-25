import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  prepareAutomaticData,
  readAutomaticCSV,
  splitAutomaticData,
  summarizeShortenerCoverage,
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

test("intake preserves optional destination evidence and only flags documented resolution failures", async () => {
  const intake = await readAutomaticCSV(csv([
    "URL,label,final_url,resolution_status,observed_at,source,final_domain",
    'https://t.ly/archived,1,https://destination.example/synthetic,RESOLVED,2026-02-20,"Archive, 4",ignored.example',
    "https://bit.ly/dead,1,,access-blocked,2026-02-20T08:30:00+09:00,Snapshot 5,",
    "https://is.gd/invalid,0,,unavailable,2026-02-30,,",
    "https://example.test/,0,,NO_REDIRECT,2026-02-20,,",
  ].join("\n")));
  assert.deepEqual(intake.rows.map(({ label, documentedDestination, resolutionStatus, resolutionFailed, observedAt, evidenceSource }) => ({
    label, documentedDestination, resolutionStatus, resolutionFailed, observedAt, evidenceSource,
  })), [
    {
      label: 1, documentedDestination: "https://destination.example/synthetic", resolutionStatus: "RESOLVED",
      resolutionFailed: false, observedAt: "2026-02-20", evidenceSource: "Archive, 4",
    },
    {
      label: 1, documentedDestination: null, resolutionStatus: "ACCESS_BLOCKED",
      resolutionFailed: true, observedAt: "2026-02-20T08:30:00+09:00", evidenceSource: "Snapshot 5",
    },
    { label: 0, documentedDestination: null, resolutionStatus: null, resolutionFailed: false, observedAt: null, evidenceSource: null },
    {
      label: 0, documentedDestination: null, resolutionStatus: "NO_REDIRECT",
      resolutionFailed: false, observedAt: "2026-02-20", evidenceSource: null,
    },
  ]);
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

test("documented destinations link aliases and ordinary URL domains across duplicate evidence", () => {
  const rows = [
    {
      row: 2, url: "https://bit.ly/alias", label: 0, documentedDestination: "https://one.test/destination",
      evidenceSource: "Archive 1", observedAt: "2025-11-11",
    },
    {
      row: 3, url: "https://bit.ly/alias", label: 0, documentedDestination: "https://two.test/destination",
      evidenceSource: "Archive 2", observedAt: "2026-01-02",
    },
    { row: 4, url: "https://one.test/ordinary", label: 1 },
    { row: 5, url: "https://two.test/destination", label: 0 },
    { row: 6, url: "https://is.gd/alias", label: 1, documentedDestination: "https://one.test/another" },
    { row: 7, url: "https://t.ly/dead", label: 1, documentedDestination: "ftp://invalid.example/" },
    ...Array.from({ length: 40 }, (_, i) => ({
      row: i + 8, url: `https://example-${i}.test/`, label: i % 2,
    })),
  ];
  const extracted = rows.map(({ url }) => extraction(url, new URL(url).hostname));
  const targets = new Map([
    [2, extraction(rows[0].documentedDestination, "one.test")],
    [3, extraction(rows[1].documentedDestination, "two.test")],
    [6, extraction(rows[4].documentedDestination, "one.test")],
    [7, null],
  ]);
  const prepared = prepareAutomaticData(rows, extracted, targets);
  assert.deepEqual(prepared.summary.destinationEvidence, { documented: 2, withProvenance: 1, invalid: 1 });
  assert.equal(prepared.rows[0].destinationKeys.domain, "one.test");
  assert.deepEqual(prepared.rows[0].destinationAlternates.map(({ domain }) => domain), ["two.test"]);
  assert.deepEqual(prepared.rows[0].destinationMetadata, [
    { row: 2, source: "Archive 1", observed_at: "2025-11-11" },
    { row: 3, source: "Archive 2", observed_at: "2026-01-02" },
  ]);
  assert.equal(prepared.rows.find(({ row }) => row === 7).label, 1);
  const aliases = prepared.rows.flatMap(({ row }, i) => [2, 4, 5, 6].includes(row) ? [i] : []);
  assert.ok(prepared.groups.some((group) => aliases.every((i) => group.includes(i))));
  const split = splitAutomaticData(prepared);
  assert.ok([split.train, split.validation, split.test].some((part) => aliases.every((i) => part.includes(i))));
  assert.equal(split.summary.audit.passed, true);
  assert.match(split.summary.warnings.join("\n"), /final_url opsional tidak valid/u);
  assert.match(split.summary.warnings.join("\n"), /tanggal observasi/u);
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
  const coverage = summarizeShortenerCoverage(prepared.rows, split);
  assert.deepEqual(coverage.providers, [{
    name: "t.ly",
    train: { benign: 46, phishing: 46 },
    validation: { benign: 0, phishing: 0 },
    test: { benign: 0, phishing: 0 },
  }]);
  assert.deepEqual(coverage.groups, { benign: 1, phishing: 1 });
  assert.match(coverage.warnings.join("\n"), /benign hanya berasal dari 1 kelompok/u);
  assert.match(coverage.warnings.join("\n"), /benign tidak tersedia pada data validasi, uji/u);
});

test("shortener coverage distinguishes providers, labels, and independent groups", () => {
  const rows = [
    { provider: "psce.pw", label: 0, group: 0 },
    { provider: "psce.pw", label: 0, group: 0 },
    { provider: "psce.pw", label: 1, group: 0 },
    { provider: "tinyurl.com", label: 0, group: 3 },
    { provider: "t.ly", label: 1, group: 4 },
    { provider: null, label: 0, group: 5 },
  ];
  const coverage = summarizeShortenerCoverage(rows, { train: [0, 1, 2], validation: [5], test: [3, 4] });
  assert.deepEqual(coverage.providers, [
    { name: "psce.pw", train: { benign: 2, phishing: 1 }, validation: { benign: 0, phishing: 0 }, test: { benign: 0, phishing: 0 } },
    { name: "t.ly", train: { benign: 0, phishing: 0 }, validation: { benign: 0, phishing: 0 }, test: { benign: 0, phishing: 1 } },
    { name: "tinyurl.com", train: { benign: 0, phishing: 0 }, validation: { benign: 0, phishing: 0 }, test: { benign: 1, phishing: 0 } },
  ]);
  assert.deepEqual(coverage.groups, { benign: 2, phishing: 2 });
  assert.match(coverage.warnings.join("\n"), /benign tidak tersedia pada data validasi/u);
  assert.match(coverage.warnings.join("\n"), /benign pada data uji berasal dari satu kelompok/u);
});

test("shortener coverage has no provider rows for an ordinary URL dataset", () => {
  const coverage = summarizeShortenerCoverage(
    [{ provider: null, label: 0, group: 0 }],
    { train: [0], validation: [], test: [] },
  );
  assert.deepEqual(coverage, { providers: [], groups: { benign: 0, phishing: 0 }, warnings: [] });
});

test("split cannot be fabricated when a label is confined to two groups", () => {
  const urls = Array.from({ length: 12 }, (_, i) => `https://site-${i % 2}.test/synthetic-${i}`);
  const rows = urls.map((url, i) => ({ row: i + 2, url, label: i % 2 }));
  const prepared = prepareAutomaticData(rows, urls.map((url, i) =>
    extraction(url, `site-${i % 2}.test`)));
  assert.throws(() => splitAutomaticData(prepared), /tiga kelompok domain/u);
});
