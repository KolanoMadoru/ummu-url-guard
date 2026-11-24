import { displayText } from "../utils/i18n.js";
import { datasetStore, trainingEligibility } from "../utils/dataset-state.js";
import { bindDatasetReadiness } from "../components/dataset-readiness.js";
import { api } from "../utils/api.js";
import {
  heading,
  filePicker,
  bindFile,
  empty,
  showError,
  busy,
} from "../utils/ui.js";
import { comparison } from "./evaluation.js";
import { saveSummary } from "../utils/storage.js";
import { chart, plot } from "../utils/charts.js";
import { currentResearchReport } from "../utils/research-reports.js";
import { mountResearchAnalysis, renderResearchAnalysis } from "../components/research-workspace.js";
export function render(state) {
  const research = currentResearchReport();
  const report = state.report?.feature_sets.includes("basic")
    ? state.report
    : null;
  return `${heading("Eksperimen Fitur", "Bandingkan fitur dasar dan fitur tambahan pada partisi data yang sama tanpa irisan domain.")}
    <section class="card"><div class="grid two"><div><h3>A · Fitur Dasar</h3><p>Panjang URL, panjang domain, angka, titik, tanda hubung, karakter khusus, dan jumlah subdomain.</p></div><div><h3>B · Fitur Tambahan</h3><p>Fitur dasar ditambah entropi, jumlah kata kunci, indikator pemendek, struktur domain terdaftar, kemiripan typosquatting, HTTPS, IP, dan rasio.</p></div></div>${filePicker()}<p id="selected-file" class="hint"></p><div id="dataset-readiness" class="dataset-readiness"></div><button id="run-experiment" class="button">Jalankan Eksperimen A / B</button><p id="experiment-progress" role="status"></p><p class="error" id="experiment-error" role="alert" hidden></p></section>
    ${report ? `<section class="card"><h3>Enam Model · Satu Partisi Uji yang Sama</h3>${comparison(report)}</section><div class="grid two">${plot("ab-accuracy", "Random Forest · Akurasi")}${plot("ab-f1", "Random Forest · F1")}${plot("ab-recall", "Random Forest · Recall")}${plot("ab-pr", "Random Forest · PR-AUC (rerata presisi)")}</div>` : research ? "" : empty("Jalankan eksperimen A / B untuk membandingkan kedua kelompok fitur. Fitur tambahan dapat meningkatkan atau menurunkan performa.")}
    ${renderResearchAnalysis(research)}`;
}
export function mount(state, navigate) {
  mountResearchAnalysis(currentResearchReport());
  const unbindFile = bindFile();
  const readiness = bindDatasetReadiness(
    document.querySelector("#run-experiment"),
  );
  const report = state.report?.feature_sets.includes("basic")
    ? state.report
    : null;
  if (report) {
    const rf = report.results.filter((r) => r.model_name === "Random Forest");
    [
      ["ab-accuracy", "accuracy"],
      ["ab-f1", "f1"],
      ["ab-recall", "recall"],
      ["ab-pr", "pr_auc"],
    ].forEach(([id, key]) =>
      chart(
        id,
        "bar",
        rf.map((r) => displayText(r.feature_set)),
        rf.map((r) => r.metrics[key]),
        displayText(key),
      ),
    );
  }
  document.querySelector("#run-experiment").onclick = async () => {
    const button = document.querySelector("#run-experiment");
    const error = document.querySelector("#experiment-error");
    const status = document.querySelector("#experiment-progress");
    error.hidden = true;
    readiness.setBusy(true);
    busy(button, true);
    status.textContent =
      "Sedang melatih enam kombinasi model dan kelompok fitur pada partisi yang sama…";
    try {
      const dataset = datasetStore.get();
      const eligibility = trainingEligibility(dataset);
      if (!eligibility.eligible) throw new Error(eligibility.reason);
      state.report = await api("experiment", { file: dataset.file });
      saveSummary(state.report);
      navigate("experiments");
    } catch (e) {
      showError(error, e);
    } finally {
      busy(button, false);
      readiness.setBusy(false);
      status.textContent = "";
    }
  };
  return () => {
    unbindFile();
    readiness.dispose();
  };
}
