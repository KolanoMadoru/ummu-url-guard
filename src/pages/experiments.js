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
export function render(state) {
  const report = state.report?.feature_sets.includes("basic")
    ? state.report
    : null;
  return `${heading("Feature Experiment", "Compare basic and extended features with identical domain-disjoint data partitions.")}
    <section class="card"><div class="grid two"><div><h3>A · Basic lexical features</h3><p>URL length, domain length, digits, dots, hyphens, special characters and subdomain count.</p></div><div><h3>B · Extended features</h3><p>Basic plus entropy, keyword count, shortener indicator, registered-domain structure, typosquatting similarity, HTTPS, IP and ratios.</p></div></div>${filePicker()}<p id="selected-file" class="hint"></p><div id="dataset-readiness" class="dataset-readiness"></div><button id="run-experiment" class="button">Run A / B experiment</button><p id="experiment-progress" role="status"></p><p class="error" id="experiment-error" role="alert" hidden></p></section>
    ${report ? `<section class="card"><h3>Six models · one common test partition</h3>${comparison(report)}</section><div class="grid two">${plot("ab-accuracy", "Random Forest · accuracy")}${plot("ab-f1", "Random Forest · F1")}${plot("ab-recall", "Random Forest · recall")}${plot("ab-pr", "Random Forest · PR-AUC (average precision)")}</div>` : empty("Run the A / B experiment to compare actual feature sets. Added features may improve or worsen performance.")}`;
}
export function mount(state, navigate) {
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
        rf.map((r) => r.feature_set),
        rf.map((r) => r.metrics[key]),
        key,
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
      "Training six model / feature-set combinations on the same partitions…";
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
