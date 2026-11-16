import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const title = "Deteksi Phishing pada URL Pendek dan Domain Typosquatting";
const footer = "Dibuat oleh Muhammad Rahman Muttaqin | NPM: 12105 55201 21 162";
const pages = [
  ["dashboard", "Dasbor", title],
  ["scanner", "Pemindai URL"],
  ["dataset", "Manajemen Dataset"],
  ["features", "Ekstraksi Fitur"],
  ["training", "Pelatihan Model"],
  ["evaluation", "Evaluasi Model"],
  ["experiments", "Eksperimen Fitur"],
  ["analysis", "Analisis Hasil"],
  ["history", "Riwayat Deteksi"],
];

for (const width of [1280, 390, 320]) {
  test(`Indonesian identity, all nine pages and footer at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await expect(page).toHaveTitle("UMMU URL GUARD");
    for (const [route, label, heading = label] of pages) {
      if (width < 760) await page.getByRole("button", { name: "Buka atau tutup navigasi" }).click();
      await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#${route}$`));
      await expect(page.locator("main h1")).toHaveText(heading);
      await expect(page.locator("footer")).toHaveCount(1);
      await expect(page.locator("footer")).toHaveText(footer);
      await expect(page.locator("body")).not.toContainText(/Research Workspace|No data available|No results yet|Start Training|Connecting API/i);
      expect(await page.evaluate(() => {
        const main = document.querySelector("main").getBoundingClientRect();
        const footer = document.querySelector("footer").getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth, overlaps: footer.top < main.bottom };
      })).toEqual({ overflow: false, overlaps: false });
    }
    expect(errors).toEqual([]);
  });
}

test("existing history keeps internal labels and export schema while displaying Indonesian", async ({ page }) => {
  const record = {
    id: "existing-record", url: "https://example.com/…", final_url: null,
    prediction: "benign", probability: 0.1, online_status: "disabled", redirects: 0,
    timestamp: "2026-11-16T00:00:00Z", model_version: "trusted-v1", shortener: false, typosquatting: false,
  };
  await page.goto("/");
  await page.evaluate((record) => localStorage.setItem("ummu_url_guard_history", JSON.stringify([record])), record);
  await page.goto("/#history");
  await expect(page.locator("#history-table")).toContainText("Aman (benign)");
  await expect(page.locator("#history-table")).toContainText("Dinonaktifkan");
  await page.locator("#history-filter").selectOption("benign");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ekspor JSON", exact: true }).click();
  const contents = JSON.parse(await readFile(await (await download).path(), "utf8"));
  expect(contents).toEqual([record]);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Konfirmasi Penghapusan: hapus semua riwayat deteksi dari browser ini?");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Hapus Semua" }).click();
  await expect(page.locator("#history-table")).toContainText("Belum ada riwayat yang sesuai.");
});

test("CSV issues are translated only in the UI, retaining original download fields and values", async ({ page }) => {
  await page.goto("/#dataset");
  await page.locator("#dataset-file").setInputFiles({
    name: "invalid.csv", mimeType: "text/csv",
    buffer: Buffer.from("url,label\nhttps://example.com,0\nhttps://example.com,1\nhttps://other.com,unknown\n,1"),
  });
  await page.getByRole("button", { name: "Validasi Dataset", exact: true }).click();
  await expect(page.locator("#dataset-status")).toHaveText("Validasi Gagal");
  await expect(page.locator("#dataset-result")).toContainText("Label bertentangan");
  await expect(page.locator("#dataset-result")).toContainText("Label tidak valid; gunakan benign=0 atau phishing=1");
  await expect(page.locator("#dataset-result")).toContainText("URL kosong");
  await expect(page.locator("#dataset-result")).not.toContainText(/Conflicting labels|Invalid label|Missing URL|Valid records exclude/);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh Ringkasan" }).click();
  const summary = JSON.parse(await readFile(await (await download).path(), "utf8"));
  expect(summary.validation_status).toBe("Validation Failed");
  expect(summary.preview[0].label).toBe("benign");
  expect(summary.errors.some((e) => e.message === "Missing URL")).toBe(true);
});

test("API field errors, network failures and invalid JSON use Indonesian diagnostic messages", async ({ page }) => {
  await page.route("**/api/features", (route) => route.fulfill({
    status: 422, contentType: "application/json",
    body: JSON.stringify({ detail: [{ loc: ["body", "url"], msg: "Field required" }] }),
  }));
  await page.goto("/#features");
  await page.locator("#feature-url").fill("https://example.com");
  await page.getByRole("button", { name: "Ekstraksi Fitur", exact: true }).click();
  await expect(page.locator("#feature-error")).toHaveText("body.url: Kolom wajib diisi");
  await page.unroute("**/api/features");
  await page.route("**/api/features", (route) => route.abort());
  await page.getByRole("button", { name: "Ekstraksi Fitur", exact: true }).click();
  await expect(page.locator("#feature-error")).toHaveText("Terjadi Kesalahan Jaringan. Periksa koneksi dan ketersediaan backend.");
  await page.goto("/#evaluation");
  await page.locator("#evaluation-file").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{broken") });
  await page.getByRole("button", { name: "Evaluasi Prediksi", exact: true }).click();
  await expect(page.locator("#evaluation-error")).toHaveText("JSON tidak valid. Periksa sintaks file prediksi.");
});

test("scanner prediction labels and backend rejection are localized without changing saved model values", async ({ page, request }) => {
  const response = await request.post("http://127.0.0.1:8000/api/features", { data: { url: "https://gooogle.com/login" } });
  expect(response.ok()).toBe(true);
  const features = await response.json();
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      ...features, id: "localized-scan", prediction: "benign", probability: 0.1,
      model_version: "fixture-only", timestamp: "2026-11-16T00:00:00Z",
      probability_label: "Uncalibrated model estimate for phishing, not a safety guarantee",
      online: { status: "unavailable", reason: "DNS resolution failed.", final_url: null, http_status: null, redirect_count: 0, chain: [] },
    }),
  }));
  await page.goto("/#scanner");
  await page.getByLabel("Masukkan URL").fill("https://gooogle.com/login");
  await page.getByRole("button", { name: "Pindai URL", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Prediksi Aman (benign)", exact: true })).toBeVisible();
  await expect(page.locator("#scan-result")).toContainText("Resolusi DNS gagal.");
  await expect(page.locator("#scan-result")).toContainText("Estimasi model untuk phishing belum dikalibrasi dan bukan jaminan keamanan");
  await expect(page.locator("#scan-result")).toContainText("Panjang URL");
  await expect(page.locator("#scan-result")).not.toContainText(/Characters in|Uncalibrated model|DNS resolution|insertion/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ummu_url_guard_history"))[0]);
  expect(stored.prediction).toBe("benign");
  expect(stored.probability).toBe(0.1);
  expect(stored.online_status).toBe("unavailable");
  await page.unroute("**/api/scan");
  await page.getByLabel("Masukkan URL").fill("https://user:password@example.com");
  await page.getByRole("button", { name: "Pindai URL", exact: true }).click();
  await expect(page.locator("#scan-error")).toHaveText("URL Tidak Valid: Kredensial dalam URL tidak diperbolehkan.");
});
