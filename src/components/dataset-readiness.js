import { displayText } from "../utils/i18n.js";
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
    target.innerHTML = `<strong>${escape(displayText(data.status === "Validated" ? "Dataset Ready" : data.status))}</strong><p>${escape(displayText(eligibility.reason))}</p>
      ${
        data.file
          ? table(
              ["Dataset", "Nilai"],
              [
                ["Nama", data.name],
                ["Ukuran", formatBytes(data.size)],
                ["Sumber Validasi", displayText(data.summary?.source || "Not validated")],
                ["Data Valid", data.summary?.valid_records ?? "Tidak Tersedia"],
                ["Aman (benign)", data.summary?.class_distribution.benign ?? "Tidak Tersedia"],
                [
                  "Phishing",
                  data.summary?.class_distribution.phishing ?? "Tidak Tersedia",
                ],
              ],
            )
          : ""
      }
      <div class="actions"><a class="button secondary" href="#dataset">Buka Manajemen Dataset</a>${data.summary ? '<button id="dataset-config-export" class="button secondary">Ekspor Konfigurasi Pelatihan Lokal</button>' : ""}</div>
      <p>Pelatihan daring menggunakan file asli lengkap: maksimal 2 MiB / 1.000 baris sumber, disertai pemeriksaan pembagian domain. Tidak ada bagian data yang dipilih otomatis. Untuk file lebih besar:</p><code>python -m ml.train_local /path/to/dataset.csv</code><p>Jalankan perintah ini secara lokal menggunakan CSV asli. Browser tidak melatih dataset besar atau menggabungkan metrik per potongan.</p>`;
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
