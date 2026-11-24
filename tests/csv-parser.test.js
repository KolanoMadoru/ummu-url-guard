import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { analyzeCSV, normalizeDatasetURL } from "../src/utils/csv-parser.js";
import { DATASET_LIMITS } from "../src/utils/dataset-config.js";
import { trainingEligibility } from "../src/utils/dataset-state.js";
import { csvOfSize } from "./fixtures/datasets.js";
const file = (text) => new File([text], "research.csv");

for (const mib of [500 / 1024, 0.5, 1, 2, 2.1, 3, 5, 10, 15, 20, 25]) {
  test(`validates exactly ${mib} MiB without a server request or whole-file read`, async () => {
    const bytes = Math.round(mib * 1048576);
    const blob = new File(csvOfSize(bytes), "large.csv");
    blob.text = () => {
      throw new Error("Whole-file text() must not be used");
    };
    blob.arrayBuffer = () => {
      throw new Error("Whole-file arrayBuffer() must not be used");
    };
    const progress = [];
    const result = await analyzeCSV(blob, {
      onProgress: (p) => progress.push(p),
    });
    assert.equal(blob.size, bytes);
    assert.equal(result.valid, true);
    assert.equal(result.total_records, Math.max(100, Math.floor(bytes / 512)));
    assert.equal(result.valid_records, result.total_records);
    assert.equal(result.preview.length, 50);
    assert.equal(progress.at(-1).bytes, bytes);
    assert.equal(progress.at(-1).percent, 100);
    assert.ok(progress.every((p, i) => !i || p.bytes >= progress[i - 1].bytes));
    assert.equal(JSON.stringify(result).includes("token=private"), false);
  });
}
for (const rows of [100, 1000, 1001, 5000, 10000, 50000, 100000]) {
  test(`validates ${rows} rows independently of online training limits`, async () => {
    const blob = new File(csvOfSize(rows * 100, rows), "rows.csv");
    const result = await analyzeCSV(blob);
    assert.equal(result.total_records, rows);
    assert.equal(result.valid, true);
    assert.equal(
      result.class_distribution.benign + result.class_distribution.phishing,
      rows,
    );
  });
}
test("chunk invariance, quoted commas, multiline fields, escaped quotes, BOM, CRLF, IDNA, duplicates and conflicts", async () => {
  const source =
    '\ufeffurl,label,note\r\nhttps://bücher.de,0,"comma, and\r\nnewline with ""quotes"""\r\nhttps://example.com,benign,a\r\nhttps://example.com/,0,b\r\nhttps://EXAMPLE.com:443/,1,conflict\r\nhttps://safe.com,1,final\r\n';
  const expected = await analyzeCSV(file(source));
  for (const chunkBytes of [1, 2, 3, 7, 16, 63, 512, 4096])
    assert.deepEqual(await analyzeCSV(file(source), { chunkBytes }), expected);
  assert.equal(
    expected.dataset_hash,
    createHash("sha256").update(source).digest("hex"),
  );
  assert.equal(expected.total_records, 5);
  assert.equal(expected.duplicate_records, 2);
  assert.equal(expected.conflicting_labels, 1);
  assert.equal(expected.conflicting_records, 3);
  assert.equal(expected.valid_records, 2);
  assert.equal(expected.invalid_records, 3);
  assert.equal(expected.preview[1].status, "Conflicting labels · invalid");
});
test("LF, no terminal newline, labels, blanks and invalid rows have explicit counts", async () => {
  const result = await analyzeCSV(
    file(
      "url,label\n\n,phishing\nhttps://valid.com,\nhttps://badlabel.com,other\nftp://x.com,0\nhttps://ok.com, 1",
    ),
  );
  assert.equal(result.total_records, 5);
  assert.equal(result.valid_records, 1);
  assert.equal(result.invalid_records, 4);
  assert.equal(result.missing_urls, 1);
  assert.equal(result.missing_labels, 1);
  assert.equal(result.missing_values, 2);
  assert.equal(result.invalid_labels, 1);
  assert.equal(result.invalid_urls, 1);
  assert.equal(result.blank_rows_ignored, 1);
  assert.equal(result.errors[0].row, 3);
  assert.equal(result.hasResearchMetadata, false);
});
test("long HTTP URLs remain valid in browser review and require local training", async () => {
  const input = file(`URL,LABEL\nhttps://example.test/${"a".repeat(5000)}?keep=1,0\n`);
  const summary = await analyzeCSV(input);
  assert.equal(summary.valid, true);
  assert.equal(summary.urls_over_online_limit, 1);
  assert.equal(trainingEligibility({ file: input, status: "Validated", summary }).eligible, false);
});
test("audits metadata fields locally without keeping metadata values", async () => {
  const source = [
    "url,label,split,split_final,kategori_audit,url_asli_pasangan,note",
    'https://one.test/,0.00,train,Latih,biasa_0,https://private.test/path,"arbitrary metadata, retained only in the source file"',
    "https://two.test/,1.0,validation,test,pendek_1,,",
    "https://three.test/,1,invalid,,merek_0,,",
    "https://four.test/,0,,uji,,,,",
    "https://five.test/,1,,test,merek_1,,",
    "https://six.test/,1,,test,<img>,,",
  ].join("\n");
  const summary = await analyzeCSV(file(source), { chunkBytes: 17 });
  assert.equal(summary.hasResearchMetadata, true);
  assert.equal(summary.valid_records, 3);
  assert.equal(summary.invalid_records, 3);
  assert.equal(summary.csv_error_records, 1);
  assert.deepEqual(summary.metadata_validation, {
    records_read: 5,
    split_conflict_records: 1,
    invalid_split_records: 1,
    category_label_conflict_records: 1,
    split_distribution: { train: 1, validation: 0, test: 2, unknown: 2 },
    category_distribution: { biasa_0: 1, biasa_1: 0, pendek_0: 0, pendek_1: 1, merek_0: 1, merek_1: 1, unknown: 1 },
  });
  assert.match(summary.errors[0].message, /Conflicting split and split_final/u);
  assert.match(summary.errors[1].message, /Category and label disagree/u);
  assert.doesNotMatch(JSON.stringify(summary), /private\.test|<img>|arbitrary metadata/u);
});
test("streams an 8 MiB master CSV with 53 columns and reports scenario counts", async () => {
  const columns = ["url", "label", "split", "split_final", "kategori_audit", "note"];
  const spareColumns = Array.from({ length: 47 }, (_, i) => `unused_${i}`);
  const header = [...columns, ...spareColumns].join(",") + "\n";
  const rows = 20000;
  const bytes = 8 * 1048576;
  const prefixes = Array.from({ length: rows }, (_, i) =>
    `https://group-${i}.test/,${i % 2},test,testing,biasa_${i % 2},`);
  const suffix = ",".repeat(spareColumns.length) + "\n";
  const padding = bytes - header.length - rows * suffix.length -
    prefixes.reduce((total, prefix) => total + prefix.length, 0);
  const parts = prefixes.map((prefix, i) =>
    prefix + "x".repeat(Math.floor(padding / rows) + (i < padding % rows ? 1 : 0)) + suffix);
  const master = new File([header, ...parts], "master.csv");
  assert.equal(master.size, bytes);
  const summary = await analyzeCSV(master);
  assert.equal(summary.valid, true);
  assert.equal(summary.valid_records, rows);
  assert.equal(summary.metadata_validation.split_distribution.test, rows);
  assert.equal(summary.metadata_validation.category_distribution.biasa_0, rows / 2);
});
test("empty, missing/duplicate headers, invalid encoding, oversized files and resource limits", async () => {
  for (const data of [
    "",
    "url,label\n",
    "https://x.com,benign\n",
    "url,url,label\na,b,0",
  ])
    await assert.rejects(analyzeCSV(file(data)));
  await assert.rejects(
    analyzeCSV(
      new File(
        [new Uint8Array([117, 114, 108, 44, 108, 97, 98, 101, 108, 10, 255])],
        "bad.csv",
      ),
    ),
    /UTF-8/,
  );
  await assert.rejects(
    analyzeCSV(new File(["x".repeat(25 * 1048576 + 1)], "big.csv")),
    /limit/,
  );
  await assert.rejects(
    analyzeCSV(file('url,label,note\nhttps://x.com,0,"' + "x".repeat(300000))),
    /record exceeds/,
  );
  await assert.rejects(
    analyzeCSV(file("url,label\nhttps://a.com,0\nhttps://b.com,1"), {
      limits: { ...DATASET_LIMITS, maxRows: 1 },
    }),
    /record resource/,
  );
  await assert.rejects(
    analyzeCSV(file("url,label\nhttps://a.com,0\nhttps://b.com,1"), {
      limits: { ...DATASET_LIMITS, maxUniqueURLs: 1 },
    }),
    /unique URL/,
  );
});
test("malformed CSV is never accepted as a valid dataset", async () => {
  for (const value of [
    'url,label\n"https://example.com,benign',
    "url,label\nhttps://x.com,0,extra",
  ]) {
    const summary = await analyzeCSV(file(value));
    assert.equal(summary.valid, false);
    assert.ok(summary.csv_error_records > 0);
  }
});
test("cancellation stops subsequent chunks", async () => {
  const controller = new AbortController();
  let lastBytes = 0;
  await assert.rejects(
    analyzeCSV(new File(csvOfSize(1048576), "cancel.csv"), {
      signal: controller.signal,
      onProgress(p) {
        if (p.bytes) {
          lastBytes = p.bytes;
          controller.abort();
        }
      },
    }),
    { name: "AbortError" },
  );
  assert.ok(lastBytes < 1048576);
});
test("rejects URL credentials, non-http schemes, controls, invalid hosts and long URLs", () => {
  for (const url of [
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "https://example.com/\nx",
    "https://example.com\\@localhost",
    "no-scheme",
    "https://%31%32%37.0.0.1",
    "https://x.com/" + "x".repeat(DATASET_LIMITS.maxURLLength),
  ])
    assert.throws(() => normalizeDatasetURL(url));
});
