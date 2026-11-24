// Browser validation and online training have deliberately separate resource budgets.
const env = import.meta.env || {};
const bounded = (value, fallback, ceiling) =>
  Number.isFinite(Number(value)) && Number(value) > 0
    ? Math.min(Number(value), ceiling)
    : fallback;
export const DATASET_LIMITS = Object.freeze({
  maxFileBytes: Math.floor(
    bounded(env.VITE_DATASET_MAX_MIB, 25, 100) * 1024 * 1024,
  ),
  maxRows: Math.floor(bounded(env.VITE_DATASET_MAX_ROWS, 1000000, 2000000)),
  maxUniqueURLs: Math.floor(
    bounded(env.VITE_DATASET_MAX_UNIQUE_URLS, 250000, 500000),
  ),
  maxRecordBytes: 256 * 1024,
  maxURLLength: 16_384,
  chunkBytes: 256 * 1024,
  previewRows: 50,
});
export const ONLINE_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxRows: 1000,
  maxURLLength: 4096,
  minUniqueRows: 30,
});
export const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
