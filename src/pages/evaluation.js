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
      "Feature set",
      "Accuracy",
      "Precision",
      "Recall",
      "F1",
      "ROC-AUC",
      "PR-AUC (AP)",
      "Selected on validation",
    ],
    report.results.map((r) => [
      r.model_name,
      r.feature_set,
      ...metricKeys.map((k) => percent(r.metrics[k])),
      r.selected_on_validation ? "Yes" : "No",
    ]),
  );
}
export function render(state) {
  const report = state.report;
  const rf = report?.results.find(
    (r) => r.model_name === "Random Forest" && r.feature_set === "extended",
  );
  return `${heading("Model Evaluation", "Actual held-out performance. Positive class: phishing. Undefined metrics are N/A.")}
    ${
      report
        ? `<section class="card"><div class="section-heading"><h3>Model comparison</h3><button class="button secondary" id="evaluation-export">Export Results</button></div><p class="hint">Experiment ${escape(report.experiment_id)} · ${escape(report.evaluation_timestamp)}</p>${comparison(report)}</section><div class="grid two">${plot("roc", "Random Forest · ROC curve")}${plot("pr", "Random Forest · precision-recall curve")}</div><div class="grid two"><section class="card"><h3>Random Forest confusion matrix</h3><p class="hint">Rows: actual · columns: predicted</p>${table(
            ["Actual / predicted", "Benign", "Phishing"],
            [
              ["Benign", ...rf.metrics.confusion_matrix[0]],
              ["Phishing", ...rf.metrics.confusion_matrix[1]],
            ],
          )}</section>${plot("test-classes", "Test class distribution")}</div><section class="card"><h3>Split audit</h3><p>${escape(report.split_method)}</p>${table(
            ["Partition", "Rows", "Domain groups", "Benign", "Phishing"],
            Object.entries(report.split).map(([name, part]) => [
              name,
              part.rows,
              part.groups,
              part.class_distribution.benign,
              part.class_distribution.phishing,
            ]),
          )}<p class="hint">Validation selects the model; test metrics are not tuning targets. PR-AUC is reported as average precision.</p></section>`
        : empty()
    }
    <section class="card"><h3>Evaluate independent held-out predictions</h3><p>Upload JSON with <code>actual</code>, <code>predicted</code> (0=benign, 1=phishing), and <code>phishing_scores</code> arrays. This recomputes metrics; it does not certify dataset provenance.</p><input id="evaluation-file" type="file" accept=".json,application/json" /><button class="button secondary" id="evaluate-upload">Evaluate predictions</button><p class="error" id="evaluation-error" role="alert" hidden></p><div id="independent-metrics"></div></section>`;
}
export function mount(state) {
  const rf = state.report?.results.find(
    (r) => r.model_name === "Random Forest" && r.feature_set === "extended",
  );
  if (rf) {
    curve("roc", rf.metrics.roc_curve, "ROC");
    curve("pr", rf.metrics.pr_curve, "Precision-recall");
    chart(
      "test-classes",
      "doughnut",
      ["Benign", "Phishing"],
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
        throw new Error("Select a predictions JSON file smaller than 250 KB.");
      const result = await api("evaluate", {
        json: JSON.parse(await file.text()),
      });
      document.querySelector("#independent-metrics").innerHTML = table(
        ["Metric", "Value"],
        metricKeys.map((k) => [k, percent(result.metrics[k])]),
      );
    } catch (e) {
      showError(error, e);
    } finally {
      busy(button, false);
    }
  };
}
