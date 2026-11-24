import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("research workflow, private history, charts and mobile navigation", async ({
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
  const rows = ["url,label"];
  for (let i = 0; i < 100; i++) {
    rows.push(`https://group${i}.example/about,0`);
    rows.push(`https://login.group${i}.example/verify?name=private,1`);
  }
  rows.push("https://group0.example/about,0");
  await page.locator("#dataset-file").setInputFiles({
    name: "synthetic-test-only.csv", mimeType: "text/csv",
    buffer: Buffer.from(rows.join("\n")),
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
  expect(report.rows).toBe(200);
  expect(report.scenario_kind).toBe("heuristic");
  expect(report.results).toHaveLength(6);
  expect(report.experiments.every((model) => model.test_predictions.length === report.split.test.rows)).toBe(true);
  expect(report.results.every((model) => model.metrics.confusion_matrix.flat().reduce((a, b) => a + b) === report.split.test.rows)).toBe(true);
  await nav("Evaluasi Model").click();
  await expect(page.getByRole("heading", { name: "Evaluasi Penelitian", exact: true })).toBeVisible();
  await expect(page.getByText("Skor Pembanding pada Data Validasi")).toBeVisible();
  await expect(page.getByText("Subset dibentuk dari ciri URL.", { exact: false })).toBeVisible();
  await page.reload();
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
