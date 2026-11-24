import { displayText, classLabel } from "../utils/i18n.js";
import { heading, escape } from "../utils/ui.js";
import {
  history,
  deleteScan,
  clearHistory,
  csv,
  download,
} from "../utils/storage.js";

function predictionSource(record) {
  if (record.prediction_source === "destination")
    return record.final_url ? `URL tujuan · ${record.final_url}` : "URL tujuan";
  if (record.prediction_source === "initial") return "URL awal";
  return record.prediction ? "Tidak tercatat" : "Tidak Tersedia";
}

export function render() {
  return `${heading("Riwayat Deteksi", "Tersimpan di browser ini. Jalur, parameter kueri, dan fragmen tidak pernah disimpan.")}
    <section class="card"><div class="history-tools"><label>Cari Riwayat<input id="history-search" type="search" placeholder="Cari domain…" /></label><label>Hasil Prediksi<select id="history-filter"><option value="all">Semua hasil</option><option value="phishing">Phishing</option><option value="benign">Aman (benign)</option><option value="unavailable">Tidak Tersedia</option></select></label><button id="history-csv" class="button secondary">Ekspor CSV</button><button id="history-json" class="button secondary">Ekspor JSON</button><button id="history-clear" class="button danger">Hapus Semua</button></div><div id="history-table"></div><p class="hint">Maksimal 200 data. Data tidak disinkronkan secara otomatis antarperangkat.</p><p id="history-message" role="status"></p></section>`;
}
export function mount() {
  const search = document.querySelector("#history-search");
  const filter = document.querySelector("#history-filter");
  function selected() {
    const query = search.value.toLowerCase();
    return history().filter(
      (r) =>
        (r.url.toLowerCase().includes(query) || r.final_url?.toLowerCase().includes(query)) &&
        (filter.value === "all" ||
          (r.prediction || "unavailable") === filter.value),
    );
  }
  function draw() {
    const rows = selected();
    document.querySelector("#history-table").innerHTML =
      `<div class="table-wrap"><table><thead><tr>${["Asal URL", "Hasil Prediksi", "Dasar Prediksi", "Jaringan", "Pengalihan", "Waktu", "Versi Model", "Tindakan"].map((x) => `<th scope="col">${x}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr><td class="url-text">${escape(r.url)}</td><td><span class="badge ${escape(r.prediction || "unavailable")}">${escape(classLabel(r.prediction))}</span></td><td>${escape(predictionSource(r))}</td><td>${escape(displayText(r.online_status))}</td><td>${escape(r.redirects)}</td><td>${escape(new Date(r.timestamp).toLocaleString("id-ID"))}</td><td>${escape(r.model_version || "Tidak Tersedia")}</td><td><button class="text-button" data-delete="${escape(r.id)}">Hapus</button></td></tr>`).join("") : '<tr><td colspan="8" class="empty">Belum ada riwayat yang sesuai.</td></tr>'}</tbody></table></div>`;
    document.querySelectorAll("[data-delete]").forEach(
      (button) =>
        (button.onclick = () => {
          deleteScan(button.dataset.delete);
          draw();
        }),
    );
  }
  search.oninput = draw;
  filter.onchange = draw;
  document.querySelector("#history-clear").onclick = () => {
    if (confirm("Konfirmasi Penghapusan: hapus semua riwayat deteksi dari browser ini?")) {
      clearHistory();
      draw();
    }
  };
  document.querySelector("#history-csv").onclick = () =>
    download("masked-history.csv", csv(selected()), "text/csv");
  document.querySelector("#history-json").onclick = () =>
    download("masked-history.json", selected());
  draw();
}
