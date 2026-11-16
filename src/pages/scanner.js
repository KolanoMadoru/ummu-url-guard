import { displayText, classLabel, featureLabel, featureDefinition } from "../utils/i18n.js";
import { api } from "../utils/api.js";
import {
  heading,
  escape,
  percent,
  table,
  busy,
  showError,
} from "../utils/ui.js";
import { saveScan, getStorageWarning } from "../utils/storage.js";
export function render() {
  return `${heading("Pemindai URL", "Periksa indikator leksikal dan metadata HTTP publik dengan pembatasan keamanan.")}
    <section class="card"><form id="scan-form"><label for="scan-url">Masukkan URL</label><div class="input-row"><input type="url" id="scan-url" placeholder="https://example.com/login" maxlength="4096" required autocomplete="off" spellcheck="false" /><button class="button" id="scan-button"><i data-lucide="scan-line"></i> Pindai URL</button><button class="button secondary" type="reset">Hapus</button></div><p class="hint">Hanya HTTP / HTTPS. Isi halaman tidak diunduh. URL ditampilkan sebagai teks, tidak pernah dibuka.</p></form><p class="error" id="scan-error" role="alert" hidden></p><p id="scan-progress" role="status"></p></section>
    <div id="scan-result" aria-live="polite"></div><div class="notice">Hasil prediksi machine learning merupakan indikator dan bukan jaminan keamanan suatu website.</div>`;
}
export function mount() {
  const form = document.querySelector("#scan-form");
  const error = document.querySelector("#scan-error");
  const output = document.querySelector("#scan-result");
  const progress = document.querySelector("#scan-progress");
  form.addEventListener("reset", () => {
    output.innerHTML = "";
    error.hidden = true;
    progress.textContent = "";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    const button = document.querySelector("#scan-button");
    busy(button, true);
    progress.textContent =
      "Sedang Memindai: mengekstraksi fitur dan memeriksa metadata jaringan publik…";
    try {
      const result = await api("scan", {
        json: { url: form.querySelector("input").value },
      });
      const saved = saveScan(result);
      const online = result.online;
      output.innerHTML = `<section class="card result ${result.prediction || "unavailable"}"><div class="result-heading"><i data-lucide="shield"></i><div><span class="eyebrow">HASIL PEMINDAIAN</span><h2>${escape(result.prediction ? `Prediksi ${classLabel(result.prediction)}` : "Prediksi Tidak Tersedia — model belum dilatih")}</h2></div><span class="badge">${escape(displayText(online.status))}</span></div>
        ${table(
          ["Properti", "Nilai pengamatan"],
          [
            ["URL Asli", result.url],
            ["URL Tujuan Akhir", online.final_url || "Tidak Tersedia"],
            ["Probabilitas phishing menurut model", percent(result.probability)],
            [
              "Penyedia URL pendek",
              result.shortener_provider || "Tidak ada pemendek yang dikenal",
            ],
            [
              "Indikator Typosquatting",
              result.typosquatting.indicator
                ? "Terdeteksi; mungkin positif palsu"
                : "Tidak terdeteksi",
            ],
            ["Domain referensi", result.typosquatting.reference],
            [
              "Kemiripan domain terdaftar",
              percent(result.typosquatting.similarity),
            ],
            ["Perubahan karakter", displayText(result.typosquatting.change)],
            ["Status HTTP", online.http_status ?? "Tidak Tersedia"],
            ["Jumlah Pengalihan", online.redirect_count],
            ["Keterangan pemeriksaan jaringan", online.reason ? displayText(online.reason) : "Metadata HEAD diterima"],
            ["Waktu Pemindaian", result.timestamp],
            ["Versi Model", result.model_version || "Belum Tersedia"],
          ],
        )}
        <p class="hint">${escape(displayText(result.probability_label || result.reason || ""))}</p>${!saved ? `<p class="error">${escape(displayText(getStorageWarning()))}</p>` : '<p class="hint">Disimpan di browser ini tanpa jalur, parameter kueri, dan fragmen.</p>'}</section>
        <section class="card"><h3>Bukti Leksikal</h3><p class="hint">Dihitung dari masukan asli. Metadata jaringan terpisah dari masukan model. Indikator kata kunci dan kemiripan saja tidak menentukan kelas.</p>${table(
          ["Nama Fitur", "Nilai", "Keterangan"],
          Object.entries(result.features).map(([key, value]) => [
            featureLabel(key),
            Number.isInteger(value) ? value : value.toFixed(4),
            featureDefinition(key, result.definitions[key]),
          ]),
        )}</section>
        <section class="card"><h3>Rantai Pengalihan yang Diamati</h3>${table(
          ["URL", "Status HEAD"],
          (online.chain || []).map((h) => [h.url, h.status]),
        )}</section>`;
    } catch (e) {
      showError(error, e);
    } finally {
      busy(button, false);
      progress.textContent = "";
    }
  });
}
