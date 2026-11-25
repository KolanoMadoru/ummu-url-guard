import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import Papa from "papaparse";

const shorteners = new Set([
  "bit.ly", "cutt.ly", "flyn.co", "is.gd", "ln.run", "q-r.to", "qrco.de",
  "rebrand.ly", "s.id", "short-url.cc", "t.co", "t.ly", "tinyurl.com",
]);

test("research workflow, paired redirects, private history and mobile navigation", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByText("API Python Terhubung")).toBeVisible();
  const nav = (name) =>
    page.getByRole("navigation").getByRole("link", { name, exact: true });
  for (const name of [
    "Dasbor",
    "Pemindai URL",
    "Manajemen Dataset",
    "Ekstraksi Fitur",
    "Pelatihan Model",
    "Evaluasi Model",
    "Eksperimen Fitur",
    "Analisis Hasil",
    "Riwayat Deteksi",
  ]) {
    await nav(name).click();
    await expect(page.locator("h1")).toBeVisible();
  }
  await nav("Ekstraksi Fitur").click();
  await page
    .getByLabel("URL", { exact: true })
    .fill("https://gooogle.com/login?token=private");
  await page.getByRole("button", { name: "Ekstraksi Fitur" }).click();
  await expect(page.getByRole("heading", { name: "Hasil Ekstraksi URL" })).toBeVisible();
  await expect(page.locator("#feature-result tbody tr")).toHaveCount(19);
  await expect(page.locator("#feature-result")).not.toContainText("lexical-v2");
  await nav("Pemindai URL").click();
  await page
    .getByLabel("Masukkan URL")
    .fill("http://127.0.0.1/secret?token=private");
  await page.getByRole("button", { name: "Pindai URL", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Prediksi Tidak Tersedia — model belum dilatih",
    }),
  ).toBeVisible();
  const history = await page.evaluate(() =>
    localStorage.getItem("ummu_url_guard_history"),
  );
  expect(history).not.toContain("private");
  expect(history).not.toContain("secret");
  await nav("Dasbor").click();
  await expect(page.getByRole("heading", { name: "Pemindai URL" })).toBeVisible();
  await nav("Riwayat Deteksi").click();
  await page.getByRole("searchbox").fill("not-present");
  await expect(page.getByText("Belum ada riwayat yang sesuai.")).toBeVisible();
  await page.getByRole("searchbox").fill("127.0.0.1");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ekspor CSV" }).click();
  expect((await download).suggestedFilename()).toBe("masked-history.csv");
  await page.getByRole("button", { name: "Hapus", exact: true }).click();
  await expect(page.getByText("Belum ada riwayat yang sesuai.")).toBeVisible();
  await nav("Manajemen Dataset").click();
  // Generated synthetic URLs exercise software behavior only.
  const urls = [];
  for (let i = 0; i < 100; i++) {
    urls.push({ url: `https://group${i}.example/about`, label: 0 });
    urls.push({ url: `https://login.group${i}.example/verify?name=private`, label: 1 });
  }
  for (const host of shorteners)
    for (const index of [0, 1, 2, 3]) {
      const knownDestination = host === "bit.ly" && index === 0;
      urls.push({
        url: `https://${host}/synthetic-${index}?token=private-original`, label: index % 2,
        resolution_status: knownDestination ? "RESOLVED" : "TIMEOUT",
        final_url: knownDestination ? urls[0].url : "",
        observed_at: "2026-01-01", source: "Arsip sintetis",
      });
    }
  urls.push(urls[0]);
  await page.locator("#dataset-file").setInputFiles({
    name: "synthetic-test-only.csv", mimeType: "text/csv",
    buffer: Buffer.from(Papa.unparse(urls, {
      columns: ["url", "label", "final_url", "resolution_status", "source", "observed_at"],
    })),
  });
  const trainingRequests = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/research/train/")) trainingRequests.push(path.split("/").pop());
  });
  await page.getByRole("button", { name: "Jalankan Penelitian Otomatis", exact: true }).click();
  await expect(page.locator("[data-research-status]")).toContainText("Penelitian Selesai", { timeout: 45000 });
  expect(trainingRequests).toEqual(["E1", "E2", "E3", "E4", "E5", "E6"]);
  await expect(page.getByRole("row", { name: "Data Duplikat 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pembagian Dataset" })).toBeVisible();
  await expect(page.locator("#dataset-result")).not.toContainText("Tidak ditemukan kebocoran");
  await expect(page.getByRole("heading", { name: "Cakupan URL Pendek per Partisi" })).toBeVisible();
  const coverageReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh Cakupan URL Pendek" }).click();
  const coverage = Papa.parse(await readFile(await (await coverageReady).path(), "utf8"),
    { header: true, skipEmptyLines: true }).data;
  expect(coverage).toHaveLength(shorteners.size * 3);
  expect(coverage.filter(({ provider }) => provider === "bit.ly").map(({ split }) => split))
    .toEqual(["train", "validation", "test"]);
  const reportReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh Laporan Penelitian", exact: true }).click();
  const report = JSON.parse(await readFile(await (await reportReady).path(), "utf8"));
  expect(report.rows).toBe(urls.length - 1);
  expect(report.scenario_kind).toBe("heuristic");
  expect(report.results).toHaveLength(6);
  expect(report.audit).toMatchObject({
    status: "passed", checks: { domain: 0, normalized_url: 0, related_url: 0 },
  });
  expect(report.historical_destination_evidence).toEqual({ documented: 1, withProvenance: 1, invalid: 0 });
  expect(report.historical_redirect_metadata).toContainEqual({
    row: 202, documented_destination: true, resolution_status: "RESOLVED",
    source: "Arsip sintetis", observed_at: "2026-01-01",
  });
  const fallback = report.experiments.find(({ configuration_id }) => configuration_id === "E1").fallback;
  expect(fallback.basis).toBe("url_awal");
  expect(fallback.validation.class_distribution.benign).toBeGreaterThan(0);
  expect(fallback.testing.class_distribution.phishing).toBeGreaterThan(0);
  expect(report.shortener_coverage.groups).toEqual({ benign: shorteners.size, phishing: shorteners.size });
  expect(report.shortener_coverage.providers).toHaveLength(shorteners.size);
  for (const provider of report.shortener_coverage.providers) {
    const splits = [provider.train, provider.validation, provider.test];
    expect(splits.filter((split) => split.benign || split.phishing)).toEqual([{ benign: 2, phishing: 2 }]);
  }
  expect(report.experiments.every((model) => model.test_predictions.length === report.split.test.rows)).toBe(true);
  expect(report.results.every((model) => model.metrics.confusion_matrix.flat().reduce((a, b) => a + b) === report.split.test.rows)).toBe(true);
  await checkHistoricalRedirects(page, urls);
  expect(trainingRequests).toEqual(["E1", "E2", "E3", "E4", "E5", "E6"]);
  await expect(page.getByRole("heading", { name: "Cakupan URL Pendek per Partisi" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Positif Palsu pada URL Pendek" })).toBeVisible();
  const shortTest = report.results.find(({ id }) => id === "E2").scenarios.pendek;
  await expect(page.getByText(`${shortTest.confusion_matrix[0][1]} dari ${shortTest.benign}`, { exact: true }).first())
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "Evaluasi Penelitian", exact: true })).toBeVisible();
  await expect(page.getByText("Skor Pembanding pada Data Validasi")).toBeVisible();
  await expect(page.getByText("Subset dibentuk dari ciri URL.", { exact: false })).toHaveCount(0);
  await nav("Analisis Hasil").click();
  await expect(page.locator("#research-f1")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#dashboard");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Buka atau tutup navigasi" }).click();
  await nav("Pemindai URL").click();
  await expect(page.getByLabel("Masukkan URL")).toBeVisible();
  expect(errors).toEqual([]);
});

async function checkHistoricalRedirects(page, urls) {
  const splitDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh Pembagian Dataset" }).click();
  const split = Papa.parse(await readFile(await (await splitDownload).path(), "utf8"),
    { header: true, skipEmptyLines: true }).data;
  const inputURL = ({ row }) => urls[Number(row) - 2].url;
  const linkedOrigin = split.find((entry) => inputURL(entry) === urls.find((record) => record.final_url).url);
  const linkedDestination = split.find((entry) => inputURL(entry) === urls[0].url);
  expect(linkedOrigin.split).toBe(linkedDestination.split);
  const trainingRow = split.find(({ split }) => split === "train");
  const heldOut = split.filter((entry) =>
    entry.split === "test" && shorteners.has(new URL(inputURL(entry)).hostname));
  expect(heldOut.length).toBeGreaterThanOrEqual(3);
  const overlap = `https://${new URL(inputURL(trainingRow)).hostname}/other-path`;
  const evidence = heldOut.slice(0, 3).map((entry, i) => ({
    row: entry.row,
    url_awal: inputURL(entry),
    url_tujuan: i === 2 ? overlap : `https://synthetic-destination-${i}.example/path?token=private-destination`,
    sumber: "Arsip sintetis A",
  }));

  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url())));
  await page.getByRole("link", { name: "Evaluasi Model", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hasil Utama pada Data Uji" })).toBeVisible();
  const panel = page.locator("#redirect-research-panel");
  await panel.getByLabel("Pilih Bukti Redirect CSV").setInputFiles({
    name: "synthetic-evidence.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(Papa.unparse(evidence)),
  });
  await panel.getByRole("button", { name: "Bandingkan Pasangan Redirect" }).click();
  await expect(panel.getByRole("row", { name: "Pasangan dievaluasi 2" })).toBeVisible();
  await expect(panel.getByRole("row", { name: "Tujuan terkait dengan data latih atau validasi 1" })).toBeVisible();
  await expect(panel.getByRole("row", { name: "Arsip sintetis A 2" })).toBeVisible();
  await expect(panel.getByRole("row", { name: "Jumlah pasangan 2 2" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hasil Utama pada Data Uji" })).toBeVisible();
  expect(requests.some(({ pathname }) => pathname.startsWith("/api/research/train/") || pathname === "/api/scan")).toBe(false);
  expect(requests.every(({ origin }) => origin === new URL(page.url()).origin)).toBe(true);

  // Simulate a saved workspace from before shortener coverage was included.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("ummu-automatic-research", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("workspace", "readwrite");
      const store = transaction.objectStore("workspace");
      const request = store.get("current");
      request.onsuccess = () => {
        const value = request.result;
        delete value.dataset.shortenerCoverage;
        delete value.report.shortener_coverage;
        store.put(value, "current");
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
    const key = "ummu_url_guard_research_reports";
    const history = JSON.parse(localStorage.getItem(key));
    for (const report of history.reports) delete report.shortener_coverage;
    localStorage.setItem(key, JSON.stringify(history));
  });
  await page.reload();
  await expect(panel.getByRole("row", { name: "Pasangan dievaluasi 2" })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("ummu_url_guard_research_reports")).reports[0].shortener_coverage?.providers?.length,
  )).toBe(shorteners.size);
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Unduh Analisis Pasangan JSON" }).click();
  const exported = await readFile(await (await download).path(), "utf8");
  expect(exported).toContain("Arsip sintetis A");
  expect(exported).not.toContain("private-original");
  expect(exported).not.toContain("private-destination");
}
