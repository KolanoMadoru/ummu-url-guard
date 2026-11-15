import "./style.css";
import {
  createIcons,
  LayoutDashboard,
  ScanLine,
  Database,
  ListFilter,
  BrainCircuit,
  ChartNoAxesCombined,
  FlaskConical,
  FileChartColumn,
  History,
  ShieldCheck,
  ShieldAlert,
  Link,
  TextCursorInput,
  Info,
  Shield,
  GraduationCap,
  Menu,
} from "lucide";
const icons = {
  LayoutDashboard,
  ScanLine,
  Database,
  ListFilter,
  BrainCircuit,
  ChartNoAxesCombined,
  FlaskConical,
  FileChartColumn,
  History,
  ShieldCheck,
  ShieldAlert,
  Link,
  TextCursorInput,
  Info,
  Shield,
  GraduationCap,
  Menu,
};
import { api } from "./utils/api.js";
import { clearCharts } from "./utils/charts.js";
import { getStorageWarning } from "./utils/storage.js";
import * as dashboard from "./pages/dashboard.js";
import * as scanner from "./pages/scanner.js";
import * as dataset from "./pages/dataset.js";
import * as features from "./pages/features.js";
import * as training from "./pages/training.js";
import * as evaluation from "./pages/evaluation.js";
import * as experiments from "./pages/experiments.js";
import * as analysis from "./pages/analysis.js";
import * as history from "./pages/history.js";

const pages = {
  dashboard,
  scanner,
  dataset,
  features,
  training,
  evaluation,
  experiments,
  analysis,
  history,
};
const navigation = [
  ["dashboard", "Dashboard", "layout-dashboard"],
  ["scanner", "URL Scanner", "scan-line"],
  ["dataset", "Dataset Management", "database"],
  ["features", "Feature Extraction", "list-filter"],
  ["training", "Model Training", "brain-circuit"],
  ["evaluation", "Model Evaluation", "chart-no-axes-combined"],
  ["experiments", "Feature Experiment", "flask-conical"],
  ["analysis", "Result Analysis", "file-chart-column"],
  ["history", "Detection History", "history"],
];
const state = { health: null, report: null };
let cleanupPage;

document.querySelector("#app").innerHTML =
  `<aside id="sidebar"><a class="brand" href="#dashboard"><span class="brand-mark"><i data-lucide="shield-check"></i></span><span>UMMU <b>URL GUARD</b><small>RESEARCH WORKSPACE</small></span></a><p class="nav-label">WORKSPACE</p><nav aria-label="Main navigation">${navigation.map(([key, label, icon]) => `<a href="#${key}" data-page="${key}"><i data-lucide="${icon}"></i>${label}</a>`).join("")}</nav><div class="sidebar-note"><i data-lucide="graduation-cap"></i><strong>Built for research</strong><p>Real features. Reproducible experiments. Evidence you can inspect.</p></div><div class="sidebar-footer">UMMU URL GUARD <span>v0.1.0</span></div></aside>
  <div class="workspace"><header><div class="header-left"><button id="menu-toggle" class="icon-button" aria-label="Toggle navigation" aria-expanded="false" aria-controls="sidebar"><i data-lucide="menu"></i></button><span>Phishing URL Detection & Typosquatting Analysis</span></div><span id="api-status" class="connection"><span class="status-dot"></span>Connecting API</span></header><main id="content" tabindex="-1"></main><footer>UMMU URL GUARD · Research indicators, never a guarantee of website safety.<span>History stays in your browser</span></footer><p id="storage-warning" class="error" role="status"></p></div>`;
const menu = document.querySelector("#menu-toggle");
menu.onclick = () => {
  const opened = document.body.classList.toggle("nav-open");
  menu.setAttribute("aria-expanded", String(opened));
};
function navigate(name) {
  if (location.hash.slice(1) === name) route();
  else location.hash = name;
}
function route() {
  cleanupPage?.();
  const key = Object.hasOwn(pages, location.hash.slice(1))
    ? location.hash.slice(1)
    : "dashboard";
  clearCharts();
  document.querySelectorAll("[data-page]").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === key);
    if (a.dataset.page === key) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.querySelector("#content").innerHTML = pages[key].render(state);
  cleanupPage = pages[key].mount?.(state, navigate);
  document.body.classList.remove("nav-open");
  menu.setAttribute("aria-expanded", "false");
  createIcons({ icons });
  document.querySelector("#storage-warning").textContent = getStorageWarning();
}
window.addEventListener("hashchange", route);
route();
api("health")
  .then((value) => {
    state.health = value;
    document.querySelector("#api-status").textContent =
      "● Python API connected";
    if (!location.hash || location.hash === "#dashboard") route();
  })
  .catch(() => {
    document.querySelector("#api-status").textContent = "● API unavailable";
  });
