import { heading, escape } from "../utils/ui.js";
import {
  history,
  deleteScan,
  clearHistory,
  csv,
  download,
} from "../utils/storage.js";
export function render() {
  return `${heading("Detection History", "Local to this browser. Paths, query parameters and fragments are never saved.")}
    <section class="card"><div class="history-tools"><label>Search origin<input id="history-search" type="search" placeholder="Search a domain…" /></label><label>Prediction<select id="history-filter"><option value="all">All results</option><option value="phishing">Phishing</option><option value="benign">Benign</option><option value="unavailable">Unavailable</option></select></label><button id="history-csv" class="button secondary">Export CSV</button><button id="history-json" class="button secondary">Export JSON</button><button id="history-clear" class="button danger">Clear all</button></div><div id="history-table"></div><p class="hint">Maximum 200 records. This data does not automatically sync across devices.</p><p id="history-message" role="status"></p></section>`;
}
export function mount() {
  const search = document.querySelector("#history-search");
  const filter = document.querySelector("#history-filter");
  function selected() {
    return history().filter(
      (r) =>
        r.url.toLowerCase().includes(search.value.toLowerCase()) &&
        (filter.value === "all" ||
          (r.prediction || "unavailable") === filter.value),
    );
  }
  function draw() {
    const rows = selected();
    document.querySelector("#history-table").innerHTML =
      `<div class="table-wrap"><table><thead><tr>${["URL origin", "Prediction", "Online", "Redirects", "Time", "Model version", "Action"].map((x) => `<th scope="col">${x}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr><td class="url-text">${escape(r.url)}</td><td><span class="badge ${escape(r.prediction || "unavailable")}">${escape(r.prediction || "Unavailable")}</span></td><td>${escape(r.online_status)}</td><td>${escape(r.redirects)}</td><td>${escape(new Date(r.timestamp).toLocaleString())}</td><td>${escape(r.model_version || "N/A")}</td><td><button class="text-button" data-delete="${escape(r.id)}">Delete</button></td></tr>`).join("") : '<tr><td colspan="7" class="empty">No matching scans.</td></tr>'}</tbody></table></div>`;
    document.querySelectorAll("[data-delete]").forEach(
      (button) =>
        (button.onclick = () => {
          deleteScan(button.dataset.delete);
          draw();
        }),
    );
  }
  search.oninput = draw;
  filter.onchange = draw;
  document.querySelector("#history-clear").onclick = () => {
    if (confirm("Delete all detection history from this browser?")) {
      clearHistory();
      draw();
    }
  };
  document.querySelector("#history-csv").onclick = () =>
    download("masked-history.csv", csv(selected()), "text/csv");
  document.querySelector("#history-json").onclick = () =>
    download("masked-history.json", selected());
  draw();
}
