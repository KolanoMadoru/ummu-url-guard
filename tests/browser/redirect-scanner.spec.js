import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const shortURL = "https://bit.ly/example-token";
const destinationURL = "https://example.com/landing?example=1";

let origin, target, homepage;

test.beforeAll(() => {
  const script = "import json, sys; from ml.features import extract_features; print(json.dumps([extract_features(url) for url in sys.argv[1:]]))";
  [origin, target, homepage] = JSON.parse(execFileSync("python", ["-c", script, shortURL, destinationURL, "https://bit.ly/"], {
    encoding: "utf8", timeout: 10000,
  }));
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({ json: { status: "ok" } }));
});

function network(status, reason, details = {}) {
  return { status, reason, final_url: null, chain: [], redirect_count: 0, ...details };
}

function initialResult(features, url, online) {
  return {
    ...features,
    initial_url: url,
    basic_features: ["url_length", "domain_length", "digit_count", "dot_count", "hyphen_count", "special_count", "subdomain_count"],
    id: "fixture-redirect",
    timestamp: "2026-11-16T00:00:00Z",
    available: true,
    prediction: "benign",
    probability: 0.1,
    model_version: "fixture-model",
    probability_label: "Uncalibrated model estimate for phishing, not a safety guarantee",
    destination: null,
    online,
  };
}

async function scan(page, url) {
  await page.goto("/#scanner");
  await page.getByLabel("Masukkan URL").fill(url);
  await page.getByRole("button", { name: "Pindai URL", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Prediksi Aman (benign)", exact: true })).toBeVisible();
}

test("checks the destination only on request and compares both lexical representations", async ({ page }) => {
  const calls = [];
  await page.route("**/api/scan", (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    const value = initialResult(origin, shortURL, network("not_requested", null));
    if (body.check_redirect) {
      value.destination = {
        ...target,
        available: true,
        prediction: "phishing",
        probability: 0.92,
        model_version: "fixture-model",
        probability_label: value.probability_label,
      };
      value.online = network("complete", null, {
        final_url: destinationURL,
        redirect_count: 1,
        http_status: 200,
        chain: [{ url: shortURL, status: 302 }, { url: destinationURL, status: 200 }],
      });
    }
    return route.fulfill({ json: value });
  });

  await scan(page, shortURL);
  expect(calls).toEqual([{ url: shortURL }]);
  const redirect = page.locator("#redirect-result");
  await expect(redirect).toContainText("URL tujuan tidak tersedia");
  const features = page.locator("#scan-features");
  await expect(features.locator("tbody tr")).toHaveCount(19);
  await expect(features.getByRole("cell", { name: "Dasar + lengkap", exact: true })).toHaveCount(7);
  const lengths = features.getByRole("row", { name: /^Panjang URL/ }).getByRole("cell");
  await expect(lengths.nth(2)).toHaveText(String(shortURL.length));
  await expect(lengths.nth(3)).toHaveText("N/A (tidak tersedia)");

  await page.getByRole("button", { name: "Periksa Tujuan Redirect" }).click();
  await expect(redirect).toContainText(destinationURL);
  await expect(redirect.getByRole("row", { name: /Prediksi URL Tujuan/ })).toContainText("Phishing");
  await expect(redirect).toContainText("fixture-model");
  await expect(redirect).toContainText("Tujuan diamati saat pemindaian ini.");
  await expect(lengths.nth(3)).toHaveText(String(destinationURL.length));
  await expect(page.locator("#scan-result a")).toHaveCount(0);
  expect(calls).toEqual([{ url: shortURL }, { url: shortURL, check_redirect: true }]);

  const history = await page.evaluate(() => JSON.parse(localStorage.getItem("ummu_url_guard_history")));
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ url: "https://bit.ly/…", final_url: "https://example.com/…", redirects: 1 });
  expect(JSON.stringify(history)).not.toContain("example-token");
  expect(JSON.stringify(history)).not.toContain("landing");
});

test("keeps initial lexical features through a blocked destination and timeout", async ({ page }) => {
  let redirects = 0;
  await page.route("**/api/scan", (route) => {
    const body = route.request().postDataJSON();
    if (!body.check_redirect) {
      return route.fulfill({ json: initialResult(origin, shortURL, network("not_requested", null)) });
    }
    if (++redirects === 2) {
      return route.fulfill({ status: 504, json: { detail: "Synthetic gateway timeout" } });
    }
    return route.fulfill({
      json: initialResult(origin, shortURL, network("unavailable", "A DNS address is not a public unicast IP; target blocked.")),
    });
  });

  await scan(page, shortURL);
  const button = page.getByRole("button", { name: "Periksa Tujuan Redirect" });
  const redirect = page.locator("#redirect-result");
  await button.click();
  await expect(redirect).toContainText("tujuan diblokir");
  await button.click();
  await expect(redirect).toContainText("Pemeriksaan redirect melebihi batas waktu.");
  await expect(redirect).toContainText("URL tujuan tidak tersedia");
  await expect(page.locator("#scan-features").getByRole("row", { name: /^Panjang URL/ }).getByRole("cell").nth(2))
    .toHaveText(String(shortURL.length));
  await expect(page.getByRole("heading", { name: "Prediksi Aman (benign)", exact: true })).toBeVisible();
});

test("labels a shortener homepage and keeps lexical analysis available when redirect checks are disabled", async ({ page }) => {
  const calls = [];
  await page.route("**/api/scan", (route) => {
    const { url } = route.request().postDataJSON();
    calls.push(url);
    const online = network("disabled", "Online checking is disabled by environment configuration.");
    return route.fulfill({ json: initialResult(url === shortURL ? origin : homepage, url, online) });
  });

  await scan(page, "https://bit.ly/");
  await expect(page.locator("#scan-result")).toContainText("bit.ly (halaman tanpa token tautan)");
  await expect(page.getByRole("button", { name: "Periksa Tujuan Redirect" })).toHaveCount(0);
  await page.getByLabel("Masukkan URL").fill(shortURL);
  await page.getByRole("button", { name: "Pindai URL", exact: true }).click();
  await expect(page.getByRole("button", { name: "Periksa Tujuan Redirect" })).toBeDisabled();
  await expect(page.locator("#redirect-result")).toContainText("Pemeriksaan jaringan dinonaktifkan oleh konfigurasi lingkungan.");
  await expect(page.locator("#scan-features")).toContainText("Panjang URL");
  expect(calls).toEqual(["https://bit.ly/", shortURL]);
});
