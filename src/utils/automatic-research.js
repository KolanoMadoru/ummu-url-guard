import { importResearchReport } from "./research-reports.js";

const initial = () => ({
  phase: "loading", stage: null, completed: [], dataset: null,
  progress: null, report: null, error: "", storageWarning: "",
  redirectComparisonReady: false, redirectComparisonRunning: false, redirectComparison: null,
});
let snapshot = initial();
let worker;
let ready;
let activeModel = null;
let sequence = 0;
const listeners = new Set();
const pendingRequests = new Map();

function publish(update) {
  snapshot = update;
  for (const listener of listeners) listener(snapshot);
}

function initialize() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    try {
      worker = new Worker(new URL("../workers/automatic-research.js", import.meta.url), { type: "module" });
    } catch {
      publish({ ...initial(), phase: "failed", error: "Browser tidak dapat menjalankan proses penelitian." });
      resolve();
      return;
    }
    worker.onmessage = ({ data }) => {
      if (data.type === "snapshot") {
        publish(data.snapshot);
      } else if (data.type === "model") {
        activeModel = data.model;
      } else if (data.type === "report") {
        try {
          importResearchReport(data.report);
        } catch {
          publish({ ...snapshot, storageWarning: "Ringkasan belum bisa disimpan di daftar riwayat." });
        }
      } else if (data.type === "ready") {
        resolve();
      } else if (["export", "reset", "redirectComparison"].includes(data.type)) {
        const pending = pendingRequests.get(data.id);
        pendingRequests.delete(data.id);
        if (data.error) pending?.reject(new Error(data.error));
        else pending?.resolve(data.content);
      }
    };
    worker.onerror = () => {
      publish({ ...snapshot, phase: "failed", error: "Proses penelitian terhenti. Muat ulang untuk melanjutkan dari tahap tersimpan." });
      for (const pending of pendingRequests.values()) pending.reject(new Error(snapshot.error));
      pendingRequests.clear();
      worker.terminate();
      worker = null;
      resolve();
    };
    worker.postMessage({ type: "load" });
  });
  return ready;
}

async function workerRequest(type, fields) {
  await initialize();
  if (!worker) throw new Error("Proses penelitian tidak tersedia.");
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pendingRequests.set(id, { resolve, reject });
    worker.postMessage({ ...fields, type, id });
  });
}

export const automaticResearch = {
  get: () => snapshot,
  subscribe(listener) {
    listeners.add(listener);
    listener(snapshot);
    initialize();
    return () => listeners.delete(listener);
  },
  async run(file, throughStage = "evaluate") {
    await initialize();
    worker?.postMessage({ type: "run", file, throughStage });
  },
  async cancel() {
    await initialize();
    worker?.postMessage({ type: "cancel" });
  },
  reset() {
    return workerRequest("reset");
  },
  export(kind) {
    return workerRequest("export", { kind });
  },
  compareRedirects(file) {
    return workerRequest("redirectComparison", { file });
  },
  async activeModel() {
    await initialize();
    return activeModel;
  },
};
