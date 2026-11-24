import { DATASET_LIMITS, ONLINE_LIMITS } from "./dataset-config.js";

export function trainingEligibility(dataset) {
  if (!dataset.file)
    return {
      eligible: false,
      reason: "Select and validate a CSV in Dataset Management.",
    };
  if (dataset.status !== "Validated")
    return {
      eligible: false,
      reason:
        "Validate the selected dataset successfully in Dataset Management first.",
    };
  if (dataset.summary.hasResearchMetadata)
    return {
      eligible: false,
      reason: "Research metadata requires the local audited pipeline.",
    };
  if (dataset.summary.urls_over_online_limit)
    return {
      eligible: false,
      reason: "Dataset memuat URL yang melebihi batas panjang daring. Gunakan pipeline penelitian lokal.",
    };
  if (
    dataset.file.size > ONLINE_LIMITS.maxFileBytes ||
    dataset.summary.total_records > ONLINE_LIMITS.maxRows
  )
    return {
      eligible: false,
      large: true,
      reason: "Large Dataset — Local Training Required",
    };
  if (
    dataset.summary.unique_records < ONLINE_LIMITS.minUniqueRows ||
    Math.min(...Object.values(dataset.summary.class_distribution)) < 6
  )
    return {
      eligible: false,
      reason:
        "Online training needs 30 unique URLs, 6 rows per label, and 10 independent domain groups. Python verifies domain splits.",
    };
  return {
    eligible: true,
    reason:
      "Dataset Ready · within online upload/row limits. Python verifies domain groups and split eligibility.",
  };
}
const initial = () => ({
  file: null,
  name: "",
  size: 0,
  status: "No File Selected",
  progress: { bytes: 0, totalBytes: 0, rows: 0, percent: 0 },
  summary: null,
  error: "",
  backend: null,
});
export function createDatasetStore({
  limits = DATASET_LIMITS,
  workerFactory = () =>
    new Worker(new URL("../workers/csv-worker.js", import.meta.url), {
      type: "module",
    }),
} = {}) {
  let value = initial(),
    worker = null,
    generation = 0;
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener(value));
  const stop = () => {
    generation++;
    worker?.terminate();
    worker = null;
  };
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener);
      listener(value);
      return () => listeners.delete(listener);
    },
    select(file) {
      stop();
      value = {
        ...initial(),
        file: file || null,
        name: file?.name || "",
        size: file?.size || 0,
        status: file ? "File Selected" : "No File Selected",
      };
      if (
        file &&
        (!/\.csv$/iu.test(file.name) ||
          !file.size ||
          file.size > limits.maxFileBytes)
      ) {
        value.status = "Validation Failed";
        value.error = !/\.csv$/iu.test(file.name)
          ? "Only .csv files are supported."
          : !file.size
            ? "CSV is empty."
            : `File exceeds the ${limits.maxFileBytes / 1048576} MiB browser validation limit.`;
      }
      emit();
    },
    start() {
      if (
        !value.file ||
        worker ||
        value.size > limits.maxFileBytes ||
        !/\.csv$/iu.test(value.name) ||
        !value.size
      )
        return;
      value = {
        ...value,
        status: "Validating",
        error: "",
        summary: null,
        backend: null,
        progress: { bytes: 0, totalBytes: value.size, rows: 0, percent: 0 },
      };
      emit();
      const id = ++generation;
      try {
        worker = workerFactory();
        worker.onmessage = ({ data }) => {
          if (id !== generation) return;
          if (data.type === "progress") {
            value = {
              ...value,
              status: data.progress.phase,
              progress: data.progress,
            };
            emit();
          } else if (data.type === "complete") {
            value = {
              ...value,
              status: data.summary.validation_status,
              summary: data.summary,
              progress: { ...value.progress, bytes: value.size, percent: 100 },
            };
            stop();
            emit();
          } else {
            value = {
              ...value,
              status: "Validation Failed",
              error: data.message || "CSV worker failed.",
            };
            stop();
            emit();
          }
        };
        worker.onerror = () => {
          if (id === generation) {
            value = {
              ...value,
              status: "Validation Failed",
              error:
                "CSV worker failed or ran out of resources. Use a smaller file or local processing.",
            };
            stop();
            emit();
          }
        };
        worker.postMessage({ file: value.file, limits });
      } catch {
        value = {
          ...value,
          status: "Validation Failed",
          error:
            "CSV worker could not start. Use a current browser or local processing.",
        };
        stop();
        emit();
      }
    },
    cancel() {
      if (worker) {
        stop();
        value = {
          ...value,
          status: "Processing Cancelled",
          summary: null,
          error: "",
        };
        emit();
      }
    },
    reset() {
      stop();
      value = initial();
      emit();
    },
    setBackend(summary, file) {
      if (value.file === file) {
        value = { ...value, backend: summary };
        emit();
      }
    },
  };
}
export const datasetStore = createDatasetStore();
