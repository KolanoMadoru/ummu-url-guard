import { displayText, featureLabel, featureDefinition } from "../utils/i18n.js";
import { api } from "../utils/api.js";
import { heading, table, showError, busy } from "../utils/ui.js";
import { csv, download } from "../utils/storage.js";
export function render() {
  return `${heading("Ekstraksi Fitur", "Periksa fitur Python deterministik yang juga digunakan untuk pelatihan dan inferensi.")}
    <section class="card"><form id="feature-form"><label for="feature-url">URL</label><div class="input-row"><input type="url" id="feature-url" placeholder="https://example.com/login" required maxlength="4096" /><button class="button" id="extract">Ekstraksi Fitur</button></div></form><p id="feature-error" role="alert" class="error" hidden></p></section><div id="feature-result"></div>`;
}
export function mount(state) {
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
      const rf = state.report?.results.find(
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
}
