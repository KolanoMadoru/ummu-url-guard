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
  await expect(page.locator("#prediction-chart")).toBeVisible();
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
  // Generated synthetic fixture is used only to test plumbing, never as research evidence.
  let csv = "url,label\n";
  for (let i = 0; i < 100; i++)
    csv += `https://group${i}.com/${i % 4 === 0 ? "verify123" : "about"},${i % 4 === 0 ? "phishing" : "benign"}\n`;
  await page
    .locator("#dataset-file")
    .setInputFiles({
      name: "synthetic-test-only.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await page.getByRole("button", { name: "Validasi Dataset" }).click();
  await expect(
    page.getByRole("heading", { name: "Ringkasan Validasi" }),
  ).toBeVisible();
  await nav("Pelatihan Model").click();
  await page
    .getByRole("button", { name: "Mulai Pelatihan & Bandingkan Model" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Perbandingan Model", exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas#roc")).toBeVisible();
  await nav("Eksperimen Fitur").click();
  await page.getByRole("button", { name: "Jalankan Eksperimen A / B" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Enam Model · Satu Partisi Uji yang Sama",
    }),
  ).toBeVisible();
  await nav("Analisis Hasil").click();
  await expect(
    page.getByRole("heading", { name: "Peringkat Fitur" }),
  ).toBeVisible();
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
