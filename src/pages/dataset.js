import { displayText, classLabel, errorText } from "../utils/i18n.js";
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
  return `${heading("Manajemen Dataset", "Validasi file CSV di browser tanpa mengunggah file besar ke Vercel.")}
    <section class="card"><h2>Unggah Dataset CSV</h2><p>Kolom: <code>url,label</code>. Label: <code>phishing = 1</code>, <code>benign = 0</code>. URL tidak pernah dibuka.</p>
      <div id="dataset-drop" class="dataset-drop" tabindex="0" aria-label="Letakkan file CSV di sini">${filePicker()}<p>Seret dan letakkan CSV di sini, atau gunakan pemilih file.</p></div>
      <p id="selected-file" class="hint"></p><div class="actions"><button id="analyze" class="button" disabled>Validasi Dataset</button><button id="dataset-cancel" class="button secondary" disabled>Batalkan Pemrosesan</button><button id="dataset-reset" class="button secondary">Atur Ulang Dataset</button></div>
      <p id="dataset-error" class="error" role="alert" hidden></p>
    </section>
    <section class="card" aria-label="Progres Pemrosesan"><div class="section-heading"><h3 id="dataset-status" role="status">Belum Ada File Terpilih</h3><span id="dataset-percent">0%</span></div><progress id="dataset-progress" value="0" max="100" aria-label="Progres validasi dataset"></progress><p id="dataset-progress-text" class="hint"></p></section>
    <div id="dataset-result"></div>
    <section class="card"><div class="actions"><button id="summary-download" class="button secondary" disabled>Unduh Ringkasan</button><button id="validation-download" class="button secondary" disabled>Ekspor Laporan Validasi</button><button id="python-verify" class="button secondary" disabled>Verifikasi Dataset Kecil dengan Python</button><a id="continue-training" class="button secondary" href="#training" aria-disabled="true">Lanjut ke Pelatihan Model</a></div><p id="dataset-eligibility" role="status"></p><p id="python-status" role="status" class="hint"></p></section>
    <div class="notice">Dataset besar divalidasi langsung di browser. Pelatihan daring mengikuti batas sumber daya backend. Validasi bukan pelatihan model. Hanya verifikasi Python atau pelatihan daring yang mengunggah file kecil (maksimal 2 MiB / 1.000 baris); file besar tetap di memori browser. Pilih ulang file setelah memuat ulang halaman.</div>`;
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
      error.textContent = "Pilih tepat satu file CSV.";
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
      ["Asal URL (disamarkan)", "Label", "Status Validasi"],
      summary.preview
        .slice(page * 10, page * 10 + 10)
        .map((r) => [displayText(r.url), classLabel(r.label), displayText(r.status)]),
    );
    document.querySelector("#preview-page").textContent =
      `Halaman ${page + 1} dari ${Math.max(1, Math.ceil(summary.preview.length / 10))} · ${summary.preview.length} data pertama dari ${summary.total_records.toLocaleString("id-ID")} data`;
    document.querySelector("#preview-prev").disabled = page === 0;
    document.querySelector("#preview-next").disabled =
      (page + 1) * 10 >= summary.preview.length;
  }
  const unsubscribe = datasetStore.subscribe((data) => {
    const running = ["Validating", "Processing"].includes(data.status);
    document.querySelector("#selected-file").textContent = data.file
      ? `File Terpilih: ${data.name} · ${formatBytes(data.size)}`
      : "Belum ada file terpilih. Pilih ulang file setelah memuat ulang halaman.";
    document.querySelector("#dataset-status").textContent = displayText(data.status);
    document.querySelector("#dataset-percent").textContent =
      `${data.progress.percent}%`;
    document.querySelector("#dataset-progress").value = data.progress.percent;
    document.querySelector("#dataset-progress-text").textContent =
      `${formatBytes(data.progress.bytes)} / ${formatBytes(data.size)} dibaca · ${data.progress.rows.toLocaleString("id-ID")} data diproses`;
    button.disabled =
      running ||
      !data.file ||
      data.size > DATASET_LIMITS.maxFileBytes ||
      !data.size ||
      !/\.csv$/iu.test(data.name);
    input.disabled = running;
    cancel.disabled = !running;
    error.hidden = !data.error;
    error.textContent = errorText(data.error);
    document.querySelector("#summary-download").disabled = !data.summary;
    document.querySelector("#validation-download").disabled = !data.summary;
    const eligibility = trainingEligibility(data);
    document.querySelector("#dataset-eligibility").textContent =
      data.status === "Validated"
        ? `Dataset Siap · ${data.summary.valid_records.toLocaleString("id-ID")} data valid. ${displayText(eligibility.reason)}`
        : "Validasi dataset terpilih sebelum melanjutkan.";
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
      ? "Validasi Python selesai. Ringkasannya disertakan dalam unduhan di bawah."
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
      output.innerHTML = `<section class="card"><h3>Ringkasan Validasi</h3><p>Sumber: browser · ${escape(displayText(s.validation_status))}. ${escape(displayText(s.counting))}</p>${table(
        ["Ukuran", "Nilai"],
        [
          ["Nama Dataset", s.dataset_name],
          ["Ukuran File", formatBytes(s.file_size)],
          ["Total Data", s.total_records],
          ["Data Valid", s.valid_records],
          ["Data Tidak Valid", s.invalid_records],
          ["URL Phishing", s.class_distribution.phishing],
          ["URL Aman (benign)", s.class_distribution.benign],
          ["URL Unik setelah Normalisasi", s.unique_records],
          ["Nilai Kosong (baris)", s.missing_values],
          ["URL Kosong", s.missing_urls],
          ["Label Kosong", s.missing_labels],
          ["URL Tidak Valid", s.invalid_urls],
          ["Label Tidak Valid", s.invalid_labels],
          ["Data Duplikat", s.duplicate_records],
          ["Label Bertentangan (URL)", s.conflicting_labels],
          ["Data dengan Label Bertentangan", s.conflicting_records],
          ["Baris CSV Tidak Sesuai Format", s.csv_error_records],
          ["Baris Kosong yang Diabaikan", s.blank_rows_ignored],
          ["SHA-256", s.dataset_hash],
        ],
      )}</section><div class="grid two">${plot("dataset-classes", "Distribusi Kelas Data Valid")}<section class="card"><h3>Masalah Validasi · 100 Pertama</h3>${table(
        ["Nomor Data CSV (judul kolom = 1)", "Masalah"],
        s.errors.map((e) => [e.row, displayText(e.message)]),
      )}${s.errors_truncated ? "<p>Masalah lainnya tidak ditampilkan karena batas laporan.</p>" : ""}</section></div>
      <section class="card"><h3>Pratinjau Dataset · 50 Data Pertama</h3><div id="preview-rows"></div><div class="actions"><button id="preview-prev" class="button secondary">Halaman Pratinjau Sebelumnya</button><span id="preview-page" class="hint"></span><button id="preview-next" class="button secondary">Halaman Pratinjau Selanjutnya</button></div></section>`;
      chart(
        "dataset-classes",
        "doughnut",
        ["Aman (benign)", "Phishing"],
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
      "Sedang mengirim file kecil terpilih ke Python untuk validasi independen…";
    try {
      const summary = await api("dataset/analyze", {
        file,
        signal: verification.signal,
      });
      datasetStore.setBackend(summary, file);
    } catch (e) {
      error.hidden = false;
      error.textContent = errorText(e);
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
