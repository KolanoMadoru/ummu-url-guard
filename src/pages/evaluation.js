import { displayText } from "../utils/i18n.js";
import {
  heading,
  empty,
  table,
  percent,
  escape,
  showError,
  busy,
} from "../utils/ui.js";
import { curve, plot, chart } from "../utils/charts.js";
import { download } from "../utils/storage.js";
import { api } from "../utils/api.js";
import { currentResearchReport } from "../utils/research-reports.js";
import { mountResearchEvaluation, renderResearchEvaluation } from "../components/research-workspace.js";
export const metricKeys = [
  "accuracy",
  "precision",
  "recall",
  "f1",
  "roc_auc",
  "pr_auc",
];
export function comparison(report) {
  return table(
    [
      "Model",
      "Kelompok Fitur",
      "Akurasi",
      "Presisi",
      "Recall",
      "Skor F1",
      "ROC-AUC",
      "PR-AUC (AP)",
      "Dipilih melalui validasi",
    ],
    report.results.map((r) => [
      r.model_name,
      displayText(r.feature_set),
      ...metricKeys.map((k) => percent(r.metrics[k])),
      r.selected_on_validation ? "Ya" : "Tidak",
    ]),
  );
}
export function render(state) {
  const report = state.report;
  const research = currentResearchReport();
  const rf = report?.results.find(
    (r) => r.model_name === "Random Forest" && r.feature_set === "extended",
  );
  return `${heading("Evaluasi Model", "Performa pada data uji terpisah. Kelas positif: phishing. Metrik yang tidak terdefinisi ditandai Tidak Tersedia.")}
    ${
      report
        ? `<section class="card"><div class="section-heading"><h3>Perbandingan Model</h3><button class="button secondary" id="evaluation-export">Ekspor Hasil</button></div><p class="hint">Eksperimen ${escape(report.experiment_id)} · ${escape(report.evaluation_timestamp)}</p>${comparison(report)}</section><div class="grid two">${plot("roc", "Random Forest · Kurva ROC")}${plot("pr", "Random Forest · Kurva Presisi-Recall")}</div><div class="grid two"><section class="card"><h3>Matriks Kebingungan Random Forest</h3><p class="hint">Baris: kelas aktual · kolom: prediksi</p>${table(
            ["Aktual / prediksi", "Aman (benign)", "Phishing"],
            [
              ["Aman (benign)", ...rf.metrics.confusion_matrix[0]],
              ["Phishing", ...rf.metrics.confusion_matrix[1]],
            ],
          )}</section>${plot("test-classes", "Distribusi Kelas Data Uji")}</div><section class="card"><h3>Audit Pembagian Data</h3><p>${escape(displayText(report.split_method))}</p>${table(
            ["Partisi", "Jumlah Data", "Kelompok Domain", "Aman (benign)", "Phishing"],
            Object.entries(report.split).map(([name, part]) => [
              displayText(name),
              part.rows,
              part.groups,
              part.class_distribution.benign,
              part.class_distribution.phishing,
            ]),
          )}<p class="hint">Validasi digunakan untuk memilih model; metrik data uji bukan target penyetelan. PR-AUC dilaporkan sebagai rerata presisi.</p></section>`
        : research ? "" : empty()
    }
    ${renderResearchEvaluation(research)}
    <section class="card"><h3>Evaluasi Prediksi pada Data Uji Independen</h3><p>Unggah JSON berisi larik <code>actual</code>, <code>predicted</code> (0=benign, 1=phishing), dan <code>phishing_scores</code>. Metrik dihitung ulang; asal-usul dataset tetap harus diverifikasi.</p><label class="file-picker" for="evaluation-file">Pilih File Prediksi JSON<input class="visually-hidden" id="evaluation-file" type="file" accept=".json,application/json" /><span class="file-select" aria-hidden="true">Pilih File</span></label><p id="evaluation-selected" class="hint" role="status">Belum ada file terpilih.</p><button class="button secondary" id="evaluate-upload">Evaluasi Prediksi</button><p class="error" id="evaluation-error" role="alert" hidden></p><div id="independent-metrics"></div></section>`;
}
export function mount(state) {
  mountResearchEvaluation(currentResearchReport());
  document.querySelector("#evaluation-file").onchange = (event) => {
    document.querySelector("#evaluation-selected").textContent = event.target.files[0]?.name || "Belum ada file terpilih.";
  };
  const rf = state.report?.results.find(
    (r) => r.model_name === "Random Forest" && r.feature_set === "extended",
  );
  if (rf) {
    curve("roc", rf.metrics.roc_curve, "ROC");
    curve("pr", rf.metrics.pr_curve, "Presisi-Recall");
    chart(
      "test-classes",
      "doughnut",
      ["Aman (benign)", "Phishing"],
      [
        rf.metrics.class_distribution.benign,
        rf.metrics.class_distribution.phishing,
      ],
    );
  }
  document
    .querySelector("#evaluation-export")
    ?.addEventListener("click", () =>
      download("experiment.json", state.report),
    );
  document.querySelector("#evaluate-upload").onclick = async () => {
    const button = document.querySelector("#evaluate-upload");
    const error = document.querySelector("#evaluation-error");
    error.hidden = true;
    busy(button, true);
    try {
      const file = document.querySelector("#evaluation-file").files[0];
      if (!file || file.size > 250000)
        throw new Error("Pilih file prediksi JSON berukuran kurang dari 250 KB.");
      const result = await api("evaluate", {
        json: JSON.parse(await file.text()),
      });
      document.querySelector("#independent-metrics").innerHTML = table(
        ["Metrik", "Nilai"],
        metricKeys.map((k) => [displayText(k), displayText(percent(result.metrics[k]))]),
      );
    } catch (e) {
      showError(error, e);
    } finally {
      busy(button, false);
    }
  };
}
