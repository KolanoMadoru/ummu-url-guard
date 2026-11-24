import { heading, empty } from "../utils/ui.js";
import { currentResearchReport } from "../utils/research-reports.js";
import { researchReportCaption, watchResearchReport } from "../components/automatic-research.js";
import { mountResearchAnalysis, renderResearchAnalysis } from "../components/research-workspace.js";

export function render() {
  const report = currentResearchReport();
  return heading("Analisis Hasil", "Bandingkan performa dan pola kesalahan pada data uji.") +
    (report ? researchReportCaption(report) + renderResearchAnalysis(report)
      : empty("Jalankan penelitian untuk membandingkan model dan mengunduh hasilnya."));
}

export function mount(_state, navigate) {
  mountResearchAnalysis(currentResearchReport());
  return watchResearchReport(() => navigate("analysis"));
}
