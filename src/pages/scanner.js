import { displayText, classLabel, featureLabel, featureDefinition, errorText } from "../utils/i18n.js";
import { api } from "../utils/api.js";
import { heading, escape, percent, table, busy, showError } from "../utils/ui.js";
import { saveScan, getStorageWarning } from "../utils/storage.js";
import { automaticResearch } from "../utils/automatic-research.js";
import { predictBrowserForest } from "../utils/browser-prediction.js";

const unavailable = "Tidak Tersedia";
const fallbackFailures = new Set([
  "TIMEOUT", "DNS_ERROR", "NETWORK_ERROR", "HTTP_ERROR", "ACCESS_BLOCKED",
  "REDIRECT_LOOP", "MAX_REDIRECT_EXCEEDED", "UNSUPPORTED_REDIRECT", "UNSAFE_DESTINATION",
]);
const retryableFailures = new Set(["TIMEOUT", "DNS_ERROR", "NETWORK_ERROR", "BUSY"]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function withBrowserPrediction(result, model) {
  const prediction = model && predictBrowserForest(model.forest, result);
  if (prediction) {
    return {
      ...result,
      ...prediction,
      available: true,
      model_version: model.version,
      browser_prediction: true,
      probability_label: "Estimasi phishing dari Random Forest 19 fitur di browser ini. Skor belum dikalibrasi.",
    };
  }
  if (result.available || result.prediction) return result;
  return {
    ...result,
    reason: model
      ? "Model penelitian tersimpan memakai skema fitur berbeda. Jalankan kembali penelitian pada versi aplikasi ini."
      : "Jalankan penelitian dari Manajemen Dataset untuk mengaktifkan model pada browser ini.",
  };
}

function shortenerLabel(result) {
  if (result.shortener_provider) return result.shortener_provider;
  if (result.shortener_service) return `${result.shortener_service} (halaman tanpa token tautan)`;
  return "Tidak ada pemendek yang dikenal";
}

function predictionRows(result, label) {
  return [
    [label, result?.prediction ? classLabel(result.prediction) : unavailable],
    ["Estimasi phishing", percent(result?.probability)],
    ["Versi model", result?.model_version ?? unavailable],
    ...(result?.browser_prediction ? [["Model penelitian", result.model_label ?? "Random Forest · 19 fitur"]] : []),
  ];
}

function featureNumber(value) {
  if (!Number.isFinite(value)) return "N/A (tidak tersedia)";
  return Number.isInteger(value) ? value : value.toFixed(4);
}

function knownShortLink(scan) {
  return Boolean(scan.initial.shortener_provider || scan.online.is_short_url);
}

function observedRedirect(online) {
  return Boolean(online.is_redirected || online.redirect_count > 0 ||
    online.observed_url ||
    (online.redirect_chain ?? online.chain)?.some(({ status }) => redirectStatuses.has(status)));
}

function confirmedDestination(result) {
  const { online, destination } = result;
  if (!destination || !online.final_url || destination.url !== online.final_url) return false;
  return "destination_confirmed" in online
    ? online.destination_confirmed === true
    : online.status === "complete" && online.redirect_count > 0;
}

function predictionFor(scan) {
  if (scan.destination) return scan.destination;
  if (scan.fallback) return scan.fallback;
  if (knownShortLink(scan) || observedRedirect(scan.online)) return null;
  return scan.predictionTarget === null ? null : scan.initial;
}

function fallbackFor(scan, result) {
  const fallback = scan.model?.fallback;
  if (!scan.initial.shortener_provider || !fallbackFailures.has(result.online.resolution_status)
      || fallback?.qualification?.basis !== "url_awal" || typeof fallback.version !== "string") return null;
  const prediction = predictBrowserForest(fallback.forest, scan.initial, { basic: true });
  if (!prediction) return null;
  return {
    ...prediction, model_version: fallback.version,
    browser_prediction: true, model_label: "Random Forest E1 · 7 fitur",
  };
}

function typosquattingRows(result) {
  const typo = result.typosquatting;
  return [
    ["Indikator Typosquatting", typo.indicator ? "Terdeteksi, mungkin positif palsu" : "Tidak terdeteksi"],
    ["Domain referensi", typo.reference],
    ["Kemiripan domain terdaftar", percent(typo.similarity)],
    ["Perubahan karakter", displayText(typo.change)],
  ];
}

function renderResult(scan) {
  const { initial, destination, fallback, online, saved } = scan;
  const shortLink = knownShortLink(scan);
  const prediction = predictionFor(scan);
  const basic = new Set(initial.basic_features);
  const status = online.resolution_status ?? online.status;
  const networkReason = displayText(online.error_message || online.reason || status);
  const chain = online.redirect_chain ?? online.chain ?? [];
  const lastObserved = online.last_observed_url ?? online.observed_url;
  const retryLabel = retryableFailures.has(status) || (!online.resolution_status &&
    online.status === "unavailable" && /timed out|DNS resolution failed/i.test(online.reason ?? ""))
    ? "Coba Resolusi Ulang" : "Periksa Tujuan Redirect";
  let title = prediction?.prediction
    ? `Prediksi ${classLabel(prediction.prediction)}`
    : "Prediksi Tidak Tersedia — model belum dilatih";
  if (!prediction) {
    title = status === "NOT_REQUESTED" || status === "not_requested"
      ? "Prediksi menunggu URL tujuan"
      : "Prediksi tidak tersedia — URL tujuan belum terkonfirmasi";
  }
  const source = destination || (!prediction && (shortLink || observedRedirect(online)))
    ? "PREDIKSI BERDASARKAN URL TUJUAN"
    : "URL AWAL";
  return `<section class="card result ${escape(prediction?.prediction || "unavailable")}">
    <div class="result-heading"><i data-lucide="shield"></i><div><span class="eyebrow">${source}</span><h2>${escape(title)}</h2></div></div>
    ${table(["Properti", "Pengamatan"], [
      ["URL Awal", scan.url],
      ["Jenis URL", shortLink ? "Tautan pendek yang dikenali" : observedRedirect(online) ? "URL dengan pengalihan HTTP" : "URL tanpa pemendek yang dikenali"],
      ["Domain awal", initial.registered_domain],
      ...(prediction && !destination ? predictionRows(prediction, "Prediksi URL Awal") : []),
      ["Penyedia URL pendek", shortenerLabel(initial)],
      ...typosquattingRows(initial),
      ["Waktu Pemindaian", initial.timestamp],
    ])}
    ${fallback ? '<p class="hint">Prediksi berdasarkan URL awal. URL tujuan belum dapat dikonfirmasi sehingga analisis domain tujuan belum dilakukan. Skor model belum dikalibrasi.</p>'
      : prediction === initial ? `<p class="hint">${escape(displayText(initial.probability_label || initial.reason || ""))}</p>`
      : '<p class="hint">Prediksi tujuan tersedia setelah pengalihan HTTP terkonfirmasi dan model yang sesuai tersedia.</p>'}
    ${saved
      ? '<p class="hint">Riwayat menyimpan asal URL di browser ini.</p>'
      : `<p class="error">${escape(displayText(getStorageWarning()))}</p>`}
    </section>
    <section class="card" id="redirect-result" aria-labelledby="redirect-heading">
    <div class="section-heading"><h3 id="redirect-heading">Tujuan Redirect</h3>
      <button class="button secondary" type="button" id="check-redirect"${online.status === "disabled" ? " disabled" : ""}>${retryLabel}</button>
    </div>
    ${table(["Properti", "Pengamatan"], [
      ["URL Tujuan", destination?.url ?? "URL tujuan tidak tersedia"],
      ...(!destination && observedRedirect(online) && lastObserved && lastObserved !== initial.url
        ? [["URL publik terakhir (tujuan akhir belum dikonfirmasi)", lastObserved]]
        : []),
      ["Domain tujuan", destination?.registered_domain ?? unavailable],
      ...(destination ? typosquattingRows(destination) : []),
      ...predictionRows(destination, "Prediksi URL Tujuan"),
      ["Status pemeriksaan", displayText(status)],
      ["Keterangan", networkReason],
      ["Status HTTP terakhir", online.http_status ?? unavailable],
      ["Jumlah Pengalihan", online.redirect_count ?? 0],
      ...(Number.isFinite(online.response_time_ms) ? [["Durasi pemeriksaan", `${online.response_time_ms} ms`]] : []),
      ...(online.resolved_at ? [["Waktu pemeriksaan redirect", online.resolved_at]] : []),
    ])}
    ${destination ? '<p class="hint">Tujuan diamati saat pemindaian ini.</p>' : ""}
    ${destination ? `<p class="hint">${escape(displayText(destination.probability_label || destination.reason || ""))}</p>` : ""}
    </section>
    <section class="card" id="scan-features"><h3>Perbandingan Fitur Leksikal</h3>
      <p class="hint">7 fitur dasar termasuk dalam 19 fitur lengkap. Setiap kolom dihitung dari URL yang bersangkutan.</p>
      ${table(
        ["Nama Fitur", "Kelompok", "URL Awal", "URL Tujuan", "Keterangan"],
        Object.entries(initial.features).map(([key, value]) => [
          featureLabel(key),
          basic.has(key) ? "Dasar + lengkap" : "Lengkap",
          featureNumber(value),
          featureNumber(destination?.features[key]),
          featureDefinition(key, initial.definitions[key]),
        ]),
      )}
    </section>
    ${chain.length ? `<section class="card"><h3>Rantai Pengalihan yang Diamati</h3>${table(
      ["URL", "Metode HTTP", "Status HTTP"], chain.map((hop) => [hop.url, hop.method ?? "HEAD", hop.status]),
    )}</section>` : ""}`;
}

export function render() {
  return `${heading("Pemindai URL", "Bandingkan ciri URL awal dan tujuan redirect yang diamati.")}
    <section class="card"><form id="scan-form"><label for="scan-url">Masukkan URL</label>
      <div class="input-row"><input type="url" id="scan-url" placeholder="https://example.com/login" maxlength="4096" required autocomplete="off" spellcheck="false" />
        <button class="button" id="scan-button"><i data-lucide="scan-line"></i> Pindai URL</button>
        <button class="button secondary" type="reset">Hapus</button>
      </div>
      <p class="hint">Pilih Periksa Tujuan Redirect untuk menelusuri header HTTP melalui server, termasuk pada URL dari penyedia yang belum dikenali.</p>
    </form><p class="error" id="scan-error" role="alert" hidden></p><p id="scan-progress" role="status"></p></section>
    <div id="scan-result" aria-live="polite"></div><div class="notice">Hasil prediksi machine learning merupakan indikator dan bukan jaminan keamanan suatu website.</div>`;
}

export function mount() {
  const form = document.querySelector("#scan-form");
  const error = document.querySelector("#scan-error");
  const output = document.querySelector("#scan-result");
  const progress = document.querySelector("#scan-progress");
  const submit = form.querySelector("#scan-button");
  let scan, pending;

  function updateResult() {
    const prediction = predictionFor(scan);
    scan.saved = saveScan({
      ...scan.initial,
      prediction: prediction?.prediction ?? null,
      probability: prediction?.probability ?? null,
      model_version: prediction?.model_version ?? null,
      prediction_source: prediction?.prediction ? (scan.destination ? "destination" : "initial") : null,
      online: { ...scan.online, final_url: scan.destination?.url ?? null },
    });
    output.innerHTML = renderResult(scan);
    const redirect = output.querySelector("#check-redirect");
    if (redirect) redirect.onclick = () => checkRedirect(redirect);
  }

  async function checkRedirect(button) {
    if (pending) return;
    const request = new AbortController();
    pending = request;
    busy(button, true);
    busy(submit, true);
    progress.textContent = "Menelusuri pengalihan URL melalui server…";
    try {
      const result = await api("scan", {
        json: { url: scan.url, check_redirect: true },
        signal: request.signal,
        timeoutMs: 24000,
      });
      if (request.signal.aborted) return;
      scan.online = result.online;
      scan.predictionTarget = result.prediction_target;
      scan.destination = confirmedDestination(result) ? withBrowserPrediction(result.destination, scan.model) : null;
      scan.fallback = scan.destination ? null : fallbackFor(scan, result);
    } catch (failure) {
      if (request.signal.aborted) return;
      const timeout = failure.status === 504 || failure.message.startsWith("Request timed out.");
      scan.online = {
        status: "unavailable",
        resolution_status: timeout ? "TIMEOUT" : "NETWORK_ERROR",
        reason: timeout ? "Pemeriksaan redirect melebihi batas waktu." : errorText(failure),
      };
      scan.destination = null;
      scan.fallback = null;
      scan.predictionTarget = null;
    } finally {
      if (!request.signal.aborted) {
        pending = null;
        busy(submit, false);
        progress.textContent = "";
        updateResult();
      }
    }
  }

  form.addEventListener("reset", () => {
    pending?.abort();
    pending = null;
    scan = null;
    busy(submit, false);
    output.innerHTML = "";
    error.hidden = true;
    progress.textContent = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;
    const request = new AbortController();
    pending = request;
    error.hidden = true;
    output.innerHTML = "";
    scan = null;
    const url = form.querySelector("input").value;
    busy(submit, true);
    progress.textContent = "Memvalidasi URL dan mengekstraksi fitur URL awal…";
    try {
      const [result, model] = await Promise.all([
        api("scan", { json: { url }, signal: request.signal }),
        automaticResearch.activeModel(),
      ]);
      if (request.signal.aborted) return;
      const initial = result.shortener_provider || result.online.is_short_url || result.prediction_target === null
        ? result : withBrowserPrediction(result, model);
      scan = {
        url: result.initial_url ?? url, initial, model, destination: null, fallback: null,
        online: result.online, predictionTarget: result.prediction_target,
      };
      updateResult();
    } catch (failure) {
      if (!request.signal.aborted) showError(error, failure);
    } finally {
      if (!request.signal.aborted) {
        pending = null;
        busy(submit, false);
        progress.textContent = "";
      }
    }
  });

  return () => pending?.abort();
}
