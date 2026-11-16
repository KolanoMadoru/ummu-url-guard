import { datasetStore, trainingEligibility } from "../utils/dataset-state.js";
import { bindDatasetReadiness } from "../components/dataset-readiness.js";
import { api } from "../utils/api.js";
import {
  heading,
  table,
  filePicker,
  bindFile,
  showError,
  busy,
} from "../utils/ui.js";
import { saveSummary, download } from "../utils/storage.js";
export function render(state) {
  return `${heading("Pelatihan Model", "Latih model menggunakan kelompok domain terdaftar yang independen.")}
    <div class="grid two"><section class="card"><h2>Jalankan Eksperimen Daring</h2><p>Random Forest, Logistic Regression, dan Decision Tree menggunakan satu set data uji terpisah. Pemilihan model menggunakan skor F1 validasi.</p>${filePicker()}<p id="selected-file" class="hint"></p><div id="dataset-readiness" class="dataset-readiness"></div><button id="train" class="button">Mulai Pelatihan & Bandingkan Model</button><p id="training-progress" role="status"></p><p id="training-error" class="error" role="alert" hidden></p></section>
    <section class="card"><h3>Konfigurasi yang Dapat Direproduksi</h3>${table(
      ["Parameter", "Nilai"],
      [
        ["n_estimators", 80],
        ["max_depth", 16],
        ["min_samples_split", 4],
        ["min_samples_leaf", 2],
        ["class_weight", "balanced"],
        ["random_state", 42],
        ["n_jobs", 1],
        ["Target pembagian kelompok", "70% pelatihan / 15% validasi / 15% pengujian"],
      ],
    )}</section></div>
    <div class="notice">Minimal 30 URL unik, 10 kelompok domain terdaftar, dan 6 data per kelas. Kedua label harus ada di setiap partisi. Eksperimen daring tidak menggantikan model yang diterapkan. Sisihkan data uji eksternal untuk klaim penelitian akhir.</div>
    <section class="card" id="training-result">${state.report ? '<h3>Eksperimen Tersedia dalam Sesi Ini</h3><p>Buka evaluasi untuk memeriksa hasil pengujian pada data terpisah.</p><div class="actions"><a class="button" href="#evaluation">Evaluasi Model</a><button class="button secondary" id="export-report">Ekspor Hasil</button></div>' : "<h3>Inferensi Model Produksi</h3><p>Model produksi belum disertakan. Latih model secara lokal dengan dataset yang asal-usulnya telah diverifikasi, periksa hasilnya, lalu terapkan ulang artefaknya.</p><code>python -m ml.train_local /path/to/dataset.csv</code>"}</section>`;
}
export function mount(state, navigate) {
  const unbindFile = bindFile();
  const readiness = bindDatasetReadiness(document.querySelector("#train"));
  document
    .querySelector("#export-report")
    ?.addEventListener("click", () =>
      download("experiment.json", state.report),
    );
  const button = document.querySelector("#train");
  const error = document.querySelector("#training-error");
  button.onclick = async () => {
    readiness.setBusy(true);
    busy(button, true);
    error.hidden = true;
    const status = document.querySelector("#training-progress");
    status.textContent =
      "Sedang melatih tiga model dan mengevaluasi data uji terpisah. Proses dapat berlangsung hingga 35 detik…";
    try {
      const dataset = datasetStore.get();
      const eligibility = trainingEligibility(dataset);
      if (!eligibility.eligible) throw new Error(eligibility.reason);
      state.report = await api("train", { file: dataset.file });
      saveSummary(state.report);
      navigate("evaluation");
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
