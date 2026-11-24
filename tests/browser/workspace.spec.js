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
  await expect(page.getByText("Skema: lexical-v2")).toBeVisible();
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
    for (const index of [0, 1, 2, 3])
      urls.push({ url: `https://${host}/synthetic-${index}?token=private-original`, label: index % 2 });
  urls.push(urls[0]);
  await page.locator("#dataset-file").setInputFiles({
    name: "synthetic-test-only.csv", mimeType: "text/csv",
    buffer: Buffer.from(Papa.unparse(urls)),
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
  const reportReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh Laporan Penelitian", exact: true }).click();
  const report = JSON.parse(await readFile(await (await reportReady).path(), "utf8"));
  expect(report.rows).toBe(urls.length - 1);
  expect(report.scenario_kind).toBe("heuristic");
  expect(report.results).toHaveLength(6);
  expect(report.experiments.every((model) => model.test_predictions.length === report.split.test.rows)).toBe(true);
  expect(report.results.every((model) => model.metrics.confusion_matrix.flat().reduce((a, b) => a + b) === report.split.test.rows)).toBe(true);
  await checkHistoricalRedirects(page, urls);
  await expect(page.getByRole("heading", { name: "Evaluasi Penelitian", exact: true })).toBeVisible();
  await expect(page.getByText("Skor Pembanding pada Data Validasi")).toBeVisible();
  await expect(page.getByText("Subset dibentuk dari ciri URL.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evaluasi Penelitian", exact: true })).toBeVisible();
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

  await page.reload();
  await expect(panel.getByRole("row", { name: "Pasangan dievaluasi 2" })).toBeVisible();
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Unduh Analisis Pasangan JSON" }).click();
  const exported = await readFile(await (await download).path(), "utf8");
  expect(exported).toContain("Arsip sintetis A");
  expect(exported).not.toContain("private-original");
  expect(exported).not.toContain("private-destination");
}
