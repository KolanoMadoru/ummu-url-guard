import { displayText, classLabel, featureLabel, featureDefinition, errorText } from "../utils/i18n.js";
import { api } from "../utils/api.js";
import { heading, escape, percent, table, busy, showError } from "../utils/ui.js";
import { saveScan, getStorageWarning } from "../utils/storage.js";
import { automaticResearch } from "../utils/automatic-research.js";
import { predictBrowserForest } from "../utils/browser-prediction.js";

const unavailable = "Tidak Tersedia";

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
    ...(result?.browser_prediction ? [["Model penelitian", "Random Forest · 19 fitur"]] : []),
  ];
}

function featureNumber(value) {
  if (!Number.isFinite(value)) return "N/A (tidak tersedia)";
  return Number.isInteger(value) ? value : value.toFixed(4);
}

function renderResult(scan) {
  const { initial, destination, online, saved } = scan;
  const basic = new Set(initial.basic_features);
  const reason = online.status === "not_requested" && !initial.shortener_provider
    ? "Redirect checks require a recognized short link with a token."
    : online.reason;
  const networkReason = reason
    ? displayText(reason)
    : online.status === "complete" ? "Metadata HEAD diterima." : displayText(online.status);
  const initialTitle = initial.prediction
    ? `Prediksi ${classLabel(initial.prediction)}`
    : "Prediksi Tidak Tersedia — model belum dilatih";
  return `<section class="card result ${escape(initial.prediction || "unavailable")}">
    <div class="result-heading"><i data-lucide="shield"></i><div><span class="eyebrow">URL AWAL</span><h2>${escape(initialTitle)}</h2></div></div>
    ${table(["Properti", "Pengamatan"], [
      ["URL Awal", scan.url],
      ...predictionRows(initial, "Prediksi URL Awal"),
      ["Penyedia URL pendek", shortenerLabel(initial)],
      ["Indikator Typosquatting", initial.typosquatting.indicator ? "Terdeteksi, mungkin positif palsu" : "Tidak terdeteksi"],
      ["Domain referensi", initial.typosquatting.reference],
      ["Kemiripan domain terdaftar", percent(initial.typosquatting.similarity)],
      ["Perubahan karakter", displayText(initial.typosquatting.change)],
      ["Waktu Pemindaian", initial.timestamp],
    ])}
    <p class="hint">${escape(displayText(initial.probability_label || initial.reason || ""))}</p>
    ${saved
      ? '<p class="hint">Riwayat menyimpan asal URL di browser ini.</p>'
      : `<p class="error">${escape(displayText(getStorageWarning()))}</p>`}
    </section>
    <section class="card" id="redirect-result" aria-labelledby="redirect-heading">
    <div class="section-heading"><h3 id="redirect-heading">Tujuan Redirect</h3>
      ${initial.shortener_provider ? `<button class="button secondary" type="button" id="check-redirect"${online.status === "disabled" ? " disabled" : ""}>Periksa Tujuan Redirect</button>` : ""}
    </div>
    ${table(["Properti", "Pengamatan"], [
      ["URL Tujuan", destination?.url ?? "URL tujuan tidak tersedia"],
      ...predictionRows(destination, "Prediksi URL Tujuan"),
      ["Status pemeriksaan", displayText(online.status)],
      ["Keterangan", networkReason],
      ["Status HTTP", online.http_status ?? unavailable],
      ["Jumlah Pengalihan", online.redirect_count ?? 0],
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
    ${online.chain?.length ? `<section class="card"><h3>Rantai Pengalihan yang Diamati</h3>${table(
      ["URL", "Status HEAD"], online.chain.map((hop) => [hop.url, hop.status]),
    )}</section>` : ""}`;
}

export function render() {
  return `${heading("Pemindai URL", "Bandingkan ciri URL awal dan tujuan redirect yang diamati.")}
    <section class="card"><form id="scan-form"><label for="scan-url">Masukkan URL</label>
      <div class="input-row"><input type="url" id="scan-url" placeholder="https://example.com/login" maxlength="4096" required autocomplete="off" spellcheck="false" />
        <button class="button" id="scan-button"><i data-lucide="scan-line"></i> Pindai URL</button>
        <button class="button secondary" type="reset">Hapus</button>
      </div>
      <p class="hint">Pemindaian awal menghitung ciri URL. Pemeriksaan redirect opsional hanya membaca header HTTP.</p>
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
    scan.saved = saveScan({
      ...scan.initial,
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
    progress.textContent = "Sedang memeriksa tujuan redirect…";
    try {
      const result = await api("scan", {
        json: { url: scan.url, check_redirect: true },
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      scan.online = result.online;
      scan.destination = result.destination && withBrowserPrediction(result.destination, scan.model);
    } catch (failure) {
      if (request.signal.aborted) return;
      const timeout = failure.status === 504 || failure.message.startsWith("Request timed out.");
      scan.online = {
        status: "unavailable",
        reason: timeout ? "Pemeriksaan redirect melebihi batas waktu." : errorText(failure),
      };
      scan.destination = null;
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
    progress.textContent = "Sedang memindai URL…";
    try {
      const [result, model] = await Promise.all([
        api("scan", { json: { url }, signal: request.signal }),
        automaticResearch.activeModel(),
      ]);
      if (request.signal.aborted) return;
      const initial = withBrowserPrediction(result, model);
      scan = { url: result.initial_url ?? url, initial, model, destination: null, online: result.online };
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
