import { automaticResearch } from "../utils/automatic-research.js";
import { download } from "../utils/storage.js";
import { busy, escape, percent, showError, table } from "../utils/ui.js";

const METRICS = {
  accuracy: "Akurasi",
  precision: "Presisi",
  recall: "Recall",
  f1: "Skor F1",
  roc_auc: "ROC-AUC",
};
const EXCLUSIONS = {
  no_evidence: "Bukti tidak tersedia",
  ambiguous_evidence: "Bukti bertentangan",
  invalid_evidence: "Bukti tidak lengkap atau tidak valid",
  initial_url_mismatch: "URL awal berbeda dari record data uji",
  invalid_destination: "URL tujuan tidak valid atau fitur tidak tersedia",
  unchanged_destination: "URL tujuan sama dengan URL awal",
  destination_overlap: "Tujuan terkait dengan data latih atau validasi",
};
const count = (value) => Number.isFinite(value) ? value.toLocaleString("id-ID") : "N/A";

export function renderRedirectResearch() {
  return `<section class="card" id="redirect-research-panel" aria-labelledby="redirect-research-title">
    <h3 id="redirect-research-title">Analisis Pasangan Redirect Historis</h3>
    <p>Gunakan bukti tujuan yang telah didokumentasikan untuk membandingkan URL awal dan URL tujuan pada pasangan data uji yang sama. Analisis tambahan ini mempertahankan evaluasi global dan per skenario.</p>
    <details>
      <summary>Format CSV Bukti Redirect</summary>
      <p>Sertakan kolom <code>row,url_awal,url_tujuan,sumber</code>. Ambil nomor <code>row</code> dari <strong>Unduh Pembagian Dataset</strong> dan isi <code>sumber</code> dengan sitasi atau ID arsip. Label diambil dari dataset penelitian yang aktif.</p>
      <p class="hint">Tujuan historis berasal dari file bukti. Aplikasi menghitung fitur leksikal tanpa mengunjungi URL tersebut. Hasil pemeriksaan redirect di Pemindai URL adalah observasi saat pemindaian.</p>
    </details>
    <form id="redirect-research-form">
      <label class="file-picker" for="redirect-evidence-file">Pilih Bukti Redirect CSV
        <input class="visually-hidden" id="redirect-evidence-file" type="file" accept=".csv,text/csv" disabled>
        <span class="file-select" aria-hidden="true">Pilih File</span>
      </label>
      <p id="redirect-evidence-selected" class="hint"></p>
      <button class="button secondary" type="submit" disabled>Bandingkan Pasangan Redirect</button>
    </form>
    <p id="redirect-research-status" class="hint" role="status"></p>
    <p id="redirect-research-error" class="error" role="alert" hidden></p>
    <div id="redirect-research-result"></div>
  </section>`;
}

function renderResult(report) {
  const { counts, exclusions, sources, metrics, ignored_evidence_records } = report;
  const sourceRows = Object.entries(sources).sort((a, b) => b[1] - a[1]);
  const initial = metrics.initial;
  const destination = metrics.destination;
  const matrixRows = [
    ["URL awal", initial?.confusion_matrix],
    ["URL tujuan", destination?.confusion_matrix],
  ].filter(([, matrix]) => matrix != null);
  const scores = Object.entries(METRICS).map(([key, label]) => [
    label, percent(initial?.[key]), percent(destination?.[key]),
  ]);
  return `<h4>Hasil pada Pasangan Data Uji</h4>
    <p class="hint">Eksperimen ${escape(report.experiment_id)} · Random Forest E2 (19 fitur) · versi model ${escape(report.model_version)}</p>
    ${table(["Cakupan", "Jumlah"], [
      ["Tautan pendek dalam data uji", count(counts.test_short_links)],
      ["Pasangan dengan bukti tercatat", count(counts.documented_pairs)],
      ["Pasangan dievaluasi", count(counts.evaluated_pairs)],
      ["Tautan pendek yang tidak dievaluasi", count(counts.not_evaluated)],
      ["Record bukti di luar subset atau tidak terpakai", count(ignored_evidence_records)],
    ])}
    ${table(["Alasan tautan uji tidak dievaluasi", "Jumlah"], Object.entries(EXCLUSIONS).map(([key, label]) => [
      label, count(exclusions[key] ?? 0),
    ]))}
    ${sourceRows.length ? table(["Sumber Bukti Pasangan yang Dievaluasi", "Jumlah"], sourceRows.slice(0, 20)
      .map(([source, n]) => [source, count(n)])) : "<p>Belum ada sumber bukti untuk pasangan yang dievaluasi.</p>"}
    ${sourceRows.length > 20 ? '<p class="hint">Laporan JSON memuat semua sumber bukti.</p>' : ""}
    ${initial && destination ? table(["Metrik pada pasangan yang sama", "URL Awal", "URL Tujuan"], [
      ["Jumlah pasangan", count(initial.rows), count(destination.rows)],
      ["Label benign", count(initial.benign), count(destination.benign)],
      ["Label phishing", count(initial.phishing), count(destination.phishing)],
      ...scores,
    ]) : "<p>Metrik perbandingan memerlukan sedikitnya satu pasangan yang dapat dievaluasi.</p>"}
    ${matrixRows.length ? table(["Representasi", "Negatif Benar", "Positif Palsu", "Negatif Palsu", "Positif Benar"],
      matrixRows.map(([label, matrix]) => [label, ...matrix.flat().map(count)])) : ""}
    <p class="hint">Model E2 dilatih menggunakan URL awal. Prediksi URL tujuan memakai model yang sama untuk perbandingan eksploratif. Kedua representasi memakai label asli yang sama. ROC-AUC tersedia jika kedua kelas ada. Skor model belum dikalibrasi.</p>
    <button class="button secondary" type="button" id="redirect-research-export">Unduh Analisis Pasangan JSON</button>`;
}

export function mountRedirectResearch() {
  const panel = document.querySelector("#redirect-research-panel");
  const form = panel.querySelector("form");
  const input = form.querySelector("input");
  const submit = form.querySelector("button");
  const selected = form.querySelector("#redirect-evidence-selected");
  const status = panel.querySelector("#redirect-research-status");
  const error = panel.querySelector("#redirect-research-error");
  const result = panel.querySelector("#redirect-research-result");
  let disposed = false;
  let comparing = false;
  let renderedReport;

  function update(snapshot) {
    const pending = comparing || snapshot.redirectComparisonRunning;
    const ready = snapshot.redirectComparisonReady && snapshot.phase !== "running";
    input.disabled = !ready || Boolean(pending);
    busy(submit, Boolean(pending));
    submit.disabled ||= !ready || !input.files.length;
    selected.textContent = input.files[0]?.name ?? "";
    status.textContent = pending ? "Membandingkan pasangan redirect historis…"
      : snapshot.phase === "loading" ? "Memuat eksperimen aktif…"
      : ready ? (snapshot.redirectComparison ? "Analisis pasangan tersedia." : "Pilih CSV bukti redirect.")
      : "Analisis pasangan memerlukan eksperimen aktif yang selesai. Jalankan ulang penelitian untuk workspace lama atau ringkasan impor.";

    const report = snapshot.redirectComparison;
    if (report === renderedReport) return;
    renderedReport = report;
    result.innerHTML = report ? renderResult(report) : "";
    if (!report) return;
    result.querySelector("#redirect-research-export").onclick = async () => {
      error.hidden = true;
      try {
        download("analisis-pasangan-redirect.json", await automaticResearch.export("redirects"));
      } catch (failure) {
        if (!disposed) showError(error, failure);
      }
    };
  }

  input.onchange = () => {
    error.hidden = true;
    update(automaticResearch.get());
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const file = input.files[0];
    if (!file || comparing) return;
    error.hidden = true;
    if (!/\.csv$/iu.test(file.name) || !file.size) {
      showError(error, "Pilih file bukti CSV yang berisi data.");
      return;
    }
    comparing = true;
    update(automaticResearch.get());
    try {
      await automaticResearch.compareRedirects(file);
    } catch (failure) {
      if (!disposed) showError(error, failure);
    } finally {
      comparing = false;
      if (!disposed) update(automaticResearch.get());
    }
  };
  const unsubscribe = automaticResearch.subscribe(update);
  return () => {
    disposed = true;
    unsubscribe();
  };
}
