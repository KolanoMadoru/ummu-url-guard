import { errorText } from "./i18n.js";
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
  return `<div class="table-wrap"><table><thead><tr>${headers.map((x) => `<th scope="col">${escape(x)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((x) => `<td>${escape(x === "N/A" ? "Tidak Tersedia" : x)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="empty">Belum Ada Data.</td></tr>`}</tbody></table></div>`;
}
export function empty(
  message = "Belum ada eksperimen. Unggah CSV berlabel dan jalankan pelatihan model untuk melihat hasilnya.",
) {
  return `<div class="empty-state"><i data-lucide="flask-conical"></i><h3>Belum Ada Hasil</h3><p>${escape(message)}</p><a class="button" href="#dataset">Buka Manajemen Dataset</a></div>`;
}
export function heading(title, description, extra = "") {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${extra}</div>`;
}
export function showError(target, error) {
  target.textContent = errorText(error);
  target.hidden = false;
}
export function busy(button, status) {
  button.disabled = status;
  button.classList.toggle("loading", status);
}
export function filePicker() {
  return `<label class="file-picker" for="dataset-file">Pilih Dataset Berlabel <input class="visually-hidden" type="file" id="dataset-file" accept=".csv,text/csv" /><span class="file-select" aria-hidden="true">Pilih File</span><span>CSV UTF-8 · url,label · maksimal ${DATASET_LIMITS.maxFileBytes / 1048576} MiB untuk validasi di browser</span></label>`;
}
export function bindFile() {
  const input = document.querySelector("#dataset-file");
  const selected = document.querySelector("#selected-file");
  if (input) input.onchange = () => datasetStore.select(input.files[0] || null);
  return datasetStore.subscribe((data) => {
    if (selected)
      selected.textContent = data.file
        ? `File Terpilih: ${data.name} · ${formatBytes(data.size)}`
        : "Belum ada dataset terpilih. Pilih ulang file setelah memuat ulang halaman.";
  });
}
