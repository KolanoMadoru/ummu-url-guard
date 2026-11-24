import { automaticResearch } from "../utils/automatic-research.js";
import { DATASET_LIMITS, formatBytes } from "../utils/dataset-config.js";
import { errorText } from "../utils/i18n.js";
import { currentResearchReport } from "../utils/research-reports.js";
import { escape } from "../utils/ui.js";

export const researchStages = {
  prepare: ["Pemrosesan Dataset", "Proses Dataset"],
  split: ["Audit dan Pembagian", "Audit dan Buat Split"],
  features: ["Ekstraksi Fitur", "Ekstrak Fitur Dataset"],
  train: ["Pelatihan Model", "Latih Enam Eksperimen"],
  evaluate: ["Evaluasi Model", "Evaluasi Model"],
};
const stageOrder = Object.keys(researchStages);
let file = null;

export function selectedResearchFile() {
  return file;
}

export function selectResearchFile(nextFile) {
  file = nextFile;
  return automaticResearch.reset();
}

export function canUseResearchFile(candidate) {
  return Boolean(candidate?.size) &&
    candidate.size <= DATASET_LIMITS.maxFileBytes &&
    /\.csv$/iu.test(candidate.name);
}

export function canRunResearch(snapshot, goal, { automatic = false } = {}) {
  if (snapshot.phase === "running" || snapshot.phase === "loading" || snapshot.completed.includes(goal))
    return false;
  if (!snapshot.completed.includes("prepare") && !canUseResearchFile(file)) return false;
  const prerequisite = stageOrder[stageOrder.indexOf(goal) - 1];
  return automatic || !prerequisite || snapshot.completed.includes(prerequisite);
}

export function researchStatus(snapshot) {
  if (snapshot.phase === "loading") return "Memuat Penelitian Tersimpan";
  if (snapshot.phase === "running") return "Sedang Diproses";
  if (snapshot.phase === "cancelled") return "Pemrosesan Dibatalkan";
  if (snapshot.phase === "failed") return "Gagal";
  if (snapshot.completed.includes("evaluate")) return "Penelitian Selesai";
  if (snapshot.dataset?.warnings?.length) return "Perlu Pemeriksaan";
  if (snapshot.completed.length) return "Tahap Berhasil";
  return file ? "File Terpilih" : "Belum Dimulai";
}
const stageLabel = (stage) => researchStages[stage]?.[0];
export const formatResearchCount = (value) =>
  Number.isFinite(value) ? value.toLocaleString("id-ID") : "—";

export function renderResearchProgress() {
  return `<div class="research-progress">
    <div class="section-heading">
      <strong data-research-status role="status">Belum Dimulai</strong>
      <span data-research-percent></span>
    </div>
    <progress data-research-progress max="100" value="0" aria-label="Progres tahap penelitian"></progress>
    <p data-research-progress-text class="hint"></p>
    <p data-research-storage class="hint" hidden></p>
    <p data-research-error class="error" role="alert" hidden></p>
  </div>`;
}

export function renderStageButtons(stages) {
  return stages.map((stage) => `<button class="button secondary" data-research-run="${stage}" type="button" disabled>${researchStages[stage][1]}</button>`).join("");
}

export function renderResearchStage(stage, description) {
  return `<section class="card" id="research-stage-panel">
    <p>${description}</p>
    <p id="selected-file" class="hint" data-research-selection></p>
    <div class="actions">${renderStageButtons([stage])}
      <a class="button secondary" href="#dataset">Buka Manajemen Dataset</a>
    </div>
    ${renderResearchProgress()}
  </section>`;
}

export function mountResearchControls(element, onUpdate = () => {}) {
  const status = element.querySelector("[data-research-status]");
  const progress = element.querySelector("[data-research-progress]");
  const percent = element.querySelector("[data-research-percent]");
  const detail = element.querySelector("[data-research-progress-text]");
  const storage = element.querySelector("[data-research-storage]");
  const error = element.querySelector("[data-research-error]");
  const filename = element.querySelector("[data-research-selection]");
  const buttons = [...element.querySelectorAll("[data-research-run]")];
  const cancel = element.querySelector("[data-research-cancel]");
  let disposed = false;

  for (const button of buttons) {
    button.onclick = async () => {
      error.hidden = true;
      try {
        await automaticResearch.run(file, button.dataset.researchRun);
      } catch (failure) {
        if (!disposed) {
          error.textContent = errorText(failure);
          error.hidden = false;
        }
      }
    };
  }
  if (cancel) cancel.onclick = () => automaticResearch.cancel();

  function update(snapshot) {
    const { processed, total, message } = snapshot.progress ?? {};
    const running = snapshot.phase === "running";
    const currentStage = stageLabel(snapshot.stage);
    const ratio = Number.isFinite(processed) && total > 0
      ? Math.round(Math.min(100, 100 * processed / total))
      : null;
    const statusText = researchStatus(snapshot);
    status.textContent = currentStage ? `${statusText} · ${currentStage}` : statusText;
    percent.textContent = ratio == null ? "" : `${ratio}%`;
    if (ratio != null) progress.value = ratio;
    else if (running) progress.removeAttribute("value");
    else progress.value = 0;
    const measured = ratio == null ? "" : `${formatResearchCount(processed)} / ${formatResearchCount(total)}`;
    detail.textContent = [message ?? "", measured].filter(Boolean).join(" · ");
    storage.textContent = snapshot.storageWarning ?? "";
    storage.hidden = !snapshot.storageWarning;
    error.hidden = !snapshot.error;
    error.textContent = snapshot.error ? errorText(snapshot.error) : "";
    if (filename) {
      const selection = file ?? snapshot.dataset;
      const size = selection?.size ?? selection?.bytes;
      filename.textContent = selection?.name
        ? `File terpilih: ${selection.name}${Number.isFinite(size) ? ` · ${formatBytes(size)}` : ""}`
        : "Pilih satu file CSV untuk memulai.";
    }
    for (const button of buttons)
      button.disabled = !canRunResearch(snapshot, button.dataset.researchRun, {
        automatic: button.hasAttribute("data-research-automatic"),
      });
    if (cancel) cancel.disabled = !running;
    onUpdate(snapshot);
  }

  const unsubscribe = automaticResearch.subscribe(update);
  return {
    refresh: () => {
      if (!disposed) update(automaticResearch.get());
    },
    dispose: () => {
      disposed = true;
      unsubscribe();
    },
  };
}

export function watchResearchReport(navigate) {
  const signature = () => {
    const report = currentResearchReport();
    return report ? `${report.experiment_id}:${Boolean(report.shortener_coverage)}` : null;
  };
  let current = signature();
  return automaticResearch.subscribe(() => {
    const changed = signature();
    if (changed === current) return;
    current = changed;
    navigate();
  });
}

export function researchReportCaption(report) {
  const { dataset } = automaticResearch.get();
  if (!report || (!dataset && !file) || report.dataset_hash === dataset?.hash) return "";
  return '<p class="notice">Ringkasan ini berasal dari dataset sebelumnya. Penelitian dataset terpilih memiliki hasilnya sendiri.</p>';
}

export function researchSelectionLabel(snapshot) {
  const name = file?.name || snapshot.dataset?.name;
  return name ? escape(name) : "Belum ada dataset";
}
