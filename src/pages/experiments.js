import { empty, heading } from "../utils/ui.js";
import { currentResearchReport } from "../utils/research-reports.js";
import {
  mountResearchControls, renderResearchStage, researchReportCaption, watchResearchReport,
} from "../components/automatic-research.js";
import { mountResearchAnalysis, renderResearchAnalysis } from "../components/research-workspace.js";

export function render() {
  const report = currentResearchReport();
  return `${heading("Eksperimen Fitur", "Bandingkan tiga algoritma dan dua kelompok fitur pada split yang sama.")}
    ${renderResearchStage("train", "Enam konfigurasi memakai 7 fitur dasar atau 19 fitur lengkap. Ekstraksi fitur yang sudah selesai digunakan kembali.")}
    ${report ? researchReportCaption(report) + renderResearchAnalysis(report)
      : empty("Selesaikan evaluasi untuk melihat perbandingan enam konfigurasi.")}`;
}

export function mount(_state, navigate) {
  mountResearchAnalysis(currentResearchReport());
  const controls = mountResearchControls(document.querySelector("#research-stage-panel"));
  const unwatch = watchResearchReport(() => navigate("experiments"));
  return () => {
    unwatch();
    controls.dispose();
  };
}
