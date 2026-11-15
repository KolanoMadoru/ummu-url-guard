import { api } from "../utils/api.js";
import {
  heading,
  escape,
  percent,
  table,
  busy,
  showError,
} from "../utils/ui.js";
import { saveScan, getStorageWarning } from "../utils/storage.js";
export function render() {
  return `${heading("URL Scanner", "Inspect lexical indicators and safely resolve public HTTP metadata.")}
    <section class="card"><form id="scan-form"><label for="scan-url">URL to analyze</label><div class="input-row"><input type="url" id="scan-url" placeholder="https://example.com/login" maxlength="4096" required autocomplete="off" spellcheck="false" /><button class="button" id="scan-button"><i data-lucide="scan-line"></i> Scan URL</button><button class="button secondary" type="reset">Clear</button></div><p class="hint">HTTP / HTTPS only. No page body is downloaded. URLs are displayed as text, never opened.</p></form><p class="error" id="scan-error" role="alert" hidden></p><p id="scan-progress" role="status"></p></section>
    <div id="scan-result" aria-live="polite"></div><div class="notice">Machine learning prediction is an indicator, not a guarantee of website safety.</div>`;
}
export function mount() {
  const form = document.querySelector("#scan-form");
  const error = document.querySelector("#scan-error");
  const output = document.querySelector("#scan-result");
  const progress = document.querySelector("#scan-progress");
  form.addEventListener("reset", () => {
    output.innerHTML = "";
    error.hidden = true;
    progress.textContent = "";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    const button = document.querySelector("#scan-button");
    busy(button, true);
    progress.textContent =
      "Extracting features and checking public network metadata…";
    try {
      const result = await api("scan", {
        json: { url: form.querySelector("input").value },
      });
      const saved = saveScan(result);
      const online = result.online;
      output.innerHTML = `<section class="card result ${result.prediction || "unavailable"}"><div class="result-heading"><i data-lucide="shield"></i><div><span class="eyebrow">ANALYSIS RESULT</span><h2>${escape(result.prediction ? `Predicted ${result.prediction}` : "Prediction unavailable — model not trained")}</h2></div><span class="badge">${escape(online.status)}</span></div>
        ${table(
          ["Property", "Observed value"],
          [
            ["Original URL", result.url],
            ["Final URL", online.final_url || "Unavailable"],
            ["Model estimate for phishing", percent(result.probability)],
            [
              "Short URL provider",
              result.shortener_provider || "No known shortener",
            ],
            [
              "Typosquatting indicator",
              result.typosquatting.indicator
                ? "Present; may be a false positive"
                : "Not detected",
            ],
            ["Reference domain", result.typosquatting.reference],
            [
              "Registered domain similarity",
              percent(result.typosquatting.similarity),
            ],
            ["Character change", result.typosquatting.change],
            ["HTTP status", online.http_status ?? "Unavailable"],
            ["Redirect count", online.redirect_count],
            ["Online check reason", online.reason || "HEAD metadata received"],
            ["Timestamp", result.timestamp],
            ["Model version", result.model_version || "Not available"],
          ],
        )}
        <p class="hint">${escape(result.probability_label || result.reason || "")}</p>${!saved ? `<p class="error">${escape(getStorageWarning())}</p>` : '<p class="hint">Saved to this browser with path, query and fragment removed.</p>'}</section>
        <section class="card"><h3>Lexical evidence</h3><p class="hint">Computed from the original input. Network metadata is separate from model inputs. Keyword and similarity indicators alone do not determine the class.</p>${table(
          ["Feature", "Value", "Definition"],
          Object.entries(result.features).map(([key, value]) => [
            key,
            Number.isInteger(value) ? value : value.toFixed(4),
            result.definitions[key],
          ]),
        )}</section>
        <section class="card"><h3>Observed redirect chain</h3>${table(
          ["URL", "HEAD status"],
          (online.chain || []).map((h) => [h.url, h.status]),
        )}</section>`;
    } catch (e) {
      showError(error, e);
    } finally {
      busy(button, false);
      progress.textContent = "";
    }
  });
}
