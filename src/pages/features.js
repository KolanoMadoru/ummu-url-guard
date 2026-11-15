import { api } from "../utils/api.js";
import { heading, table, showError, busy } from "../utils/ui.js";
import { csv, download } from "../utils/storage.js";
export function render() {
  return `${heading("Feature Extraction", "Explore the same deterministic Python features used for training and inference.")}
    <section class="card"><form id="feature-form"><label for="feature-url">URL</label><div class="input-row"><input type="url" id="feature-url" placeholder="https://example.com/login" required maxlength="4096" /><button class="button" id="extract">Extract features</button></div></form><p id="feature-error" role="alert" class="error" hidden></p></section><div id="feature-result"></div>`;
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
        `<section class="card"><div class="section-heading"><h3>Schema: ${data.schema_version}</h3><button class="button secondary" id="export-features">Export features CSV</button></div>${table(
          [
            "Feature",
            "Value",
            "Type",
            "Definition",
            "Experiment RF importance",
          ],
          rows.map((r) => Object.values(r)),
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
