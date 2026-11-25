import { empty, heading } from "../utils/ui.js";
import { currentResearchReport } from "../utils/research-reports.js";
import {
  mountResearchControls, renderResearchStage, researchReportCaption, watchResearchReport,
} from "../components/automatic-research.js";
import { mountResearchAnalysis, renderResearchAnalysis } from "../components/research-workspace.js";

export function render() {
  const report = currentResearchReport();
  return `${heading("Eksperimen Fitur")}
    ${renderResearchStage("train")}
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
