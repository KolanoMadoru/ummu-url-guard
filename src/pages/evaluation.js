import { displayText } from "../utils/i18n.js";
import { heading, empty, table, percent, showError, busy } from "../utils/ui.js";
import { api } from "../utils/api.js";
import { currentResearchReport } from "../utils/research-reports.js";
import {
  mountResearchControls, renderResearchStage, researchReportCaption, watchResearchReport,
} from "../components/automatic-research.js";
import { mountResearchEvaluation, renderResearchEvaluation } from "../components/research-workspace.js";

const independentMetricKeys = ["accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc"];

export function render() {
  const report = currentResearchReport();
  return `${heading("Evaluasi Model", "Ukur performa pada data uji terpisah dengan phishing sebagai kelas positif.")}
    ${renderResearchStage("evaluate", "Evaluasi konfigurasi yang sudah dilatih pada partisi uji yang tersimpan.")}
    ${report ? researchReportCaption(report) + renderResearchEvaluation(report)
      : empty("Selesaikan pelatihan dan evaluasi untuk melihat metrik penelitian.")}
    <section class="card"><details class="research-options">
      <summary>Evaluasi Prediksi pada Data Uji Independen</summary>
      <p>Unggah JSON dengan larik <code>actual</code>, <code>predicted</code> dan <code>phishing_scores</code>. Gunakan label 0 untuk benign dan 1 untuk phishing.</p>
      <label class="file-picker" for="evaluation-file">Pilih File Prediksi JSON<input class="visually-hidden" id="evaluation-file" type="file" accept=".json,application/json"><span class="file-select" aria-hidden="true">Pilih File</span></label>
      <p id="evaluation-selected" class="hint" role="status"></p><button class="button secondary" id="evaluate-upload">Evaluasi Prediksi</button>
      <p class="error" id="evaluation-error" role="alert" hidden></p><div id="independent-metrics"></div>
    </details></section>`;
}

export function mount(_state, navigate) {
  mountResearchEvaluation(currentResearchReport());
  const controls = mountResearchControls(document.querySelector("#research-stage-panel"));
  const unwatch = watchResearchReport(() => navigate("evaluation"));
  const picker = document.querySelector("#evaluation-file");
  const output = document.querySelector("#independent-metrics");
  picker.onchange = () => {
    document.querySelector("#evaluation-selected").textContent = picker.files[0]?.name ?? "";
  };
  const button = document.querySelector("#evaluate-upload");
  const error = document.querySelector("#evaluation-error");
  button.onclick = async () => {
    error.hidden = true;
    busy(button, true);
    try {
      const file = picker.files[0];
      if (!file || file.size > 250000)
        throw new Error("Pilih file prediksi JSON berukuran kurang dari 250 KB.");
      const result = await api("evaluate", { json: JSON.parse(await file.text()) });
      output.innerHTML = table(
        ["Metrik", "Nilai"],
        independentMetricKeys.map((key) => [displayText(key), percent(result.metrics[key])]),
      );
    } catch (e) {
      showError(error, e);
    } finally {
      busy(button, false);
    }
  };
  return () => {
    unwatch();
    controls.dispose();
  };
}
