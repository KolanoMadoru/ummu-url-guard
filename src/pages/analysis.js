import { displayText, featureLabel, classLabel } from "../utils/i18n.js";
import { heading, empty, table, escape, percent } from "../utils/ui.js";
import { comparison } from "./evaluation.js";
import { download, csv } from "../utils/storage.js";
import { chart, plot } from "../utils/charts.js";
import { currentResearchReport } from "../utils/research-reports.js";
import { mountResearchAnalysis, renderResearchAnalysis } from "../components/research-workspace.js";
export function render(state) {
  const r = state.report;
  const research = currentResearchReport();
  if (!r)
    return (
      heading(
        "Analisis Hasil",
        "Tafsirkan bukti, pola kesalahan, dan metadata untuk reproduksi hasil.",
      ) + (research ? renderResearchAnalysis(research) : empty())
    );
  const rf = r.results.find(
    (x) => x.model_name === "Random Forest" && x.feature_set === "extended",
  );
  const sorted = Object.entries(rf.feature_importance).sort(
    (a, b) => b[1] - a[1],
  );
  return `${heading("Analisis Hasil", "Periksa kesalahan model dan ekspor catatan penelitian yang dapat direproduksi.")}
    <section class="card"><div class="actions"><button class="button" id="export-json">Ekspor JSON</button><button class="button secondary" id="export-csv">Ekspor Metrik CSV</button><button class="button secondary" id="export-research">Ekspor Ringkasan Penelitian</button></div></section>
    <div class="grid two">${plot("importance", "Random Forest dengan Fitur Tambahan · Tingkat Kepentingan Fitur")}<section class="card"><h3>Peringkat Fitur</h3><p class="hint">Kepentingan berbasis impuritas bersifat asosiatif, dapat mengunggulkan fitur dengan banyak nilai unik, dan bukan bukti sebab-akibat.</p>${table(
      ["Peringkat", "Nama Fitur", "Tingkat Kepentingan"],
      sorted.map(([key, value], i) => [i + 1, featureLabel(key), percent(value)]),
    )}</section></div>
    <section class="card"><h3>Positif Palsu dan Negatif Palsu</h3><p class="hint">Hanya kesalahan pada data uji terpisah. URL disamarkan hingga menyisakan asalnya.</p>${table(
      ["Model", "Fitur", "Asal URL", "Aktual", "Prediksi", "Kesalahan"],
      r.results.flatMap((model) =>
        model.errors.map((error) => [
          model.model_name,
          displayText(model.feature_set),
          error.url,
          classLabel(error.actual),
          classLabel(error.predicted),
          displayText(error.type),
        ]),
      ),
    )}</section>
    <section class="card"><h3>Perbandingan Model</h3>${comparison(r)}</section><section class="card"><h3>Catatan Reproduksi Hasil</h3>${table(
      ["Kolom", "Nilai"],
      [
        ["ID Eksperimen", r.experiment_id],
        ["Nama Dataset", r.dataset_name],
        ["Dataset SHA-256", r.dataset_hash],
        ["Versi Model", r.model_version],
        ["Kelompok Fitur", r.feature_sets.map(displayText).join(", ")],
        ["Skema", r.schema_version],
        ["Nilai Awal Acak", r.random_seed],
        ["Nilai Awal Pembagian Efektif", r.split_seed],
        ["Waktu Evaluasi", r.evaluation_timestamp],
        ["Metode Pembagian", displayText(r.split_method)],
      ],
    )}<ul>${r.notes.map((note) => `<li>${escape(displayText(note))}</li>`).join("")}</ul></section>
    ${renderResearchAnalysis(research)}`;
}
export function mount(state) {
  mountResearchAnalysis(currentResearchReport());
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
    entries.map((x) => featureLabel(x[0])),
    entries.map((x) => x[1]),
    "Tingkat Kepentingan",
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
        "UMMU URL GUARD — Ringkasan Penelitian",
        `Eksperimen: ${r.experiment_id}`,
        `Dataset SHA-256: ${r.dataset_hash}`,
        `Dievaluasi: ${r.evaluation_timestamp}`,
        `Nilai awal acak: ${r.random_seed}; nilai awal pembagian: ${r.split_seed}`,
        displayText(r.split_method),
        ...r.results.map(
          (x) =>
            `${x.model_name} (${displayText(x.feature_set)}): akurasi ${percent(x.metrics.accuracy)}, presisi ${percent(x.metrics.precision)}, recall ${percent(x.metrics.recall)}, F1 ${percent(x.metrics.f1)}, ROC-AUC ${percent(x.metrics.roc_auc)}, PR-AUC (AP) ${percent(x.metrics.pr_auc)}. Kesalahan: ${x.errors.length}.`,
        ),
        ...r.notes.map(displayText),
        "Hasil prediksi machine learning merupakan indikator dan bukan jaminan keamanan suatu website.",
      ].join("\n"),
      "text/plain",
    );
}
