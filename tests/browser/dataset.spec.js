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
    page.getByRole("button", { name: "Validate dataset" }),
  ).toBeDisabled();
  await page.locator("#dataset-file").setInputFiles(fixture(25 * 1048576));
  await expect(page.locator("#selected-file")).toContainText("25.00 MiB");
  await page.getByRole("button", { name: "Validate dataset" }).click();
  await nav(page, "Model Training").click();
  await expect(page.locator("#dataset-readiness")).toContainText(
    "large-research.csv",
  );
  await nav(page, "Dataset Management").click();
  await expect(page.locator("#dataset-status")).toHaveText("Validated", {
    timeout: 45000,
  });
  await expect(page.locator("#dataset-percent")).toHaveText("100%");
  await expect(page.locator("#dataset-progress-text")).toContainText(
    "51,200 records",
  );
  await expect(page.locator("#dataset-result")).not.toContainText(
    "token=private",
  );
  expect(await page.locator("#preview-rows tbody tr").count()).toBe(10);
  await page.getByRole("button", { name: "Next preview page" }).click();
  await expect(page.locator("#preview-page")).toContainText("Page 2 of 5");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Summary" }).click();
  expect((await pending).suggestedFilename()).toBe("dataset-summary.json");
  await page.getByRole("link", { name: "Continue to Model Training" }).click();
  await expect(page.locator("#dataset-readiness")).toContainText(
    "Large Dataset — Local Training Required",
  );
  await expect(
    page.getByRole("button", { name: "Start Training & Compare Models" }),
  ).toBeDisabled();
  await nav(page, "Feature Experiment").click();
  await expect(
    page.getByRole("button", { name: "Run A / B experiment" }),
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
    "Select the file again after a refresh",
  );
  expect(errors).toEqual([]);
});

test("cancel, reset, drag/drop and reselection work without stale worker results", async ({
  page,
}) => {
  await page.goto("/#dataset");
  await page.locator("#dataset-file").setInputFiles(fixture(25 * 1048576));
  await page.getByRole("button", { name: "Validate dataset" }).click();
  await page.getByRole("button", { name: "Cancel Processing" }).click();
  await expect(page.locator("#dataset-status")).toHaveText(
    "Processing Cancelled",
  );
  await expect(
    page.getByRole("button", { name: "Download Summary" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Reset Dataset" }).click();
  await expect(page.locator("#dataset-status")).toHaveText("No File Selected");
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
  await page.getByRole("button", { name: "Validate dataset" }).click();
  await expect(page.locator("#dataset-status")).toHaveText("Validated");
  await page.locator("#dataset-file").setInputFiles(fixture(3 * 1048576));
  await expect(page.locator("#dataset-status")).toHaveText("File Selected");
  await page.getByRole("button", { name: "Validate dataset" }).click();
  await expect(page.locator("#dataset-status")).toHaveText("Validated");
  await expect(page.locator("#dataset-progress-text")).toContainText(
    "6,144 records",
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
  await page.getByRole("button", { name: "Validate dataset" }).click();
  await expect(page.locator("#dataset-status")).toHaveText("Validated");
  await page
    .getByRole("button", { name: "Verify small dataset with Python" })
    .click();
  await expect(page.locator("#dataset-error")).toContainText(
    "Ukuran request melebihi batas server",
  );
  await expect(page.locator("#dataset-error")).not.toContainText(
    "Unexpected token",
  );
});
