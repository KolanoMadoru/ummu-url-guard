import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { csvOfSize } from "../fixtures/datasets.js";

const suiteStatus = (page) => page.locator("[data-research-status]");
const action = (page, name) => page.getByRole("button", { name, exact: true });
const nav = (page, name) =>
  page.getByRole("navigation").getByRole("link", { name, exact: true });

test("one CSV over 2 MiB uses feature batches and lets the user process individual stages", async ({ page }) => {
  const posts = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.goto("/#dataset");
  await expect(action(page, "Jalankan Penelitian Otomatis")).toBeDisabled();
  const buffer = Buffer.from(csvOfSize(3 * 1024 * 1024, 2800).join("")
    .replaceAll(",benign,", ",0     ,").replaceAll(",phishing,", ",1       ,"));
  await page.locator("#dataset-file").setInputFiles({
    name: "synthetic-large.csv", mimeType: "text/csv", buffer,
  });
  await expect(page.locator("#selected-file")).toContainText(/3[.,]00 MiB/);
  await page.getByText("Jalankan per Tahap", { exact: true }).click();
  await expect(action(page, "Audit dan Buat Split")).toBeDisabled();
  await action(page, "Proses Dataset").click();
  await nav(page, "Pelatihan Model").click();
  await expect(page.locator("#selected-file")).toContainText("synthetic-large.csv");
  await expect(action(page, "Latih Enam Eksperimen")).toBeDisabled();
  await nav(page, "Manajemen Dataset").click();
  await expect(page.getByRole("heading", { name: "Ringkasan Dataset" })).toBeVisible({ timeout: 45000 });
  await expect(page.locator("#dataset-result")).not.toContainText("token=private");
  await expect(page.locator("#preview-rows tbody tr")).toHaveCount(10);
  await action(page, "Halaman Selanjutnya").click();
  await expect(page.locator("#preview-page")).toHaveText("Halaman 2 dari 2");
  await expect(action(page, "Halaman Selanjutnya")).toBeDisabled();
  await page.getByText("Jalankan per Tahap", { exact: true }).click();
  await action(page, "Audit dan Buat Split").click();
  await expect(page.getByRole("heading", { name: "Pembagian Dataset" })).toBeVisible();
  await expect(page.locator("#dataset-result").getByRole("row", { name: /Pelatihan.*Melatih model/ })).toBeVisible();
  await action(page, "Ekstrak Fitur Dataset").click();
  const filename = page.waitForEvent("download");
  await action(page, "Unduh 7 Fitur Dasar").click();
  const result = await filename;
  expect(result.suggestedFilename()).toBe("fitur-dasar.csv");
  const contents = await readFile(await result.path(), "utf8");
  expect(contents.split("\r\n")).toHaveLength(2801);
  expect(contents.split("\r\n", 1)[0].split(",")).toHaveLength(10);
  expect(contents).not.toContain("https://");
  expect(posts.filter((url) => url.includes("/api/research/features")).length).toBeGreaterThan(1);
  expect(posts.every((url) => url.includes("/api/research/features"))).toBe(true);
  await page.reload();
  await expect(page.locator("#selected-file")).toContainText("synthetic-large.csv");
  await expect(action(page, "Unduh 19 Fitur Lengkap")).toBeEnabled();
});

test("drag and drop with UTF-8 BOM accepts quoted URLs and ignores extra columns", async ({ page }) => {
  await page.goto("/#dataset");
  await page.getByText("Jalankan per Tahap", { exact: true }).click();
  const drop = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File([
      '\ufeffurl,label,split_final\r\n"https://sample.example/about?token=a,b",0,unrecognized\r\n',
    ], "synthetic-dropped.csv", { type: "text/csv" }));
    return data;
  });
  await page.locator("#dataset-drop").dispatchEvent("drop", { dataTransfer: drop });
  await expect(page.locator("#selected-file")).toContainText("synthetic-dropped.csv");
  await action(page, "Proses Dataset").click();
  await expect(suiteStatus(page)).toContainText("Tahap Berhasil");
  await expect(page.getByRole("row", { name: "Data Valid untuk Eksperimen 1" })).toBeVisible();
  await expect(page.locator("#preview-rows")).toContainText("Aman (benign)");
  await expect(page.locator("#preview-rows")).not.toContainText("token");
  await action(page, "Atur Ulang Dataset").click();
  await expect(suiteStatus(page)).toHaveText("Belum Dimulai");
  await expect(action(page, "Jalankan Penelitian Otomatis")).toBeDisabled();
});
