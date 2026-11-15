import { datasetStore, trainingEligibility } from "../utils/dataset-state.js";
import { formatBytes } from "../utils/dataset-config.js";
import { escape, table } from "../utils/ui.js";
import { download } from "../utils/storage.js";

export function bindDatasetReadiness(button) {
  let running = false;
  const target = document.querySelector("#dataset-readiness");
  const update = (data) => {
    const eligibility = trainingEligibility(data);
    button.disabled = running || !eligibility.eligible;
    const input = document.querySelector("#dataset-file");
    if (input) input.disabled = running;
    target.innerHTML = `<strong>${escape(data.status === "Validated" ? "Dataset Ready" : data.status)}</strong><p>${escape(eligibility.reason)}</p>
      ${
        data.file
          ? table(
              ["Dataset", "Value"],
              [
                ["Name", data.name],
                ["Size", formatBytes(data.size)],
                ["Validation source", data.summary?.source || "Not validated"],
                ["Valid records", data.summary?.valid_records ?? "N/A"],
                ["Benign", data.summary?.class_distribution.benign ?? "N/A"],
                [
                  "Phishing",
                  data.summary?.class_distribution.phishing ?? "N/A",
                ],
              ],
            )
          : ""
      }
      <div class="actions"><a class="button secondary" href="#dataset">Open Dataset Management</a>${data.summary ? '<button id="dataset-config-export" class="button secondary">Export local training configuration</button>' : ""}</div>
      <p>Online training remains limited to the full original file: 2 MiB / 1,000 source rows plus domain-split checks. No subsets are selected automatically. For larger files:</p><code>python -m ml.train_local /path/to/dataset.csv</code><p>Run this command locally with the original CSV. This browser does not train the large dataset or combine chunk metrics.</p>`;
    document
      .querySelector("#dataset-config-export")
      ?.addEventListener("click", () =>
        download("local-training-config.json", {
          dataset_name: data.name,
          dataset_size: data.size,
          dataset_hash: data.summary.dataset_hash,
          validation_source: data.summary.source,
          valid_records: data.summary.valid_records,
          class_distribution: data.summary.class_distribution,
          command: "python -m ml.train_local /path/to/dataset.csv",
          random_state: 42,
          split:
            "Registered-domain groups; target 70/15/15; Python verifies eligibility",
          feature_sets: ["basic", "extended"],
          production_model: "Extended Random Forest",
          original_file_required: true,
          sampling: "No subset has been selected or used.",
        }),
      );
  };
  const unsubscribe = datasetStore.subscribe(update);
  return {
    dispose: unsubscribe,
    setBusy(value) {
      running = value;
      update(datasetStore.get());
    },
  };
}
