import { displayText } from "../utils/i18n.js";
import { heading, percent, escape, table } from "../utils/ui.js";
import { history } from "../utils/storage.js";
import { renderResearchDashboard } from "../components/research-workspace.js";
import { currentResearchReport } from "../utils/research-reports.js";
import { automaticResearch } from "../utils/automatic-research.js";
import {
  formatResearchCount as count, researchSelectionLabel, researchStatus,
} from "../components/automatic-research.js";

function datasetStatus(snapshot) {
  const { dataset, report, completed } = snapshot;
  const e2 = report?.results.find((result) => result.id === "E2");
  const counts = dataset ? [
    ["Baris Sumber", dataset.source_rows],
    ["Data Valid", dataset.valid_rows],
    ["Duplikat", dataset.duplicate_rows],
    ["Benign", dataset.benign],
    ["Phishing", dataset.phishing],
  ] : [];
  const audit = dataset?.audit;
  const split = dataset?.split;
  return `<section class="card">
    <div class="section-heading"><h2>Penelitian CSV</h2><a class="button secondary" href="#dataset">Manajemen Dataset</a></div>
    <div class="status-list">
      <span>Dataset</span><b>${researchSelectionLabel(snapshot)}</b>
      <span>Proses</span><b>${researchStatus(snapshot)}</b>
      <span>Audit</span><b>${audit?.passed === true ? "Tidak ditemukan kebocoran berdasarkan URL dan domain yang diperiksa." : "Belum selesai"}</b>
      <span>Ekstraksi fitur</span><b>${completed.includes("features") ? "Selesai · 7 fitur dasar dan 19 fitur lengkap" : "Belum selesai"}</b>
      <span>Model penelitian aktif</span><b>${e2 ? `Random Forest 19 fitur · ${escape(report.experiment_id)}` : "Belum tersedia"}</b>
      <span>Evaluasi terakhir</span><b>${e2 ? `Akurasi data uji E2 ${percent(e2.metrics.accuracy)}` : "Belum tersedia"}</b>
    </div>
    ${counts.length ? table(["Dataset", "Jumlah"], counts.map(([name, n]) => [name, count(n)])) : ""}
    ${split ? table(["Split", "Jumlah"], [["Pelatihan", count(split.train?.rows)],
      ["Validasi", count(split.validation?.rows)], ["Pengujian", count(split.test?.rows)]]) : ""}
    </section>`;
}

export function render(state) {
  const records = history();
  const snapshot = automaticResearch.get();
  return `${heading("Deteksi Phishing pada URL Pendek dan Domain Typosquatting", "Teliti deteksi phishing dari satu CSV dan gunakan model terlatih untuk memindai URL.", '<a class="button" href="#dataset">Unggah Dataset</a>')}
    <div id="dashboard-dataset">${datasetStatus(snapshot)}</div>
    <section class="card"><h3>Pemindai URL</h3><div class="status-list">
      <span>Riwayat pemeriksaan</span><b>${count(records.length)}</b>
      <span>API Python</span><b>${state.health ? "Terhubung" : "Belum terhubung"}</b>
      <span>Model dari server</span><b>${escape(state.health?.model_version || displayText(state.health?.model_reason ?? "Tidak Tersedia"))}</b>
    </div><div class="actions"><a class="button secondary" href="#scanner">Pindai URL</a><a class="button secondary" href="#history">Riwayat Deteksi</a></div></section>
    <div id="dashboard-report">${renderResearchDashboard(currentResearchReport())}</div>`;
}

export function mount() {
  const output = document.querySelector("#dashboard-dataset");
  const summaries = document.querySelector("#dashboard-report");
  let checkpoint = "";
  let reportId = currentResearchReport()?.experiment_id;
  return automaticResearch.subscribe((snapshot) => {
    const signature = [snapshot.phase, snapshot.completed.join(","), snapshot.dataset?.hash, snapshot.report?.experiment_id].join("|");
    if (signature !== checkpoint) {
      checkpoint = signature;
      output.innerHTML = datasetStatus(snapshot);
    }
    const report = currentResearchReport();
    if (report?.experiment_id !== reportId) {
      reportId = report?.experiment_id;
      summaries.innerHTML = renderResearchDashboard(report);
    }
  });
}
