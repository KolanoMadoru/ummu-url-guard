import { test, expect } from "@playwright/test";
import { csvOfSize } from "../fixtures/datasets.js";

const fixture = (bytes) => ({
  name: "large-research.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(csvOfSize(bytes).join("")),
});
const nav = (page, name) =>
  page.getByRole("navigation").getByRole("link", { name, exact: true });

test("25 MiB validation stays local, responds to navigation, masks previews, exports and gates full-dataset training", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors = [],
    uploads = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) => {
    if (/\/api\/(train|experiment|dataset\/analyze)/u.test(request.url()))
      uploads.push(request);
  });
  await page.goto("/#dataset");
  await expect(
    page.getByRole("button", { name: "Validasi Dataset" }),
  ).toBeDisabled();
  await page.locator("#dataset-file").setInputFiles(fixture(25 * 1048576));
  await expect(page.locator("#selected-file")).toContainText("25.00 MiB");
  await page.getByRole("button", { name: "Validasi Dataset" }).click();
  await nav(page, "Pelatihan Model").click();
  await expect(page.locator("#dataset-readiness")).toContainText(
    "large-research.csv",
  );
  await nav(page, "Manajemen Dataset").click();
  await expect(page.locator("#dataset-status")).toHaveText("Validasi Berhasil", {
    timeout: 45000,
  });
  await expect(page.locator("#dataset-percent")).toHaveText("100%");
  await expect(page.locator("#dataset-progress-text")).toContainText(
    "51.200 data",
  );
  await expect(page.locator("#dataset-result")).not.toContainText(
    "token=private",
  );
  expect(await page.locator("#preview-rows tbody tr").count()).toBe(10);
  await page.getByRole("button", { name: "Halaman Pratinjau Selanjutnya" }).click();
  await expect(page.locator("#preview-page")).toContainText("Halaman 2 dari 5");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh Ringkasan" }).click();
  expect((await pending).suggestedFilename()).toBe("dataset-summary.json");
  await page.getByRole("link", { name: "Lanjut ke Pelatihan Model" }).click();
  await expect(page.locator("#dataset-readiness")).toContainText(
    "Dataset Besar — Pelatihan Lokal Diperlukan",
  );
  await expect(
    page.getByRole("button", { name: "Mulai Pelatihan & Bandingkan Model" }),
  ).toBeDisabled();
  await nav(page, "Eksperimen Fitur").click();
  await expect(
    page.getByRole("button", { name: "Jalankan Eksperimen A / B" }),
  ).toBeDisabled();
  await expect(page.locator("#selected-file")).toContainText(
    "large-research.csv",
  );
  expect(uploads).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "large-research.csv",
  );
  await page.reload();
  await expect(page.locator("#selected-file")).toContainText(
    "Pilih ulang file setelah memuat ulang halaman",
  );
  expect(errors).toEqual([]);
});

test("cancel, reset, drag/drop and reselection work without stale worker results", async ({
  page,
}) => {
  await page.goto("/#dataset");
  await page.locator("#dataset-file").setInputFiles(fixture(25 * 1048576));
  await page.getByRole("button", { name: "Validasi Dataset" }).click();
  await page.getByRole("button", { name: "Batalkan Pemrosesan" }).click();
  await expect(page.locator("#dataset-status")).toHaveText(
    "Pemrosesan Dibatalkan",
  );
  await expect(
    page.getByRole("button", { name: "Unduh Ringkasan" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Atur Ulang Dataset" }).click();
  await expect(page.locator("#dataset-status")).toHaveText("Belum Ada File Terpilih");
  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["url,label\nhttps://small.com,0"], "dropped.csv", {
        type: "text/csv",
      }),
    );
    return transfer;
  });
  await page
    .locator("#dataset-drop")
    .dispatchEvent("drop", { dataTransfer: data });
  await expect(page.locator("#selected-file")).toContainText("dropped.csv");
  await page.getByRole("button", { name: "Validasi Dataset" }).click();
  await expect(page.locator("#dataset-status")).toHaveText("Validasi Berhasil");
  await page.locator("#dataset-file").setInputFiles(fixture(3 * 1048576));
  await expect(page.locator("#dataset-status")).toHaveText("File Terpilih");
  await page.getByRole("button", { name: "Validasi Dataset" }).click();
  await expect(page.locator("#dataset-status")).toHaveText("Validasi Berhasil");
  await expect(page.locator("#dataset-progress-text")).toContainText(
    "6.144 data",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    )
    .toBe(false);
});

test("Python verification handles provider plaintext 413 without a JSON parsing error", async ({
  page,
}) => {
  await page.route("**/api/dataset/analyze", (route) =>
    route.fulfill({
      status: 413,
      contentType: "text/plain",
      body: "Request Entity Too Large",
    }),
  );
  await page.goto("/#dataset");
  await page
    .locator("#dataset-file")
    .setInputFiles({
      name: "small.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("url,label\nhttps://example.com,0"),
    });
  await page.getByRole("button", { name: "Validasi Dataset" }).click();
  await expect(page.locator("#dataset-status")).toHaveText("Validasi Berhasil");
  await page
    .getByRole("button", { name: "Verifikasi Dataset Kecil dengan Python" })
    .click();
  await expect(page.locator("#dataset-error")).toContainText(
    "Ukuran permintaan melebihi batas server",
  );
  await expect(page.locator("#dataset-error")).not.toContainText(
    "Unexpected token",
  );
});
