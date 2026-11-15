import { analyzeCSV } from "../utils/csv-parser.js";
self.onmessage = async ({ data }) => {
  try {
    const summary = await analyzeCSV(data.file, {
      limits: data.limits,
      onProgress: (progress) =>
        self.postMessage({ type: "progress", progress }),
    });
    self.postMessage({ type: "complete", summary });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error.message || "CSV processing failed.",
    });
  }
};
