import { ONLINE_LIMITS } from "./dataset-config.js";
export class APIError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}
const STATUS_MESSAGES = {
  413: "Ukuran request melebihi batas server. Dataset akan diproses melalui mekanisme yang mendukung file besar. Return to Dataset Management for browser validation; large datasets require local training.",
  422: "Dataset or request validation failed. Check the required fields, labels and backend training limits.",
  429: "Too many requests or an experiment is already running. Wait a minute and try again.",
  500: "The server could not complete this operation. No successful result was recorded.",
  502: "The API gateway could not reach the backend. Try again later.",
  503: "The backend is temporarily unavailable. Try again later.",
  504: "The server timed out. Use the local training script for larger datasets.",
};
export async function api(path, { json, file, signal, timeoutMs } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    timeoutMs ?? (/train|experiment/.test(path) ? 55000 : 20000),
  );
  try {
    let body,
      headers = {};
    if (file) {
      // Build and measure the actual multipart payload only after bounding the source.
      if (file.size > ONLINE_LIMITS.maxFileBytes)
        throw new APIError(
          "This file exceeds the 2 MiB backend upload limit. Validate it in the browser and use local training.",
          413,
        );
      const form = new FormData();
      form.append("file", file);
      const serialized = new Response(form);
      const contentType = serialized.headers.get("Content-Type");
      body = await serialized.blob();
      if (body.size > ONLINE_LIMITS.maxFileBytes + 65536)
        throw new APIError(
          "Multipart request exceeds the backend limit. Use local training.",
          413,
        );
      // Blob.type lowercases boundary tokens in browsers; preserve the serializer header.
      headers["Content-Type"] = contentType;
    } else if (json !== undefined) {
      body = JSON.stringify(json);
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(`/api/${path}`, {
      method: body ? "POST" : "GET",
      body,
      headers,
      signal: controller.signal,
    });
    const isJSON = /\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(
      response.headers.get("content-type") || "",
    );
    let value;
    if (isJSON) {
      try {
        value = await response.json();
      } catch {
        if (response.ok)
          throw new APIError(
            "The server returned an invalid JSON response. No successful result was recorded.",
            response.status,
          );
      }
    }
    if (!response.ok) {
      // Provider HTML/plaintext errors are not JSON, never rendered as HTML or echoed.
      const detail =
        typeof value?.detail === "string"
          ? value.detail
          : Array.isArray(value?.detail)
            ? value.detail
                .map(
                  (e) =>
                    `${(e.loc || []).join(".")}: ${e.msg || "Invalid value"}`,
                )
                .join("; ")
            : null;
      throw new APIError(
        response.status === 413
          ? STATUS_MESSAGES[413]
          : detail ||
              STATUS_MESSAGES[response.status] ||
              `Request failed (HTTP ${response.status}).`,
        response.status,
      );
    }
    if (!isJSON)
      throw new APIError(
        "The server returned a non-JSON response. Check the API route; no successful result was recorded.",
        response.status,
      );
    return value;
  } catch (error) {
    if (controller.signal.aborted)
      throw new APIError(
        timedOut
          ? "Request timed out. For large training jobs, use the local Python script."
          : "Request cancelled.",
      );
    if (error instanceof APIError) throw error;
    throw new APIError(
      "Cannot reach the API. Check your connection and backend availability.",
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
