import { displayText, featureLabel } from "../utils/i18n.js";
import { chart, plot } from "../utils/charts.js";
import { csv, download } from "../utils/storage.js";
import { escape, percent, table } from "../utils/ui.js";
import {
  categories, currentResearchReport, importResearchReport, MAX_RESEARCH_REPORT_BYTES,
  metrics, partitions, removeResearchReport, researchReports, scenarios, selectResearchReport,
} from "../utils/research-reports.js";

const formatted = (value) => value?.toLocaleString("id-ID") ?? "Tidak Tersedia";
const time = (value) => value == null ? "Tidak Tersedia" : `${formatted(value)} dtk`;
const splitName = (report) => report.split_method === "predefined"
  ? "Split penelitian dari berkas"
  : "Split berbasis kelompok";
const heuristicScenarios = {
  biasa: "URL biasa (tanpa pemendek yang dikenali)",
  pendek: "URL pendek teridentifikasi",
  merek: "Domain dengan indikasi kemiripan merek",
};
const dataLabels = {
  ...categories, ...partitions,
  unknown: "Belum Diketahui",
};

export function distribution(label, values) {
  if (!Object.keys(values ?? {}).length) return "";
  return table([label, "Jumlah Data"], Object.entries(values).map(([key, n]) => [
    Object.hasOwn(dataLabels, key) ? dataLabels[key] : key,
    formatted(n),
  ]));
}

export function renderResearchImport() {
  return `<details class="card research-import">
    <summary>Ringkasan Penelitian Tersimpan</summary>
    <p class="hint">Pilih hasil tersimpan atau impor berkas <code>research-summary.json</code> dari eksperimen sebelumnya.</p>
    <label for="research-report-file">Pilih Ringkasan Penelitian JSON</label>
    <input id="research-report-file" type="file" accept="application/json,.json">
    <p id="research-import-status" class="hint" role="status" aria-live="polite"></p>
    <p id="research-import-error" class="error" role="alert" hidden></p>
    <div id="research-report-selection"></div>
  </details>`;
}

export function mountResearchImport() {
  const input = document.querySelector("#research-report-file");
  const selection = document.querySelector("#research-report-selection");
  const status = document.querySelector("#research-import-status");
  const error = document.querySelector("#research-import-error");
  let disposed = false;
  const message = (persisted, savedText) => {
    status.textContent = persisted ? savedText : "Penyimpanan browser tidak tersedia. Perubahan hanya berlaku di sesi ini.";
  };
  function renderSelection() {
    const selected = currentResearchReport();
    selection.innerHTML = selected ? `<div class="section-heading">
      <label for="active-research-report">Ringkasan Eksperimen yang Ditampilkan</label>
      <select id="active-research-report">${researchReports().map((report) =>
        `<option value="${escape(report.experiment_id)}"${report === selected ? " selected" : ""}>${escape(report.dataset_name || report.dataset_version || "Dataset")} · ${escape(report.experiment_id)}</option>`).join("")}</select>
      </div><p class="hint">${formatted(selected.rows)} data · ${splitName(selected)}</p>
      <div class="actions"><a class="button" href="#evaluation">Lihat Evaluasi Penelitian</a>
      <button id="research-report-download" class="button secondary" type="button">Unduh Ringkasan Penelitian</button>
      <button id="research-report-remove" class="button secondary" type="button">Hapus Ringkasan dari Browser</button></div>` : "";
    if (!selected) return;
    selection.querySelector("#active-research-report").onchange = (event) => {
      message(selectResearchReport(event.target.value), "Ringkasan eksperimen dipilih.");
      renderSelection();
      selection.querySelector("#active-research-report")?.focus();
    };
    selection.querySelector("#research-report-download").onclick = () =>
      download("research-summary.json", selected);
    selection.querySelector("#research-report-remove").onclick = () => {
      message(removeResearchReport(selected.experiment_id), "Ringkasan eksperimen dihapus dari browser.");
      renderSelection();
      input.focus();
    };
  }
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    error.hidden = true;
    status.textContent = "";
    input.disabled = true;
    try {
      if (!file.size || file.size > MAX_RESEARCH_REPORT_BYTES)
        throw new Error("Pilih ringkasan JSON hingga 256 KiB.");
      const content = await file.text();
      if (disposed) return;
      let report;
      try {
        report = JSON.parse(content);
      } catch {
        throw new Error("Isi ringkasan bukan JSON yang valid.");
      }
      message(importResearchReport(report), "Ringkasan penelitian berhasil diimpor.");
      renderSelection();
    } catch (err) {
      if (disposed) return;
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      input.value = "";
      input.disabled = false;
    }
  };
  renderSelection();
  return {
    dispose() { disposed = true; },
    refresh: renderSelection,
  };
}

const auditCheckLabels = {
  group: "Kelompok gabungan",
  exact_url: "URL identik",
  normalized_url: "URL ternormalisasi",
  related_url: "URL terkait",
  domain: "Domain terdaftar",
  kelompok_audit: "Kelompok metadata",
  url_key_audit: "Kunci URL metadata",
};
const coverageLabels = {
  ...auditCheckLabels,
  registrable_domain: "Domain terdaftar dari metadata",
  domain_icann_audit: "Domain versi audit ICANN",
  url_asli_pasangan: "URL asal pasangan",
  url_tujuan_terverifikasi: "URL tujuan tercatat",
  keputusan_audit: "Keputusan audit",
  status_kategori_audit: "Status kategori",
  status_redirect_audit: "Status redirect",
  status_pelatihan_final: "Status pelatihan akhir",
};

export function renderResearchDashboard(report) {
  if (!report) return `<section class="card"><h3>Status Penelitian</h3><p>Belum ada hasil penelitian.</p><a class="button secondary" href="#dataset">Buka Manajemen Dataset</a></section>`;
  const totals = Object.values(report.split);
  const hasCategories = Object.keys(categories).some((name) => report.categories[name] > 0);
  const heuristic = report.scenario_kind === "heuristic";
  const preprocessing = report.preprocessing;
  return `<section class="card"><h3>Dataset Eksperimen</h3>
    <div class="status-list">
    <span>Eksperimen</span><b>${escape(report.experiment_id)}</b>
    ${report.dataset_name ? `<span>Nama Dataset</span><b>${escape(report.dataset_name)}</b>` : ""}
    ${report.dataset_version ? `<span>Versi Dataset</span><b>${escape(report.dataset_version)}</b>` : ""}
    <span>SHA-256 Dataset</span><b>${escape(report.dataset_hash)}</b>
    ${preprocessing?.source_rows != null ? `<span>Baris Awal</span><b>${formatted(preprocessing.source_rows)}</b>` : ""}
    <span>Data Valid untuk Eksperimen</span><b>${formatted(report.rows)}</b>
    ${preprocessing?.duplicate_rows != null ? `<span>Duplikat</span><b>${formatted(preprocessing.duplicate_rows)}</b>` : ""}
    <span>Benign</span><b>${formatted(totals.reduce((sum, part) => sum + part.benign, 0))}</b>
    <span>Phishing</span><b>${formatted(totals.reduce((sum, part) => sum + part.phishing, 0))}</b>
    <span>Pembagian</span><b>${splitName(report)}</b>
    <span>Audit Kebocoran</span><b>${heuristic ? "Tidak ditemukan kebocoran berdasarkan URL dan domain yang diperiksa." : "Lolos pemeriksaan yang tercatat dalam ringkasan."}</b>
    <span>Ekstraksi Fitur</span><b>Selesai${report.feature_schema ? ` · ${escape(report.feature_schema)}` : ""}</b>
    <span>Pelatihan dan Evaluasi</span><b>${formatted(report.results.length)} konfigurasi selesai</b>
    </div>
    <p class="hint">${heuristic ? "Audit berjalan offline. Tujuan di balik tautan pendek dan hubungan konten situs berada di luar cakupan." : "Cakupan audit mengikuti data yang tersedia saat eksperimen dijalankan."}</p>
    ${distribution("Data per Partisi", Object.fromEntries(Object.entries(report.split).map(([key, part]) => [key, part.rows])))}
    ${hasCategories && !heuristic ? distribution("Kategori Penelitian", report.categories) : ""}
    ${distribution("Sumber Dataset", report.sources)}
    ${distribution("Layanan Pemendek Terdeteksi", report.shorteners)}
    <div class="actions"><a class="button secondary" href="#evaluation">Lihat Evaluasi Penelitian</a><a class="button secondary" href="#dataset">Pilih Ringkasan Lain</a></div>
    </section>`;
}
const metricKeys = Object.keys(metrics);
const subsetRows = (report) => {
  const labels = report.scenario_kind === "heuristic" ? heuristicScenarios : scenarios;
  return report.results.flatMap((result) => Object.entries(result.scenarios)
    .map(([key, score]) => [result.id, labels[key], score]));
};
const shortenerRows = (report) => report.results.flatMap((result) => Object.entries(result.shortener_scenarios)
  .map(([provider, score]) => [result.id, provider, score]));

export function renderResearchEvaluation(report) {
  if (!report) return "";
  const subsets = subsetRows(report);
  const shorteners = shortenerRows(report);
  const scores = (value) => metricKeys.map((key) => percent(value[key]));
  const groupedMetrics = (name, rows) => table(
    ["ID", name, "Jumlah Data", "Benign", "Phishing", ...Object.values(metrics)],
    rows.map(([id, label, score]) => [
      id, label, formatted(score.rows), formatted(score.benign), formatted(score.phishing), ...scores(score),
    ]),
  );
  const validation = report.results.flatMap(({ id, validation_metrics }) =>
    validation_metrics ? [[id, report.split.validation.rows, ...scores(validation_metrics)]] : []);
  return `<section class="card"><div class="section-heading"><h3>Evaluasi Penelitian</h3>
    <div class="actions"><button type="button" class="button secondary" id="research-metrics-export">Ekspor Metrik Penelitian CSV</button>
    <button type="button" class="button secondary" id="research-json-export">Unduh Ringkasan JSON</button></div></div>
    <p class="hint">${escape(report.experiment_id)} · ${splitName(report)} · kelas positif phishing (1)</p>
    ${report.selected_configuration_id ? `<p>Konfigurasi terpilih berdasarkan data validasi <strong>${report.selected_configuration_id}</strong></p>` : ""}
    <h4>Hasil Utama pada Data Uji</h4>
    ${table(["ID", "Model", "Fitur", "Jumlah Data", ...Object.values(metrics), "Waktu Pelatihan", "Waktu Prediksi"],
      report.results.map((result) => [result.id, result.model_name, displayText(result.feature_set),
        formatted(result.metrics.rows ?? report.split.test.rows), ...scores(result.metrics),
        time(result.train_seconds), time(result.prediction_seconds)]))}
    ${validation.length ? `<details><summary>Skor Pembanding pada Data Validasi</summary>
      ${table(["ID", "Jumlah Data", ...Object.values(metrics)], validation)}
      </details>` : ""}
    <details><summary>Partisi Data dan Cakupan Audit</summary>
    ${table(["Partisi", "Jumlah Data", "Benign", "Phishing"], Object.entries(report.split)
      .map(([name, part]) => [partitions[name], formatted(part.rows), formatted(part.benign), formatted(part.phishing)]))}
    ${table(["Hubungan yang Diperiksa", "Konflik Lintas Split"], Object.entries(report.audit.checks)
      .map(([key, n]) => [Object.hasOwn(auditCheckLabels, key) ? auditCheckLabels[key] : key.replaceAll("_", " "), formatted(n)]))}
    ${Object.keys(report.audit.coverage).length ? table(["Kolom Metadata", "Baris dengan Nilai Tercatat"], Object.entries(report.audit.coverage)
      .map(([key, n]) => [Object.hasOwn(coverageLabels, key) ? coverageLabels[key] : key.replaceAll("_", " "), formatted(n)])) : ""}
    ${report.psl_version ? `<p class="hint">Versi Public Suffix List <code>${escape(report.psl_version)}</code></p>` : ""}
    </details>
    <h3>Evaluasi per Skenario pada Data Uji</h3>
    ${report.scenario_kind === "heuristic" ? '<p class="hint">Subset dibentuk dari ciri URL. Subset dapat bertumpang tindih. Indikasi kemiripan merek belum diverifikasi secara independen. Tujuan redirect historis tidak diketahui.</p>' : ""}
    <p class="hint">Metrik yang memerlukan kedua kelas, seperti ROC-AUC, hanya dapat dihitung jika benign dan phishing tersedia.</p>
    ${subsets.length ? groupedMetrics("Skenario", subsets) : "<p>Kategori penelitian belum tersedia pada data uji.</p>"}
    ${shorteners.length ? `<h3>Evaluasi per Layanan Pemendek</h3>${groupedMetrics("Layanan", shorteners)}` : ""}
    <h3>Matriks Kebingungan</h3><p class="hint">Matriks menggunakan baris kelas aktual dan kolom prediksi.</p>
    ${table(["ID", "Negatif Benar", "Positif Palsu", "Negatif Palsu", "Positif Benar"], report.results
      .filter((result) => result.metrics.confusion_matrix)
      .map((result) => [result.id, ...result.metrics.confusion_matrix.flat().map(formatted)]))}
    </section>`;
}
const chartMetrics = ["accuracy", "precision", "recall", "f1", "roc_auc"];

export function renderResearchAnalysis(report) {
  if (!report) return "";
  const featureImportance = report.results.flatMap((result) =>
    Object.entries(result.feature_importance)
      .sort((a, b) => b[1] - a[1])
      .map(([key, weight]) => [result.id, featureLabel(key), percent(weight)]));
  return `<section class="card"><h3>Perbandingan Eksperimen</h3>
    <p class="hint">Gunakan E1 dan E2 untuk membandingkan Random Forest dengan 7 dan 19 fitur pada data uji yang sama.</p>
    ${table(["ID", "Model", "Jumlah Fitur", ...chartMetrics.map((key) => metrics[key]), "Waktu Pelatihan", "Positif Palsu", "Negatif Palsu"],
      report.results.map((result) => [
        result.id, result.model_name, result.feature_set === "basic" ? 7 : 19,
        ...chartMetrics.map((key) => percent(result.metrics[key])), time(result.train_seconds),
        formatted(result.error_counts?.false_positive ?? result.metrics.confusion_matrix?.[0][1]),
        formatted(result.error_counts?.false_negative ?? result.metrics.confusion_matrix?.[1][0]),
      ]))}
    <a class="button secondary" href="#evaluation">Lihat Matriks Kebingungan dan Evaluasi per Skenario</a></section>
    <div class="grid two">${chartMetrics.map((key) => plot(`research-${key}`, metrics[key])).join("")}</div>
    ${featureImportance.length ? `<section class="card"><h3>Tingkat Kepentingan Fitur</h3><p class="hint">Bobot berbasis impuritas untuk model pohon.</p>${table(["ID", "Fitur", "Kepentingan"], featureImportance)}</section>` : ""}`;
}
export function mountResearchAnalysis(report) {
  if (!report) return;
  for (const key of chartMetrics)
    chart(`research-${key}`, "bar", report.results.map(({ id }) => id),
      report.results.map((result) => result.metrics[key]), metrics[key]);
}
export function mountResearchEvaluation(report) {
  if (!report) return;
  document.querySelector("#research-json-export").onclick = () =>
    download("research-summary.json", report);
  document.querySelector("#research-metrics-export").onclick = () => {
    const rows = report.results.flatMap((result) => [
      ["global", "global", result.metrics],
      ...Object.entries(result.scenarios).map(([key, score]) => ["skenario", key, score]),
      ...Object.entries(result.shortener_scenarios).map(([key, score]) => ["layanan", key, score]),
      ...(result.validation_metrics ? [["validasi", "global", result.validation_metrics]] : []),
    ].map(([scope, group, score]) => ({
      experiment_id: report.experiment_id,
      dataset_hash: report.dataset_hash,
      id: result.id,
      model_name: result.model_name,
      feature_set: result.feature_set,
      scope,
      group,
      scenario_kind: report.scenario_kind,
      partition: scope === "validasi" ? "validation" : "test",
      train_seconds: result.train_seconds,
      prediction_seconds: result.prediction_seconds,
      ...score,
      confusion_matrix: score.confusion_matrix == null ? null : JSON.stringify(score.confusion_matrix),
    })));
    download("research-metrics.csv", csv(rows), "text/csv");
  };
}
