import { displayText, featureLabel, featureDefinition } from "../utils/i18n.js";
import { api } from "../utils/api.js";
import { heading, table, showError, busy } from "../utils/ui.js";
import { csv, download } from "../utils/storage.js";
import { automaticResearch } from "../utils/automatic-research.js";
import { mountResearchControls, renderResearchStage } from "../components/automatic-research.js";
export function render() {
  return `${heading("Ekstraksi Fitur", "Periksa fitur Python deterministik yang juga digunakan untuk pelatihan dan inferensi.")}
    ${renderResearchStage("features", "Siapkan tabel fitur dataset dari partisi yang sudah diaudit.")}
    <div id="feature-dataset"></div>
    <section class="card"><form id="feature-form"><label for="feature-url">URL</label><div class="input-row"><input type="url" id="feature-url" placeholder="https://example.com/login" required maxlength="4096" /><button class="button" id="extract">Ekstraksi Fitur</button></div></form><p id="feature-error" role="alert" class="error" hidden></p></section><div id="feature-result"></div>`;
}
export function mount() {
  const datasetTarget = document.querySelector("#feature-dataset");
  let lastFeatures;
  const controls = mountResearchControls(document.querySelector("#research-stage-panel"), (snapshot) => {
    const features = snapshot.dataset?.features;
    if (lastFeatures === features) return;
    lastFeatures = features;
    datasetTarget.innerHTML = features ? `<section class="card"><h2>Pratinjau Fitur Dataset</h2>
      <div class="actions">
        <button class="button secondary" type="button" data-feature-export="basic">Unduh 7 Fitur</button>
        <button class="button secondary" type="button" data-feature-export="extended">Unduh 19 Fitur</button>
      </div><p id="feature-export-error" class="error" role="alert" hidden></p>
      ${table(["Record CSV", "Label", ...features.names.map(featureLabel)], features.preview.map((row) =>
        row.map((value) => Number.isInteger(value) ? value : value.toFixed(4))))}</section>` : "";
    for (const button of datasetTarget.querySelectorAll("[data-feature-export]")) {
      button.onclick = async () => {
        try {
          const kind = button.dataset.featureExport;
          download(`fitur-${kind}.csv`, await automaticResearch.export(kind), "text/csv");
        } catch (error) {
          const target = datasetTarget.querySelector("#feature-export-error");
          if (target) showError(target, error);
        }
      };
    }
  });
  document.querySelector("#feature-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = document.querySelector("#extract");
    const error = document.querySelector("#feature-error");
    error.hidden = true;
    busy(button, true);
    try {
      const data = await api("features", {
        json: { url: document.querySelector("#feature-url").value },
      });
      const rf = automaticResearch.get().report?.results.find(
        (r) => r.model_name === "Random Forest" && r.feature_set === "extended",
      );
      const rows = Object.entries(data.features).map(([key, value]) => ({
        feature: key,
        value,
        type: data.feature_types[key],
        description: data.definitions[key],
        importance: rf?.feature_importance?.[key] ?? "N/A",
      }));
      document.querySelector("#feature-result").innerHTML =
        `<section class="card"><div class="section-heading"><h3>Skema: ${data.schema_version}</h3><button class="button secondary" id="export-features">Ekspor Fitur CSV</button></div>${table(
          [
            "Nama Fitur",
            "Nilai",
            "Tipe",
            "Keterangan",
            "Tingkat kepentingan pada eksperimen RF",
          ],
          rows.map((r) => [featureLabel(r.feature), r.value, displayText(r.type), featureDefinition(r.feature, r.description), displayText(r.importance)]),
        )}</section>`;
      document.querySelector("#export-features").onclick = () =>
        download("features.csv", csv(rows), "text/csv");
    } catch (e) {
      showError(error, e);
    } finally {
      busy(button, false);
    }
  };
  return controls.dispose;
}
