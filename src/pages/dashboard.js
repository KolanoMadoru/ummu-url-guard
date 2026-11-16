import { displayText } from "../utils/i18n.js";
import { heading, percent, escape } from "../utils/ui.js";
import { history, summaries } from "../utils/storage.js";
import { chart, plot } from "../utils/charts.js";
export function render(state) {
  const records = history();
  const count = (predicate) => records.filter(predicate).length;
  const cards = [
    ["Total URL Dipindai", records.length, "scan-line"],
    [
      "Prediksi Phishing",
      count((x) => x.prediction === "phishing"),
      "shield-alert",
    ],
    [
      "Prediksi Aman",
      count((x) => x.prediction === "benign"),
      "shield-check",
    ],
    ["URL Pendek Mencurigakan", count((x) => x.shortener), "link"],
    [
      "Indikator Typosquatting",
      count((x) => x.typosquatting),
      "text-cursor-input",
    ],
    [
      "Akurasi Model",
      state.health?.model_available
        ? percent(state.health.model_metrics?.accuracy)
        : "Model Belum Tersedia",
      "chart-no-axes-combined",
    ],
  ];
  return `${heading("Deteksi Phishing pada URL Pendek dan Domain Typosquatting", "Dasbor pemeriksaan URL dan penelitian model.", '<a class="button" href="#scanner"><i data-lucide="scan-line"></i> Pindai URL</a>')}
    <div class="notice"><i data-lucide="info"></i><div>Hasil prediksi machine learning merupakan indikator dan bukan jaminan keamanan suatu website. Prediksi Aman menunjukkan kelas benign menurut model. URL pendek dan kemiripan domain bukan penentu phishing.</div></div>
    <div class="stats">${cards.map(([label, value, icon]) => `<section class="stat"><div class="stat-label">${label}<i data-lucide="${icon}"></i></div><strong>${value}</strong><span>Berdasarkan aktivitas lokal atau model yang diterapkan</span></section>`).join("")}</div>
    ${records.length ? `<div class="grid two">${plot("prediction-chart", "Distribusi Hasil Prediksi")}${plot("time-chart", "Pemindaian dari Waktu ke Waktu")}${plot("short-chart", "Proporsi URL Pendek")}${plot("typo-chart", "Indikator Typosquatting")}</div>` : '<section class="card welcome"><i data-lucide="shield-check"></i><h2>Mulai Penelitian Anda</h2><p>Belum Ada Data. Pindai URL untuk melihat fitur leksikal dan metadata jaringan, atau unggah dataset berlabel untuk melatih model.</p><div class="actions"><a class="button" href="#scanner">Buka Pemindai URL</a><a class="button secondary" href="#dataset">Unggah Dataset</a></div></section>'}
    <section class="card"><h3>Status Aplikasi</h3><div class="status-list"><span>API Python</span><b>${state.health ? "Terhubung" : "Tidak tersedia — jalankan backend"}</b><span>Model produksi</span><b>${escape(state.health?.model_reason ? displayText(state.health.model_reason) : state.health?.model_version || "Tidak Tersedia")}</b><span>Ringkasan eksperimen tersimpan</span><b>${summaries().length}</b><span>Penyimpanan riwayat</span><b>Hanya di browser ini · maksimal 200 data · URL disamarkan</b></div></section>`;
}
export function mount() {
  const records = history();
  if (!records.length) return;
  chart(
    "prediction-chart",
    "doughnut",
    ["Tidak Tersedia", "Phishing", "Aman (benign)"],
    [
      records.filter((x) => !x.prediction).length,
      records.filter((x) => x.prediction === "phishing").length,
      records.filter((x) => x.prediction === "benign").length,
    ],
  );
  const days = {};
  records.forEach((r) => {
    const day = r.timestamp.slice(0, 10);
    days[day] = (days[day] || 0) + 1;
  });
  const sorted = Object.keys(days).sort();
  chart(
    "time-chart",
    "line",
    sorted,
    sorted.map((x) => days[x]),
    "Pemindaian URL",
  );
  chart(
    "short-chart",
    "doughnut",
    ["Pemendek yang dikenal", "URL lainnya"],
    [
      records.filter((x) => x.shortener).length,
      records.filter((x) => !x.shortener).length,
    ],
  );
  chart(
    "typo-chart",
    "doughnut",
    ["Indikator ditemukan", "Tanpa indikator"],
    [
      records.filter((x) => x.typosquatting).length,
      records.filter((x) => !x.typosquatting).length,
    ],
  );
}
