import { automaticResearch } from "../utils/automatic-research.js";
import { DATASET_LIMITS } from "../utils/dataset-config.js";
import { classLabel, errorText } from "../utils/i18n.js";
import { download } from "../utils/storage.js";
import { escape, filePicker, heading, table } from "../utils/ui.js";
import {
  canUseResearchFile, formatResearchCount as count, mountResearchControls,
  renderResearchProgress, renderStageButtons, researchStages, selectResearchFile,
  selectedResearchFile,
} from "../components/automatic-research.js";
import { distribution, mountResearchImport, renderResearchImport, renderShortenerCoverage } from "../components/research-workspace.js";

export function render() {
  return `${heading("Manajemen Dataset", "Unggah satu CSV berlabel dan jalankan penelitian dari validasi hingga evaluasi.")}
    <section class="card" id="dataset-workflow">
      <h2>Dataset Penelitian</h2>
      <p>Gunakan kolom <code>url,label</code> dengan label <code>0</code> untuk benign dan <code>1</code> untuk phishing. Kolom tambahan diabaikan. Batas ${DATASET_LIMITS.maxFileBytes / 1048576} MiB dan 50.000 baris data.</p>
      <div id="dataset-drop" class="dataset-drop" aria-label="Letakkan file CSV di sini">
        ${filePicker()}<p>Seret satu CSV ke sini atau pilih file.</p>
      </div>
      <p id="selected-file" class="hint" data-research-selection></p>
      <p class="hint">Aplikasi mengirim URL dalam kelompok kecil ke API untuk ekstraksi fitur leksikal. Situs tujuan tidak dibuka. Browser menyimpan fitur dan hasil penelitian tanpa URL mentah.</p>
      <p class="error" id="dataset-selection-error" role="alert" hidden></p>
      <div class="actions">
        <button class="button" type="button" data-research-run="evaluate" data-research-automatic disabled>Jalankan Penelitian Otomatis</button>
        <button class="button secondary" type="button" data-research-cancel disabled>Batalkan Pemrosesan</button>
        <button id="dataset-reset" class="button secondary" type="button">Atur Ulang Dataset</button>
      </div>
      <details class="research-options">
        <summary>Jalankan per Tahap</summary>
        <div class="actions">${renderStageButtons(Object.keys(researchStages))}</div>
      </details>
      ${renderResearchProgress()}
    </section>
    <div id="dataset-result"></div>
    <section class="card" id="dataset-downloads" hidden>
      <h3>Unduhan Penelitian</h3>
      <div class="actions">
        <button class="button secondary" type="button" data-research-export="issues" disabled>Unduh Laporan Data yang Tidak Digunakan</button>
        <button class="button secondary" type="button" data-research-export="split" disabled>Unduh Pembagian Dataset</button>
        <button class="button secondary" type="button" data-research-export="shortener-coverage" hidden disabled>Unduh Cakupan URL Pendek</button>
        <button class="button secondary" type="button" data-research-export="basic" disabled>Unduh 7 Fitur Dasar</button>
        <button class="button secondary" type="button" data-research-export="extended" disabled>Unduh 19 Fitur Lengkap</button>
        <button class="button" type="button" data-research-export="results" disabled>Unduh Laporan Penelitian</button>
        <a class="button secondary" href="#evaluation" id="research-results-link" hidden>Lihat Evaluasi Penelitian</a>
      </div>
      <p id="research-download-error" class="error" role="alert" hidden></p>
    </section>
    ${renderResearchImport()}`;
}

const splitLabels = {
  train: ["Pelatihan", "Melatih model"],
  validation: ["Validasi", "Membandingkan konfigurasi"],
  test: ["Pengujian", "Mengukur performa akhir"],
};

function renderSummary(dataset) {
  const issues = dataset.issues?.slice(0, 20) ?? [];
  return `<section class="card">
    <h3>Ringkasan Dataset</h3>
    ${table(["Ukuran", "Nilai"], [
      ["Total Data Awal", count(dataset.source_rows)],
      ["Baris Kosong", count(dataset.blank_rows ?? dataset.blank_count)],
      ["Data Valid untuk Eksperimen", count(dataset.valid_rows)],
      ["Data Tidak Valid", count(dataset.invalid_rows)],
      ["Data Duplikat", count(dataset.duplicate_rows)],
      ["Baris dengan Konflik Label", count(dataset.conflicting_rows)],
      ["Benign", count(dataset.benign)],
      ["Phishing", count(dataset.phishing)],
      ["Tautan Pendek Teridentifikasi", count(Object.values(dataset.shorteners ?? {}).reduce((sum, n) => sum + n, 0))],
      ["Indikasi Kemiripan Merek", count(dataset.brand_matches)],
      ["SHA-256", dataset.hash],
    ])}
    ${distribution("Layanan Pemendek", dataset.shorteners)}
    ${issues.length ? `<h3>Data yang Tidak Digunakan</h3>${table(["Nomor Baris CSV", "Alasan"],
      issues.map((issue) => [issue.row, issue.message]))}<p class="hint">Laporan CSV mencantumkan semua baris yang tidak digunakan.</p>` : ""}
  </section>`;
}

function renderSplit(dataset) {
  const { split, audit, warnings } = dataset;
  if (!split) return "";
  const rows = Object.entries(splitLabels).flatMap(([key, [label, purpose]]) => {
    const part = split[key];
    return part ? [[label, purpose, count(part.rows), `${count(part.percent)}%`, count(part.groups),
      count(part.benign), count(part.phishing), count(part.shorteners)]] : [];
  });
  if (!rows.length) return "";
  const auditPassed = audit === true || audit?.passed === true;
  return `<section class="card">
    <h3>Audit dan Pembagian Dataset</h3>
    <p>${auditPassed ? "Tidak ditemukan kebocoran berdasarkan URL dan domain yang diperiksa." : "Pemeriksaan hubungan lintas split memerlukan perhatian."}</p>
    ${table(["Split", "Fungsi", "Data", "Rasio Aktual", "Kelompok", "Benign", "Phishing", "Tautan Pendek"], rows)}
    <p class="hint">Target 70% pelatihan, 15% validasi, dan 15% pengujian dengan seed 42. Kelompok terkait tetap utuh. Tujuan tautan pendek tidak diketahui dari CSV.</p>
    ${warnings?.length ? `<ul class="notice">${warnings.map((warning) => `<li>${escape(warning)}</li>`).join("")}</ul>` : ""}
    ${renderShortenerCoverage(dataset.shortenerCoverage)}
    </section>`;
}

const exportFiles = {
  issues: ["data-tidak-digunakan.csv", "text/csv", "prepare"],
  split: ["pembagian-dataset.csv", "text/csv", "split"],
  "shortener-coverage": ["cakupan-url-pendek.csv", "text/csv", "split"],
  basic: ["fitur-dasar.csv", "text/csv", "features"],
  extended: ["fitur-lengkap.csv", "text/csv", "features"],
  results: ["laporan-penelitian.json", "application/json", "evaluate"],
};

export function mount() {
  const workflow = document.querySelector("#dataset-workflow");
  const input = workflow.querySelector("#dataset-file");
  const drop = document.querySelector("#dataset-drop");
  const reset = document.querySelector("#dataset-reset");
  const selectionError = document.querySelector("#dataset-selection-error");
  const output = document.querySelector("#dataset-result");
  const downloads = document.querySelector("#dataset-downloads");
  const resultLink = document.querySelector("#research-results-link");
  const downloadError = document.querySelector("#research-download-error");
  const exportButtons = [...downloads.querySelectorAll("[data-research-export]")];
  const saved = mountResearchImport();
  let lastDataset;
  let renderedReport;
  let previewPage = 0;
  let selecting = false;
  let exporting = null;

  function showFileError(message) {
    selectionError.textContent = message;
    selectionError.hidden = !message;
  }

  function showPreview(dataset) {
    const preview = (dataset.preview ?? []).slice(0, 20);
    const rows = preview.slice(previewPage * 10, previewPage * 10 + 10)
      .map(({ row, url, label }) => [row, url, classLabel(label === 1 ? "phishing" : "benign")]);
    const target = document.querySelector("#preview-rows");
    if (!target) return;
    target.innerHTML = table(["Baris CSV", "Asal URL (Disamarkan)", "Label"], rows);
    document.querySelector("#preview-page").textContent =
      `Halaman ${previewPage + 1} dari ${Math.max(1, Math.ceil(preview.length / 10))}`;
    document.querySelector("#preview-prev").disabled = previewPage === 0;
    document.querySelector("#preview-next").disabled = (previewPage + 1) * 10 >= preview.length;
  }

  function renderDataset(dataset) {
    if (dataset === lastDataset) return;
    lastDataset = dataset;
    previewPage = 0;
    output.innerHTML = dataset ? `${renderSummary(dataset)}${renderSplit(dataset)}
      ${dataset.preview?.length ? `<section class="card"><h3>Pratinjau Dataset · Maksimal 20 Baris</h3><div id="preview-rows"></div>
        <div class="actions"><button id="preview-prev" class="button secondary" type="button">Halaman Sebelumnya</button>
        <span id="preview-page" class="hint"></span><button id="preview-next" class="button secondary" type="button">Halaman Selanjutnya</button></div></section>` : ""}` : "";
    if (!dataset?.preview?.length) return;
    document.querySelector("#preview-prev").onclick = () => {
      previewPage--;
      showPreview(dataset);
    };
    document.querySelector("#preview-next").onclick = () => {
      previewPage++;
      showPreview(dataset);
    };
    showPreview(dataset);
  }

  const controls = mountResearchControls(workflow, (snapshot) => {
    const busy = snapshot.phase === "running" || snapshot.phase === "loading";
    input.disabled = busy || selecting;
    reset.disabled = busy || selecting || (!selectedResearchFile() && !snapshot.dataset);
    if (selecting) for (const button of workflow.querySelectorAll("[data-research-run]")) button.disabled = true;
    downloads.hidden = !snapshot.dataset;
    resultLink.hidden = !snapshot.completed.includes("evaluate");
    for (const button of exportButtons) {
      const kind = button.dataset.researchExport;
      const stage = exportFiles[kind][2];
      if (kind === "shortener-coverage") button.hidden = !snapshot.dataset?.shortenerCoverage;
      button.disabled = button.hidden || busy || Boolean(exporting) ||
        !(snapshot.completed.includes(stage) || (kind === "issues" && snapshot.dataset));
    }
    if (renderedReport !== snapshot.report?.experiment_id) {
      renderedReport = snapshot.report?.experiment_id;
      saved.refresh();
    }
    renderDataset(snapshot.dataset);
  });

  async function select(candidate) {
    if (selecting || automaticResearch.get().phase === "running") return;
    if (candidate && !canUseResearchFile(candidate)) {
      showFileError("Pilih satu file CSV yang tidak kosong dengan ukuran dalam batas yang ditampilkan.");
      input.value = "";
      return;
    }
    selecting = true;
    showFileError("");
    downloadError.hidden = true;
    try {
      const pending = selectResearchFile(candidate);
      controls.refresh();
      await pending;
    } catch (error) {
      showFileError(errorText(error));
    } finally {
      selecting = false;
      controls.refresh();
    }
  }

  input.onchange = () => select(input.files[0] ?? null);
  reset.onclick = () => {
    input.value = "";
    return select(null);
  };
  for (const event of ["dragenter", "dragover"])
    drop.addEventListener(event, (action) => {
      action.preventDefault();
      if (!input.disabled) drop.classList.add("drag-active");
    });
  for (const event of ["dragleave", "drop"])
    drop.addEventListener(event, (action) => {
      action.preventDefault();
      drop.classList.remove("drag-active");
    });
  drop.addEventListener("drop", (event) => {
    if (input.disabled) return;
    if (event.dataTransfer.files.length !== 1) {
      showFileError("Pilih tepat satu file CSV.");
      return;
    }
    input.value = "";
    return select(event.dataTransfer.files[0]);
  });

  for (const button of exportButtons)
    button.onclick = async () => {
      const kind = button.dataset.researchExport;
      const [name, type] = exportFiles[kind];
      exporting = kind;
      downloadError.hidden = true;
      controls.refresh();
      try {
        download(name, await automaticResearch.export(kind), type);
      } catch (error) {
        downloadError.textContent = errorText(error);
        downloadError.hidden = false;
      } finally {
        exporting = null;
        controls.refresh();
      }
    };

  return () => {
    controls.dispose();
    saved.dispose();
  };
}
