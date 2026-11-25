import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const shortURL = "https://bit.ly/example-token";
const destinationURL = "https://example.com/landing?example=1";
const unrecognizedURL = "https://short.example/s/42";

let origin, target, homepage, unrecognized;

test.beforeAll(() => {
  const script = "import json, sys; from ml.features import extract_features; print(json.dumps([extract_features(url) for url in sys.argv[1:]]))";
  [origin, target, homepage, unrecognized] = JSON.parse(execFileSync("python", ["-c", script, shortURL, destinationURL, "https://bit.ly/", unrecognizedURL], {
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

async function scan(page, url, expected = "Prediksi menunggu URL tujuan") {
  await page.goto("/#scanner");
  await page.getByLabel("Masukkan URL").fill(url);
  await page.getByRole("button", { name: "Pindai URL", exact: true }).click();
  await expect(page.getByRole("heading", { name: expected, exact: true })).toBeVisible();
}

function scanHistory(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("ummu_url_guard_history")));
}

async function expectPendingHistory(page) {
  expect(await scanHistory(page)).toMatchObject([{
    id: "fixture-redirect",
    url: "https://bit.ly/…",
    final_url: null,
    prediction: null,
    probability: null,
    model_version: null,
    prediction_source: null,
  }]);
}

function confirmedDestination(value) {
  value.destination = {
    ...target,
    available: true,
    prediction: "phishing",
    probability: 0.92,
    model_version: "destination-fixture-model",
    probability_label: value.probability_label,
  };
  value.online = network("complete", null, {
    resolution_status: "RESOLVED",
    destination_confirmed: true,
    final_url: destinationURL,
    redirect_count: 1,
    http_status: 200,
    chain: [{ url: shortURL, method: "GET", status: 302 }, { url: destinationURL, method: "HEAD", status: 200 }],
  });
}

test("predicts from the confirmed destination only and compares both lexical representations", async ({ page }) => {
  const calls = [];
  await page.route("**/api/scan", (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    const value = initialResult(origin, shortURL, network("not_requested", null));
    if (body.check_redirect) confirmedDestination(value);
    return route.fulfill({ json: value });
  });

  await scan(page, shortURL);
  expect(calls).toEqual([{ url: shortURL }]);
  await expectPendingHistory(page);
  const redirect = page.locator("#redirect-result");
  await expect(redirect).toContainText("URL tujuan tidak tersedia");
  const features = page.locator("#scan-features");
  await expect(features.locator("tbody tr")).toHaveCount(19);
  await expect(features.getByRole("cell", { name: "Dasar + lengkap", exact: true })).toHaveCount(7);
  const lengths = features.getByRole("row", { name: /^Panjang URL/ }).getByRole("cell");
  await expect(lengths.nth(2)).toHaveText(String(shortURL.length));
  await expect(lengths.nth(3)).toHaveText("N/A (tidak tersedia)");

  await page.getByRole("button", { name: "Periksa Tujuan Redirect" }).click();
  await expect(page.getByRole("heading", { name: "Prediksi Phishing", exact: true })).toBeVisible();
  await expect(redirect).toContainText(destinationURL);
  await expect(redirect.getByRole("row", { name: /Prediksi URL Tujuan/ })).toContainText("Phishing");
  await expect(redirect).toContainText("destination-fixture-model");
  await expect(page.getByRole("heading", { name: "Prediksi Aman (benign)", exact: true })).toHaveCount(0);
  await expect(redirect).toContainText("Tujuan diamati saat pemindaian ini.");
  await expect(lengths.nth(3)).toHaveText(String(destinationURL.length));
  await expect(page.getByRole("row", { name: /GET 302/ })).toContainText(shortURL);
  await expect(page.getByRole("row", { name: /HEAD 200/ })).toContainText(destinationURL);
  await expect(page.locator("#scan-result a")).toHaveCount(0);
  expect(calls).toEqual([{ url: shortURL }, { url: shortURL, check_redirect: true }]);

  const history = await scanHistory(page);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    id: "fixture-redirect", url: "https://bit.ly/…", final_url: "https://example.com/…", redirects: 1,
    prediction: "phishing", probability: 0.92, model_version: "destination-fixture-model",
    prediction_source: "destination",
  });
  expect(JSON.stringify(history)).not.toContain("example-token");
  expect(JSON.stringify(history)).not.toContain("landing");
  await page.getByRole("link", { name: "Riwayat Deteksi" }).click();
  await page.getByRole("searchbox").fill("example.com");
  const savedRow = page.locator("#history-table tbody tr");
  await expect(savedRow).toContainText("https://bit.ly/…");
  await expect(savedRow).toContainText("URL tujuan · https://example.com/…");
  await expect(savedRow).toContainText("Phishing");
});

test("shows an observed public URL separately when the final destination cannot be confirmed", async ({ page }) => {
  await page.route("**/api/scan", (route) => {
    const { check_redirect } = route.request().postDataJSON();
    const value = initialResult(origin, shortURL, network("not_requested", null));
    if (check_redirect) {
      confirmedDestination(value);
      value.online = network("unavailable", "HTTP request timed out.", {
        resolution_status: "TIMEOUT",
        destination_confirmed: false,
        last_observed_url: destinationURL,
        redirect_count: 1,
        chain: [{ url: shortURL, status: 302 }],
      });
    }
    return route.fulfill({ json: value });
  });

  await scan(page, shortURL);
  await page.getByRole("button", { name: "Periksa Tujuan Redirect" }).click();
  const redirect = page.locator("#redirect-result");
  await expect(redirect.getByRole("row", { name: /URL publik terakhir \(tujuan akhir belum dikonfirmasi\)/ }))
    .toContainText(destinationURL);
  await expect(redirect.getByRole("row", { name: /Prediksi URL Tujuan/ })).toContainText("Tidak Tersedia");
  await expect(redirect).toContainText("URL tujuan tidak tersedia");
  await expect(page.getByRole("heading", { name: "Prediksi tidak tersedia — URL tujuan belum terkonfirmasi", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /HEAD 302/ })).toContainText(shortURL);
  const lengths = page.locator("#scan-features").getByRole("row", { name: /^Panjang URL/ }).getByRole("cell");
  await expect(lengths.nth(3)).toHaveText("N/A (tidak tersedia)");
  await expect(page.locator("#scan-result a")).toHaveCount(0);
  await expectPendingHistory(page);
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
  await expectPendingHistory(page);
  await button.click();
  await expect(redirect).toContainText("Pemeriksaan redirect melebihi batas waktu.");
  await expect(page.getByRole("button", { name: "Coba Resolusi Ulang" })).toBeEnabled();
  await expect(redirect).toContainText("URL tujuan tidak tersedia");
  await expect(page.locator("#scan-features").getByRole("row", { name: /^Panjang URL/ }).getByRole("cell").nth(2))
    .toHaveText(String(shortURL.length));
  await expectPendingHistory(page);
  await expect(page.getByRole("heading", { name: "Prediksi tidak tersedia — URL tujuan belum terkonfirmasi", exact: true })).toBeVisible();
});

test("labels a shortener homepage and keeps lexical analysis available when redirect checks are disabled", async ({ page }) => {
  const calls = [];
  await page.route("**/api/scan", (route) => {
    const { url } = route.request().postDataJSON();
    calls.push(url);
    const online = network("disabled", "Online checking is disabled by environment configuration.");
    return route.fulfill({ json: initialResult(url === shortURL ? origin : homepage, url, online) });
  });

  await scan(page, "https://bit.ly/", "Prediksi Aman (benign)");
  await expect(page.locator("#scan-result")).toContainText("bit.ly (halaman tanpa token tautan)");
  await expect(page.getByRole("button", { name: "Periksa Tujuan Redirect" })).toBeDisabled();
  await page.getByLabel("Masukkan URL").fill(shortURL);
  await page.getByRole("button", { name: "Pindai URL", exact: true }).click();
  await expect(page.getByRole("button", { name: "Periksa Tujuan Redirect" })).toBeDisabled();
  await expect(page.locator("#redirect-result")).toContainText("Pemeriksaan jaringan dinonaktifkan oleh konfigurasi lingkungan.");
  await expect(page.locator("#scan-features")).toContainText("Panjang URL");
  await expectPendingHistory(page);
  await expect(page.getByRole("heading", { name: "Prediksi tidak tersedia — URL tujuan belum terkonfirmasi", exact: true })).toBeVisible();
  expect(calls).toEqual(["https://bit.ly/", shortURL]);
});

test("runs the active browser model on the destination's features after confirmation", async ({ page, context }) => {
  const model = {
    version: "fixture-browser-E2",
    forest: {
      schema: "ummu-random-forest-v1",
      schema_version: origin.schema_version,
      feature_names: Object.keys(origin.features),
      trees: [[
        [Object.keys(origin.features).indexOf("shortener"), 0.5, 1, 2],
        [-1, 0.2],
        [-1, 0.8],
      ]],
    },
  };
  await context.route("**/src/workers/automatic-research.js*", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `self.onmessage = () => {
      postMessage({ type: 'model', model: ${JSON.stringify(model)} });
      postMessage({ type: 'ready' });
    };`,
  }));
  await page.route("**/api/scan", (route) => {
    const value = initialResult(origin, shortURL, network("not_requested", null));
    if (route.request().postDataJSON().check_redirect) confirmedDestination(value);
    return route.fulfill({ json: value });
  });

  await scan(page, shortURL);
  await expectPendingHistory(page);
  await page.getByRole("button", { name: "Periksa Tujuan Redirect" }).click();
  await expect(page.getByRole("heading", { name: "Prediksi Aman (benign)", exact: true })).toBeVisible();
  const redirect = page.locator("#redirect-result");
  await expect(redirect.getByRole("row", { name: /Prediksi URL Tujuan/ })).toContainText("Aman (benign)");
  await expect(redirect).toContainText(model.version);
  expect(await scanHistory(page)).toMatchObject([{
    prediction: "benign", probability: 0.2, model_version: model.version, prediction_source: "destination",
    url: "https://bit.ly/…", final_url: "https://example.com/…",
  }]);
});

test("resolves a provider outside the lexical list and predicts using the confirmed destination", async ({ page }) => {
  const calls = [];
  await page.route("**/api/scan", (route) => {
    const request = route.request().postDataJSON();
    calls.push(request);
    const value = initialResult(unrecognized, unrecognizedURL, network("not_requested", null, {
      resolution_status: "NOT_REQUESTED", is_short_url: false,
    }));
    value.prediction_target = "initial";
    if (request.check_redirect) {
      confirmedDestination(value);
      value.online.redirect_chain = [
        { url: unrecognizedURL, method: "HEAD", status: 307 },
        { url: destinationURL, method: "HEAD", status: 200 },
      ];
      value.prediction_target = "destination";
    }
    return route.fulfill({ json: value });
  });

  await scan(page, unrecognizedURL, "Prediksi Aman (benign)");
  await page.getByRole("button", { name: "Periksa Tujuan Redirect" }).click();
  await expect(page.getByRole("heading", { name: "Prediksi Phishing", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Domain tujuan example.com/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /HEAD 307/ })).toContainText(unrecognizedURL);
  expect(await scanHistory(page)).toMatchObject([{ prediction: "phishing", prediction_source: "destination" }]);
  expect(calls).toEqual([{ url: unrecognizedURL }, { url: unrecognizedURL, check_redirect: true }]);
});

test("keeps ordinary URL prediction when a lookup finds no HTTP redirect", async ({ page }) => {
  await page.route("**/api/scan", (route) => {
    const { check_redirect } = route.request().postDataJSON();
    const state = check_redirect ? "NO_REDIRECT" : "NOT_REQUESTED";
    const value = initialResult(unrecognized, unrecognizedURL, network("complete", null, {
      resolution_status: state, destination_confirmed: false, is_redirected: false,
      last_observed_url: check_redirect ? unrecognizedURL : null,
    }));
    value.prediction_target = "initial";
    return route.fulfill({ json: value });
  });
  await scan(page, unrecognizedURL, "Prediksi Aman (benign)");
  await page.getByRole("button", { name: "Periksa Tujuan Redirect" }).click();
  await expect(page.getByRole("row", { name: /Status pemeriksaan Tidak ditemukan redirect HTTP/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /URL publik terakhir/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Prediksi Aman (benign)", exact: true })).toBeVisible();
  expect(await scanHistory(page)).toMatchObject([{ prediction: "benign", prediction_source: "initial", final_url: null }]);
});

test("uses only the qualified 7-feature model after a documented resolution failure", async ({ page, context }) => {
  const model = {
    version: "fixture-browser-E2",
    fallback: {
      version: "fixture-browser-E1",
      qualification: { basis: "url_awal" },
      forest: {
        schema: "ummu-random-forest-v1",
        schema_version: origin.schema_version,
        feature_names: ["url_length", "domain_length", "digit_count", "dot_count", "hyphen_count", "special_count", "subdomain_count"],
        trees: [[[-1, 0.23, 0, 0]]],
      },
    },
  };
  await context.route("**/src/workers/automatic-research.js*", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `self.onmessage = () => {
      postMessage({ type: 'model', model: ${JSON.stringify(model)} });
      postMessage({ type: 'ready' });
    };`,
  }));
  let checks = 0;
  await page.route("**/api/scan", (route) => {
    const { check_redirect } = route.request().postDataJSON();
    const value = initialResult(origin, shortURL, network("not_requested", null));
    value.prediction_target = null;
    if (check_redirect && ++checks === 1) {
      value.online = network("unavailable", "DNS resolution failed.", {
        resolution_status: "DNS_ERROR", destination_confirmed: false,
      });
    } else if (check_redirect) {
      confirmedDestination(value);
      value.prediction_target = "destination";
    }
    return route.fulfill({ json: value });
  });

  await scan(page, shortURL);
  await expectPendingHistory(page);
  await page.getByRole("button", { name: "Periksa Tujuan Redirect" }).click();
  await expect(page.getByRole("heading", { name: "Prediksi Aman (benign)", exact: true })).toBeVisible();
  await expect(page.getByText(/Prediksi berdasarkan URL awal\. URL tujuan belum dapat dikonfirmasi/)).toBeVisible();
  await expect(page.getByText("Random Forest E1 · 7 fitur")).toBeVisible();
  expect(await scanHistory(page)).toMatchObject([{
    prediction: "benign", probability: 0.23, prediction_source: "initial",
    model_version: "fixture-browser-E1", final_url: null,
  }]);
  await page.getByRole("button", { name: "Coba Resolusi Ulang" }).click();
  await expect(page.getByRole("heading", { name: "Prediksi Phishing", exact: true })).toBeVisible();
  expect(await scanHistory(page)).toMatchObject([{
    prediction: "phishing", prediction_source: "destination", final_url: "https://example.com/…",
  }]);
});
