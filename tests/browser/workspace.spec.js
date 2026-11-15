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
  await expect(page.getByText("Python API connected")).toBeVisible();
  const nav = (name) =>
    page.getByRole("navigation").getByRole("link", { name, exact: true });
  for (const name of [
    "Dashboard",
    "URL Scanner",
    "Dataset Management",
    "Feature Extraction",
    "Model Training",
    "Model Evaluation",
    "Feature Experiment",
    "Result Analysis",
    "Detection History",
  ]) {
    await nav(name).click();
    await expect(page.locator("h1")).toBeVisible();
  }
  await nav("Feature Extraction").click();
  await page
    .getByLabel("URL", { exact: true })
    .fill("https://gooogle.com/login?token=private");
  await page.getByRole("button", { name: "Extract features" }).click();
  await expect(page.getByText("Schema: lexical-v1")).toBeVisible();
  await nav("URL Scanner").click();
  await page
    .getByLabel("URL to analyze")
    .fill("http://127.0.0.1/secret?token=private");
  await page.getByRole("button", { name: "Scan URL", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Prediction unavailable — model not trained",
    }),
  ).toBeVisible();
  const history = await page.evaluate(() =>
    localStorage.getItem("ummu_url_guard_history"),
  );
  expect(history).not.toContain("private");
  expect(history).not.toContain("secret");
  await nav("Dashboard").click();
  await expect(page.locator("#prediction-chart")).toBeVisible();
  await nav("Detection History").click();
  await page.getByRole("searchbox").fill("not-present");
  await expect(page.getByText("No matching scans.")).toBeVisible();
  await page.getByRole("searchbox").fill("127.0.0.1");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("masked-history.csv");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No matching scans.")).toBeVisible();
  await nav("Dataset Management").click();
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
  await page.getByRole("button", { name: "Validate dataset" }).click();
  await expect(
    page.getByRole("heading", { name: "Validation summary" }),
  ).toBeVisible();
  await nav("Model Training").click();
  await page
    .getByRole("button", { name: "Start Training & Compare Models" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Model comparison", exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas#roc")).toBeVisible();
  await nav("Feature Experiment").click();
  await page.getByRole("button", { name: "Run A / B experiment" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Six models · one common test partition",
    }),
  ).toBeVisible();
  await nav("Result Analysis").click();
  await expect(
    page.getByRole("heading", { name: "Feature ranking" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#dashboard");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await nav("URL Scanner").click();
  await expect(page.getByLabel("URL to analyze")).toBeVisible();
  expect(errors).toEqual([]);
});
