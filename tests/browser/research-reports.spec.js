import { test, expect } from "@playwright/test";
import { researchReport } from "../fixtures/research-report.js";

test("master validation shows split conflicts without enabling online training", async ({ page }) => {
  await page.goto("/#dataset");
  await page.locator("#dataset-file").setInputFiles({
    name: "synthetic-master.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("url,label,split,split_final,kategori_audit\nhttps://sample.example/about,0,train,test,biasa_0\n"),
  });
  await page.getByRole("button", { name: "Validasi Dataset", exact: true }).click();
  await expect(page.locator("#dataset-status")).toHaveText("Validasi Gagal");
  await expect(page.getByRole("row", { name: "Konflik antara split dan split_final 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Verifikasi Dataset Kecil dengan Python" })).toBeDisabled();
  const master = ["url,label,split,kategori_audit"];
  for (let i = 0; i < 36; i++) {
    const split = ["train", "validation", "test"][i % 3];
    master.push(`https://sample-${i}.example/about,${i % 2},${split},biasa_${i % 2}`);
  }
  await page.locator("#dataset-file").setInputFiles({
    name: "synthetic-master-valid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(master.join("\n")),
  });
  await page.getByRole("button", { name: "Validasi Dataset", exact: true }).click();
  await expect(page.locator("#dataset-eligibility")).toContainText("36 data valid");
  await expect(page.getByRole("button", { name: "Verifikasi Dataset Kecil dengan Python" })).toBeDisabled();
  await page.goto("/#training");
  await expect(page.locator("#dataset-readiness")).toContainText("Jalankan alur penelitian lokal");
  await expect(page.getByRole("button", { name: "Mulai Pelatihan & Bandingkan Model" })).toBeDisabled();
});

test("import shows aggregate results after refresh and rejects unsafe fields", async ({ page }) => {
  await page.goto("/#dataset");
  const report = researchReport();
  report.selected_configuration_id = "E3";
  report.audit.coverage = { url_tujuan_terverifikasi: 2 };
  report.sources['<img src=x onerror="window.fixtureExecuted=true">'] = 100;
  report.results[0].errors = [{ url: "https://example.test/sensitive?token=private" }];
  await page.getByLabel("Pilih Ringkasan Penelitian JSON").setInputFiles({
    name: "research-summary.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(report)),
  });
  await expect(page.locator("#research-import-status")).toHaveText("Ringkasan penelitian berhasil diimpor.");
  await page.getByRole("link", { name: "Lihat Evaluasi Penelitian" }).click();
  await expect(page.getByRole("heading", { name: "Evaluasi Penelitian Lokal" })).toBeVisible();
  await expect(page.getByText("Konfigurasi terpilih berdasarkan data validasi")).toContainText("E3");
  await page.getByText("Partisi Data dan Cakupan Audit").click();
  await expect(page.getByRole("row", { name: "URL tujuan tercatat 2" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "URL biasa" })).toHaveCount(6);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Evaluasi Penelitian Lokal" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ekspor Metrik Penelitian CSV" }).click();
  expect((await download).suggestedFilename()).toBe("research-metrics.csv");
  await page.goto("/#dashboard");
  await expect(page.getByRole("heading", { name: "Dataset Eksperimen Lokal" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Synthetic", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.fixtureExecuted)).toBeUndefined();
  const persisted = await page.evaluate(() => localStorage.getItem("ummu_url_guard_research_reports"));
  expect(persisted).not.toContain("token=private");
  expect(persisted).not.toContain("onerror");
  await page.goto("/#analysis");
  await expect(page.locator("#research-f1")).toBeVisible();
  await page.goto("/#dataset");
  await page.getByRole("button", { name: "Hapus Ringkasan dari Browser" }).click();
  await page.reload();
  await expect(page.getByLabel("Ringkasan Eksperimen yang Ditampilkan")).toHaveCount(0);
});
