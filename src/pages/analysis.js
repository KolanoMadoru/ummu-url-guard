import { heading, empty, table, escape, percent } from "../utils/ui.js";
import { comparison } from "./evaluation.js";
import { download, csv } from "../utils/storage.js";
import { chart, plot } from "../utils/charts.js";
export function render(state) {
  const r = state.report;
  if (!r)
    return (
      heading(
        "Result Analysis",
        "Interpret evidence, error patterns and reproducibility metadata.",
      ) + empty()
    );
  const rf = r.results.find(
    (x) => x.model_name === "Random Forest" && x.feature_set === "extended",
  );
  const sorted = Object.entries(rf.feature_importance).sort(
    (a, b) => b[1] - a[1],
  );
  return `${heading("Result Analysis", "Review actual model errors and export a reproducible research record.")}
    <section class="card"><div class="actions"><button class="button" id="export-json">Export JSON</button><button class="button secondary" id="export-csv">Export metrics CSV</button><button class="button secondary" id="export-research">Export research summary</button></div></section>
    <div class="grid two">${plot("importance", "Extended Random Forest · top feature importance")}<section class="card"><h3>Feature ranking</h3><p class="hint">Impurity importance is associative, can favor high-cardinality features, and is not causal evidence.</p>${table(
      ["Rank", "Feature", "Importance"],
      sorted.map(([key, value], i) => [i + 1, key, percent(value)]),
    )}</section></div>
    <section class="card"><h3>False positives and false negatives</h3><p class="hint">Only errors from the held-out test set. URLs are masked to the origin.</p>${table(
      ["Model", "Features", "URL origin", "Actual", "Predicted", "Error"],
      r.results.flatMap((model) =>
        model.errors.map((error) => [
          model.model_name,
          model.feature_set,
          error.url,
          error.actual,
          error.predicted,
          error.type,
        ]),
      ),
    )}</section>
    <section class="card"><h3>Model comparison</h3>${comparison(r)}</section><section class="card"><h3>Reproducibility record</h3>${table(
      ["Field", "Value"],
      [
        ["Experiment ID", r.experiment_id],
        ["Dataset name", r.dataset_name],
        ["Dataset SHA-256", r.dataset_hash],
        ["Model version", r.model_version],
        ["Feature sets", r.feature_sets.join(", ")],
        ["Schema", r.schema_version],
        ["Random seed", r.random_seed],
        ["Effective split seed", r.split_seed],
        ["Evaluated at", r.evaluation_timestamp],
        ["Partition method", r.split_method],
      ],
    )}<ul>${r.notes.map((note) => `<li>${escape(note)}</li>`).join("")}</ul></section>`;
}
export function mount(state) {
  const r = state.report;
  if (!r) return;
  const rf = r.results.find(
    (x) => x.model_name === "Random Forest" && x.feature_set === "extended",
  );
  const entries = Object.entries(rf.feature_importance)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  chart(
    "importance",
    "bar",
    entries.map((x) => x[0]),
    entries.map((x) => x[1]),
    "Importance",
  );
  document.querySelector("#export-json").onclick = () =>
    download("experiment.json", r);
  document.querySelector("#export-csv").onclick = () =>
    download(
      "experiment-metrics.csv",
      csv(
        r.results.map((x) => ({
          experiment_id: r.experiment_id,
          dataset_hash: r.dataset_hash,
          dataset_name: r.dataset_name,
          model: x.model_name,
          model_version: r.model_version,
          feature_set: x.feature_set,
          random_seed: r.random_seed,
          split_seed: r.split_seed,
          evaluation_timestamp: r.evaluation_timestamp,
          train_rows: r.split.train.rows,
          validation_rows: r.split.validation.rows,
          test_rows: r.split.test.rows,
          ...Object.fromEntries(
            ["accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc"].map(
              (k) => [k, x.metrics[k]],
            ),
          ),
        })),
      ),
      "text/csv",
    );
  document.querySelector("#export-research").onclick = () =>
    download(
      "research-summary.txt",
      [
        "UMMU URL GUARD — research summary",
        `Experiment: ${r.experiment_id}`,
        `Dataset SHA-256: ${r.dataset_hash}`,
        `Evaluated: ${r.evaluation_timestamp}`,
        `Seed: ${r.random_seed}; split seed: ${r.split_seed}`,
        r.split_method,
        ...r.results.map(
          (x) =>
            `${x.model_name} (${x.feature_set}): accuracy ${percent(x.metrics.accuracy)}, precision ${percent(x.metrics.precision)}, recall ${percent(x.metrics.recall)}, F1 ${percent(x.metrics.f1)}, ROC-AUC ${percent(x.metrics.roc_auc)}, PR-AUC (AP) ${percent(x.metrics.pr_auc)}. Errors: ${x.errors.length}.`,
        ),
        ...r.notes,
        "Machine learning prediction is an indicator, not a guarantee of website safety.",
      ].join("\n"),
      "text/plain",
    );
}
