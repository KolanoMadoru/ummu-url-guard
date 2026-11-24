import { currentResearchReport } from "../utils/research-reports.js";
import { heading } from "../utils/ui.js";
import { mountResearchControls, renderResearchStage } from "../components/automatic-research.js";

export function render() {
  const report = currentResearchReport();
  return `${heading("Pelatihan Model", "Latih Random Forest, Decision Tree, dan Logistic Regression pada data pelatihan yang sama.")}
    ${renderResearchStage("train", "Setiap algoritma menggunakan 7 fitur dasar dan 19 fitur lengkap. Data validasi digunakan untuk membandingkan konfigurasi sebelum data uji dievaluasi.")}
    <section class="card" id="training-next"${report ? "" : " hidden"}><h3>Hasil Eksperimen</h3>
      <div class="actions"><a class="button secondary" href="#evaluation">Buka Evaluasi Model</a><a class="button secondary" href="#experiments">Bandingkan Kelompok Fitur</a></div>
    </section>`;
}

export function mount() {
  const controls = mountResearchControls(document.querySelector("#research-stage-panel"), (snapshot) => {
    document.querySelector("#training-next").hidden =
      !snapshot.completed.includes("train") && !currentResearchReport();
  });
  return controls.dispose;
}
