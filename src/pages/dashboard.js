import { heading, percent, escape } from "../utils/ui.js";
import { history, summaries } from "../utils/storage.js";
import { chart, plot } from "../utils/charts.js";
export function render(state) {
  const records = history();
  const count = (predicate) => records.filter(predicate).length;
  const cards = [
    ["Total URL Scanned", records.length, "scan-line"],
    [
      "Predicted Phishing",
      count((x) => x.prediction === "phishing"),
      "shield-alert",
    ],
    [
      "Predicted Benign",
      count((x) => x.prediction === "benign"),
      "shield-check",
    ],
    ["Suspicious Short URLs", count((x) => x.shortener), "link"],
    [
      "Typosquatting Indicators",
      count((x) => x.typosquatting),
      "text-cursor-input",
    ],
    [
      "Production Model Accuracy",
      state.health?.model_available
        ? percent(state.health.model_metrics?.accuracy)
        : "Model not available",
      "chart-no-axes-combined",
    ],
  ];
  return `${heading("Research dashboard", "A clear view of your URL checks and model research.", '<a class="button" href="#scanner"><i data-lucide="scan-line"></i> Scan a URL</a>')}
    <div class="notice"><i data-lucide="info"></i><div>Evidence first. Predictions are model estimates, never a guarantee of website safety. Short URLs and similar domains are indicators, not phishing labels.</div></div>
    <div class="stats">${cards.map(([label, value, icon]) => `<section class="stat"><div class="stat-label">${label}<i data-lucide="${icon}"></i></div><strong>${value}</strong><span>From actual local activity or deployed model</span></section>`).join("")}</div>
    ${records.length ? `<div class="grid two">${plot("prediction-chart", "Prediction distribution")}${plot("time-chart", "Checks over time")}${plot("short-chart", "Short URL proportion")}${plot("typo-chart", "Typosquatting indicators")}</div>` : '<section class="card welcome"><i data-lucide="shield-check"></i><h2>Your research starts here</h2><p>No URLs have been scanned in this browser. Check a URL for real lexical features and network metadata, or upload a labeled dataset to train models.</p><div class="actions"><a class="button" href="#scanner">Open URL Scanner</a><a class="button secondary" href="#dataset">Upload a dataset</a></div></section>'}
    <section class="card"><h3>Workspace status</h3><div class="status-list"><span>Python API</span><b>${state.health ? "Connected" : "Unavailable — start the backend"}</b><span>Production model</span><b>${escape(state.health?.model_reason || state.health?.model_version || "Unavailable")}</b><span>Saved experiment summaries</span><b>${summaries().length}</b><span>History storage</span><b>This browser only · maximum 200 records · origin masked</b></div></section>`;
}
export function mount() {
  const records = history();
  if (!records.length) return;
  chart(
    "prediction-chart",
    "doughnut",
    ["Unavailable", "Phishing", "Benign"],
    [
      records.filter((x) => !x.prediction).length,
      records.filter((x) => x.prediction === "phishing").length,
      records.filter((x) => x.prediction === "benign").length,
    ],
  );
  const days = {};
  records.forEach((r) => {
    const day = r.timestamp.slice(0, 10);
    days[day] = (days[day] || 0) + 1;
  });
  const sorted = Object.keys(days).sort();
  chart(
    "time-chart",
    "line",
    sorted,
    sorted.map((x) => days[x]),
    "URL checks",
  );
  chart(
    "short-chart",
    "doughnut",
    ["Known shortener", "Other URL"],
    [
      records.filter((x) => x.shortener).length,
      records.filter((x) => !x.shortener).length,
    ],
  );
  chart(
    "typo-chart",
    "doughnut",
    ["Indicator present", "No indicator"],
    [
      records.filter((x) => x.typosquatting).length,
      records.filter((x) => !x.typosquatting).length,
    ],
  );
}
