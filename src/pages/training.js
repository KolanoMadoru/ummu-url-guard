import { api } from "../utils/api.js";
import {
  heading,
  table,
  filePicker,
  bindFile,
  showError,
  busy,
} from "../utils/ui.js";
import { saveSummary, download } from "../utils/storage.js";
export function render(state) {
  return `${heading("Model Training", "Fit real models using independent registered-domain groups.")}
    <div class="grid two"><section class="card"><h2>Run an online experiment</h2><p>Random Forest, Logistic Regression and Decision Tree share one held-out test set. Model selection uses validation F1.</p>${filePicker()}<p id="selected-file" class="hint"></p><button id="train" class="button">Start Training & Compare Models</button><p id="training-progress" role="status"></p><p id="training-error" class="error" role="alert" hidden></p></section>
    <section class="card"><h3>Reproducible configuration</h3>${table(
      ["Parameter", "Value"],
      [
        ["n_estimators", 80],
        ["max_depth", 16],
        ["min_samples_split", 4],
        ["min_samples_leaf", 2],
        ["class_weight", "balanced"],
        ["random_state", 42],
        ["n_jobs", 1],
        ["Group split target", "70% train / 15% validation / 15% test"],
      ],
    )}</section></div>
    <div class="notice">Minimum 30 unique URLs, 10 registered-domain groups and 6 records per class. Both labels must occur in each split. Online experiments never replace the deployed model. Keep a final external holdout for research claims.</div>
    <section class="card" id="training-result">${state.report ? '<h3>Experiment available in this session</h3><p>Open evaluation to inspect actual held-out results.</p><div class="actions"><a class="button" href="#evaluation">Evaluate Model</a><button class="button secondary" id="export-report">Export Results</button></div>' : "<h3>Production inference</h3><p>No production model is bundled. Train on a provenance-checked dataset locally, verify the output, then redeploy the artifact.</p><code>python -m ml.train_local /path/to/dataset.csv</code>"}</section>`;
}
export function mount(state, navigate) {
  bindFile(state);
  document
    .querySelector("#export-report")
    ?.addEventListener("click", () =>
      download("experiment.json", state.report),
    );
  const button = document.querySelector("#train");
  const error = document.querySelector("#training-error");
  button.onclick = async () => {
    busy(button, true);
    error.hidden = true;
    const status = document.querySelector("#training-progress");
    status.textContent =
      "Fitting three models and evaluating held-out data. This may take up to 35 seconds…";
    try {
      if (!state.file) throw new Error("Select a labeled CSV first.");
      state.report = await api("train", { file: state.file });
      saveSummary(state.report);
      navigate("evaluation");
    } catch (e) {
      showError(error, e);
    } finally {
      busy(button, false);
      status.textContent = "";
    }
  };
}
