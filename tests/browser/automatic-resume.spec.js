import { test, expect } from "@playwright/test";

test("resumes after an interrupted fit and restores the E2 scanner after reload", async ({ page, context }) => {
  const calls = [];
  let failE3 = true;
  await context.route("**/api/research/train/*", (route) => {
    const configuration = route.request().url().split("/").at(-1);
    calls.push(configuration);
    if (configuration === "E3" && failE3) return route.abort("failed");
    return route.continue();
  });
  const lines = Array.from({ length: 60 }, (_, i) => {
    const label = i % 2;
    return `https://synthetic-${i}.example/${label ? "example-verify" : "example-docs"},${label}`;
  });
  await page.goto("/#dataset");
  await page.locator("#dataset-file").setInputFiles({
    name: "synthetic-resume.csv", mimeType: "text/csv",
    buffer: Buffer.from(`url,label\n${lines.join("\n")}\n`),
  });
  const run = page.locator("[data-research-automatic]");
  await run.click();
  await expect(page.locator("[data-research-error]").first()).toContainText("Koneksi ke API terputus");
  expect(calls).toEqual(["E1", "E2", "E3"]);

  failE3 = false;
  await page.reload();
  await expect(page.locator("#selected-file")).toContainText("synthetic-resume.csv");
  await run.click();
  await expect(page.locator("[data-research-status]").first()).toContainText("Penelitian Selesai");
  expect(calls).toEqual(["E1", "E2", "E3", "E3", "E4", "E5", "E6"]);

  await page.reload();
  await page.getByRole("link", { name: "Pemindai URL" }).click();
  const destinationUrl = "https://synthetic-0.example/example-docs";
  await page.locator("#scan-url").fill(destinationUrl);
  await page.locator("#scan-button").click();
  await expect(page.locator("#scan-result")).toContainText("Random Forest · 19 fitur");
  await expect(page.locator("#scan-result")).toContainText("Skor belum dikalibrasi");
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem("ummu_url_guard_history")));
  expect(history[0].prediction).toMatch(/^(benign|phishing)$/);
  expect(history[0].model_version).toMatch(/^[0-9a-f-]{36}$/);
  expect(history[0].url).toBe("https://synthetic-0.example/…");

  // Keep the real restored E2 model and real lexical extraction. Mock only the observed redirect.
  const shortUrl = "https://tinyurl.com/synthetic-fixture";
  const lexical = await Promise.all([shortUrl, destinationUrl].map(async (url) => {
    const response = await page.request.post("/api/features", { data: { url } });
    expect(response.ok()).toBe(true);
    return response.json();
  }));
  const scanRequests = [];
  await page.route("**/api/scan", (route) => {
    scanRequests.push(route.request().postDataJSON());
    return route.fulfill({ json: {
      ...lexical[0], initial_url: shortUrl, id: "test-redirect-e2",
      timestamp: "2026-01-01T00:00:00Z", prediction_target: "destination",
      destination: { ...lexical[1], available: false },
      online: {
        status: "complete", resolution_status: "RESOLVED", destination_confirmed: true,
        final_url: destinationUrl, final_domain: "synthetic-0.example",
        redirect_count: 1, http_status: 200,
        redirect_chain: [
          { url: shortUrl, status: 302, method: "GET" },
          { url: destinationUrl, status: 200, method: "GET" },
        ],
      },
    } });
  });
  await page.locator("#scan-url").fill(shortUrl);
  await page.locator("#scan-button").click();
  await expect(page.locator("#redirect-result")).toContainText(destinationUrl);
  expect(scanRequests).toEqual([{ url: shortUrl, check_redirect: true }]);
  const resolved = await page.evaluate(() => JSON.parse(localStorage.getItem("ummu_url_guard_history"))[0]);
  expect(resolved).toMatchObject({
    id: "test-redirect-e2", prediction_source: "destination", final_url: "https://synthetic-0.example/…",
    prediction: history[0].prediction, probability: history[0].probability,
    model_version: history[0].model_version,
  });
});
