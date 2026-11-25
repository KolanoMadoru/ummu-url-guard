import { displayText } from "./utils/i18n.js";
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
  ["dashboard", "Dasbor", "layout-dashboard"],
  ["scanner", "Pemindai URL", "scan-line"],
  ["dataset", "Manajemen Dataset", "database"],
  ["features", "Ekstraksi Fitur", "list-filter"],
  ["training", "Pelatihan Model", "brain-circuit"],
  ["evaluation", "Evaluasi Model", "chart-no-axes-combined"],
  ["experiments", "Eksperimen Fitur", "flask-conical"],
  ["analysis", "Analisis Hasil", "file-chart-column"],
  ["history", "Riwayat Deteksi", "history"],
];
const state = { health: null };
let cleanupPage;

document.querySelector("#app").innerHTML =
  `<aside id="sidebar"><a class="brand" href="#dashboard"><span class="brand-mark"><i data-lucide="shield-check"></i></span><span>UMMU <b>URL GUARD</b></span></a><p class="nav-label">MENU UTAMA</p><nav aria-label="Navigasi utama">${navigation.map(([key, label, icon]) => `<a href="#${key}" data-page="${key}"><i data-lucide="${icon}"></i>${label}</a>`).join("")}</nav><div class="sidebar-footer">UMMU URL GUARD <span>v0.1.0</span></div></aside>
  <div class="workspace"><header><div class="header-left"><button id="menu-toggle" class="icon-button" aria-label="Buka atau tutup navigasi" aria-expanded="false" aria-controls="sidebar"><i data-lucide="menu"></i></button><span>Deteksi Phishing pada URL Pendek dan Domain Typosquatting</span></div><span id="api-status" class="connection"><span class="status-dot"></span>Menghubungkan API</span></header><main id="content" tabindex="-1"></main><footer>Dibuat oleh Muhammad Rahman Muttaqin | NPM: 12105 55201 21 162</footer><p id="storage-warning" class="error" role="status"></p></div>`;
// Localize native form validation independently of the browser's UI language.
document.addEventListener("invalid", (event) => {
  const input = event.target;
  input.setCustomValidity("");
  if (input.validity.valueMissing) input.setCustomValidity("Kolom ini wajib diisi.");
  else if (input.validity.typeMismatch) input.setCustomValidity("Masukkan URL HTTP atau HTTPS yang valid.");
}, true);
document.addEventListener("input", (event) => event.target.setCustomValidity?.(""));
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
  document.querySelector("#storage-warning").textContent = displayText(getStorageWarning());
}
window.addEventListener("hashchange", route);
route();
api("health")
  .then((value) => {
    state.health = value;
    document.querySelector("#api-status").textContent =
      "● API Python Terhubung";
    if (!location.hash || location.hash === "#dashboard") route();
  })
  .catch(() => {
    document.querySelector("#api-status").textContent = "● API Python Tidak Terhubung";
  });
