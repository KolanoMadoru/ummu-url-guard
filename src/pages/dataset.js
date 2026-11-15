import { api } from "../utils/api.js";
import {
  heading,
  filePicker,
  bindFile,
  table,
  showError,
  busy,
} from "../utils/ui.js";
import { download } from "../utils/storage.js";
export function render() {
  return `${heading("Dataset Management", "Validate a real labeled dataset before starting an experiment.")}
    <section class="card"><h2>Upload a CSV dataset</h2><p>Required columns: <code>url,label</code>. Labels: <code>phishing</code> / <code>benign</code> (also 1 / 0).</p>${filePicker()}<p id="selected-file" class="hint"></p><div class="actions"><button id="analyze" class="button">Validate dataset</button><button id="summary-download" class="button secondary" disabled>Download summary</button><a class="button secondary" href="#training">Model Training</a></div><p id="dataset-error" role="alert" class="error" hidden></p></section>
    <div id="dataset-result"></div><div class="notice">Uploads are processed for the request only. The selected file stays in browser memory until you leave. Datasets are never stored in localStorage. Preview URLs are masked to their origin.</div>`;
}
export function mount(state) {
  bindFile(state);
  const output = document.querySelector("#dataset-result");
  const button = document.querySelector("#analyze");
  const exportButton = document.querySelector("#summary-download");
  const error = document.querySelector("#dataset-error");
  button.onclick = async () => {
    error.hidden = true;
    busy(button, true);
    try {
      if (!state.file) throw new Error("Select a CSV file first.");
      const summary = await api("dataset/analyze", { file: state.file });
      state.dataset = summary;
      output.innerHTML = `<section class="card"><h3>Validation summary</h3>${table(
        ["Measure", "Value"],
        [
          ["Source records", summary.total_records],
          ["Unique records", summary.unique_records],
          ["Phishing", summary.class_distribution.phishing],
          ["Benign", summary.class_distribution.benign],
          ["Missing values", summary.missing_values],
          ["Duplicates removed", summary.duplicate_records],
          ["Conflicting labels", summary.conflicting_labels],
          ["Domain groups", summary.domain_groups],
          ["SHA-256", summary.dataset_hash],
          ["Validation", summary.validation],
        ],
      )}</section><section class="card"><h3>First 10 unique records · masked</h3>${table(
        ["URL origin", "Label"],
        summary.preview.map((r) => [r.url, r.label]),
      )}</section>`;
      exportButton.disabled = false;
      exportButton.onclick = () => download("dataset-summary.json", summary);
    } catch (e) {
      showError(error, e);
    } finally {
      busy(button, false);
    }
  };
}
