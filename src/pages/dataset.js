import { api } from "../utils/api.js";
import { heading, filePicker, table, escape } from "../utils/ui.js";
import { download, csv } from "../utils/storage.js";
import { datasetStore, trainingEligibility } from "../utils/dataset-state.js";
import {
  DATASET_LIMITS,
  ONLINE_LIMITS,
  formatBytes,
} from "../utils/dataset-config.js";
import { chart, clearCharts, plot } from "../utils/charts.js";

export function render() {
  return `${heading("Dataset Management", "Validate CSV files in your browser without uploading large payloads to Vercel.")}
    <section class="card"><h2>Upload a CSV dataset</h2><p>Columns: <code>url,label</code>. Labels: <code>phishing = 1</code>, <code>benign = 0</code>. No URLs are opened.</p>
      <div id="dataset-drop" class="dataset-drop" tabindex="0" aria-label="Drop a CSV file here">${filePicker()}<p>Drag and drop a CSV here, or use the file selector.</p></div>
      <p id="selected-file" class="hint"></p><div class="actions"><button id="analyze" class="button" disabled>Validate dataset</button><button id="dataset-cancel" class="button secondary" disabled>Cancel Processing</button><button id="dataset-reset" class="button secondary">Reset Dataset</button></div>
      <p id="dataset-error" class="error" role="alert" hidden></p>
    </section>
    <section class="card" aria-label="Processing progress"><div class="section-heading"><h3 id="dataset-status" role="status">No File Selected</h3><span id="dataset-percent">0%</span></div><progress id="dataset-progress" value="0" max="100" aria-label="Dataset validation progress"></progress><p id="dataset-progress-text" class="hint"></p></section>
    <div id="dataset-result"></div>
    <section class="card"><div class="actions"><button id="summary-download" class="button secondary" disabled>Download Summary</button><button id="validation-download" class="button secondary" disabled>Export Validation Report</button><button id="python-verify" class="button secondary" disabled>Verify small dataset with Python</button><a id="continue-training" class="button secondary" href="#training" aria-disabled="true">Continue to Model Training</a></div><p id="dataset-eligibility" role="status"></p><p id="python-status" role="status" class="hint"></p></section>
    <div class="notice">Dataset besar divalidasi langsung di browser. Kemampuan training online mengikuti batas resource backend. Validation is not model training. Only “Verify with Python” or online training uploads a small file (at most 2 MiB / 1,000 rows); large files stay in browser memory. Reselect the file after a browser refresh.</div>`;
}
export function mount() {
  const input = document.querySelector("#dataset-file");
  const drop = document.querySelector("#dataset-drop");
  const output = document.querySelector("#dataset-result");
  const error = document.querySelector("#dataset-error");
  const button = document.querySelector("#analyze");
  const cancel = document.querySelector("#dataset-cancel");
  const verify = document.querySelector("#python-verify");
  const continueLink = document.querySelector("#continue-training");
  let lastSummary,
    page = 0,
    verification = null;
  input.onchange = () => {
    verification?.abort();
    datasetStore.select(input.files[0] || null);
  };
  for (const event of ["dragenter", "dragover"])
    drop.addEventListener(event, (e) => {
      e.preventDefault();
      drop.classList.add("drag-active");
    });
  for (const event of ["dragleave", "drop"])
    drop.addEventListener(event, (e) => {
      e.preventDefault();
      drop.classList.remove("drag-active");
    });
  drop.addEventListener("drop", (e) => {
    verification?.abort();
    if (e.dataTransfer.files.length !== 1) {
      error.textContent = "Select exactly one CSV file.";
      error.hidden = false;
      return;
    }
    input.value = "";
    datasetStore.select(e.dataTransfer.files[0]);
  });
  button.onclick = () => datasetStore.start();
  cancel.onclick = () => datasetStore.cancel();
  document.querySelector("#dataset-reset").onclick = () => {
    verification?.abort();
    input.value = "";
    datasetStore.reset();
  };
  continueLink.onclick = (e) => {
    if (continueLink.getAttribute("aria-disabled") === "true")
      e.preventDefault();
  };
  document.querySelector("#summary-download").onclick = () =>
    download("dataset-summary.json", datasetStore.get().summary);
  document.querySelector("#validation-download").onclick = () => {
    const summary = datasetStore.get().summary;
    download(
      "validation-report.csv",
      csv([
        {
          dataset_name: summary.dataset_name,
          dataset_hash: summary.dataset_hash,
          total_records: summary.total_records,
          valid_records: summary.valid_records,
          invalid_records: summary.invalid_records,
          duplicate_records: summary.duplicate_records,
          conflicting_labels: summary.conflicting_labels,
          validation_status: summary.validation_status,
          source: "browser",
        },
        ...summary.errors.map((e) => ({
          dataset_name: summary.dataset_name,
          dataset_hash: summary.dataset_hash,
          validation_status: `Logical record ${e.row}: ${e.message}`,
        })),
      ]),
      "text/csv",
    );
  };
  function preview(summary) {
    const target = document.querySelector("#preview-rows");
    target.innerHTML = table(
      ["URL origin (masked)", "Label", "Validation status"],
      summary.preview
        .slice(page * 10, page * 10 + 10)
        .map((r) => [r.url, r.label, r.status]),
    );
    document.querySelector("#preview-page").textContent =
      `Page ${page + 1} of ${Math.max(1, Math.ceil(summary.preview.length / 10))} · first ${summary.preview.length} of ${summary.total_records.toLocaleString()} records`;
    document.querySelector("#preview-prev").disabled = page === 0;
    document.querySelector("#preview-next").disabled =
      (page + 1) * 10 >= summary.preview.length;
  }
  const unsubscribe = datasetStore.subscribe((data) => {
    const running = ["Validating", "Processing"].includes(data.status);
    document.querySelector("#selected-file").textContent = data.file
      ? `Selected: ${data.name} · ${formatBytes(data.size)}`
      : "No file selected. Select the file again after a refresh.";
    document.querySelector("#dataset-status").textContent = data.status;
    document.querySelector("#dataset-percent").textContent =
      `${data.progress.percent}%`;
    document.querySelector("#dataset-progress").value = data.progress.percent;
    document.querySelector("#dataset-progress-text").textContent =
      `${formatBytes(data.progress.bytes)} / ${formatBytes(data.size)} read · ${data.progress.rows.toLocaleString()} records processed`;
    button.disabled =
      running ||
      !data.file ||
      data.size > DATASET_LIMITS.maxFileBytes ||
      !data.size ||
      !/\.csv$/iu.test(data.name);
    input.disabled = running;
    cancel.disabled = !running;
    error.hidden = !data.error;
    error.textContent = data.error;
    document.querySelector("#summary-download").disabled = !data.summary;
    document.querySelector("#validation-download").disabled = !data.summary;
    const eligibility = trainingEligibility(data);
    document.querySelector("#dataset-eligibility").textContent =
      data.status === "Validated"
        ? `Dataset Ready · ${data.summary.valid_records.toLocaleString()} valid records. ${eligibility.reason}`
        : "Validate the selected dataset before continuing.";
    continueLink.setAttribute(
      "aria-disabled",
      String(data.status !== "Validated"),
    );
    verify.disabled =
      running ||
      Boolean(verification) ||
      !data.summary?.valid ||
      data.size > ONLINE_LIMITS.maxFileBytes ||
      data.summary.total_records > ONLINE_LIMITS.maxRows;
    document.querySelector("#python-status").textContent = data.backend
      ? "Python validation completed. Its summary is included in the download below."
      : "";
    if (data.summary !== lastSummary) {
      lastSummary = data.summary;
      page = 0;
      clearCharts();
      if (!data.summary) {
        output.innerHTML = "";
        return;
      }
      const s = data.summary;
      output.innerHTML = `<section class="card"><h3>Validation summary</h3><p>Source: browser · ${escape(s.validation_status)}. ${escape(s.counting)}</p>${table(
        ["Measure", "Value"],
        [
          ["Dataset name", s.dataset_name],
          ["File size", formatBytes(s.file_size)],
          ["Total Records", s.total_records],
          ["Valid Records", s.valid_records],
          ["Invalid Records", s.invalid_records],
          ["Phishing URLs", s.class_distribution.phishing],
          ["Benign URLs", s.class_distribution.benign],
          ["Unique normalized URLs", s.unique_records],
          ["Missing values (rows)", s.missing_values],
          ["Missing URLs", s.missing_urls],
          ["Missing labels", s.missing_labels],
          ["Invalid URLs", s.invalid_urls],
          ["Invalid labels", s.invalid_labels],
          ["Duplicate Records", s.duplicate_records],
          ["Conflicting Labels (URLs)", s.conflicting_labels],
          ["Conflicting records", s.conflicting_records],
          ["Malformed CSV rows", s.csv_error_records],
          ["Blank rows ignored", s.blank_rows_ignored],
          ["SHA-256", s.dataset_hash],
        ],
      )}</section><div class="grid two">${plot("dataset-classes", "Valid record class distribution")}<section class="card"><h3>Validation issues · first 100</h3>${table(
        ["Logical CSV record (header = 1)", "Issue"],
        s.errors.map((e) => [e.row, e.message]),
      )}${s.errors_truncated ? "<p>Additional issues omitted from this bounded report.</p>" : ""}</section></div>
      <section class="card"><h3>Dataset preview · first 50 records only</h3><div id="preview-rows"></div><div class="actions"><button id="preview-prev" class="button secondary">Previous preview page</button><span id="preview-page" class="hint"></span><button id="preview-next" class="button secondary">Next preview page</button></div></section>`;
      chart(
        "dataset-classes",
        "doughnut",
        ["Benign", "Phishing"],
        [s.class_distribution.benign, s.class_distribution.phishing],
      );
      document.querySelector("#preview-prev").onclick = () => {
        page--;
        preview(s);
      };
      document.querySelector("#preview-next").onclick = () => {
        page++;
        preview(s);
      };
      preview(s);
    }
  });
  verify.onclick = async () => {
    const { file } = datasetStore.get();
    datasetStore.setBackend(null, file);
    verification = new AbortController();
    verify.disabled = true;
    const status = document.querySelector("#python-status");
    status.textContent =
      "Sending the selected small file to Python for independent validation…";
    try {
      const summary = await api("dataset/analyze", {
        file,
        signal: verification.signal,
      });
      datasetStore.setBackend(summary, file);
    } catch (e) {
      error.hidden = false;
      error.textContent = e.message;
    } finally {
      verification = null;
      const current = datasetStore.get();
      verify.disabled =
        !current.summary?.valid ||
        current.size > ONLINE_LIMITS.maxFileBytes ||
        current.summary.total_records > ONLINE_LIMITS.maxRows;
    }
  };
  document.querySelector("#summary-download").onclick = () =>
    download("dataset-summary.json", {
      ...datasetStore.get().summary,
      backend_validation: datasetStore.get().backend,
    });
  return () => {
    unsubscribe();
    verification?.abort();
  };
}
