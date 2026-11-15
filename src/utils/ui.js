import { datasetStore } from "./dataset-state.js";
import { DATASET_LIMITS, formatBytes } from "./dataset-config.js";
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const percent = (value) =>
  value == null ? "N/A" : `${(value * 100).toFixed(1)}%`;
export function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((x) => `<th scope="col">${escape(x)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((x) => `<td>${escape(x)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="empty">No data available.</td></tr>`}</tbody></table></div>`;
}
export function empty(
  message = "No experiment yet. Upload a labeled CSV and run model training to see actual results.",
) {
  return `<div class="empty-state"><i data-lucide="flask-conical"></i><h3>No results yet</h3><p>${escape(message)}</p><a class="button" href="#dataset">Open Dataset Management</a></div>`;
}
export function heading(title, description, extra = "") {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${extra}</div>`;
}
export function showError(target, error) {
  target.textContent = error.message || String(error);
  target.hidden = false;
}
export function busy(button, status) {
  button.disabled = status;
  button.classList.toggle("loading", status);
}
export function filePicker() {
  return `<label class="file-picker">Labeled dataset <input type="file" id="dataset-file" accept=".csv,text/csv" /><span>UTF-8 CSV · url,label · up to ${DATASET_LIMITS.maxFileBytes / 1048576} MiB for browser validation</span></label>`;
}
export function bindFile() {
  const input = document.querySelector("#dataset-file");
  const selected = document.querySelector("#selected-file");
  if (input) input.onchange = () => datasetStore.select(input.files[0] || null);
  return datasetStore.subscribe((data) => {
    if (selected)
      selected.textContent = data.file
        ? `Selected: ${data.name} · ${formatBytes(data.size)}`
        : "No dataset selected. Select the file again after a refresh.";
  });
}
