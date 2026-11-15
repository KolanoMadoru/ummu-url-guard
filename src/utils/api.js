export async function api(path, { json, file } = {}) {
  const body = file ? new FormData() : json ? JSON.stringify(json) : undefined;
  if (file) body.append("file", file);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    path.includes("train") || path.includes("experiment") ? 55000 : 20000,
  );
  try {
    const response = await fetch(`/api/${path}`, {
      method: body ? "POST" : "GET",
      body,
      headers: json ? { "Content-Type": "application/json" } : {},
      signal: controller.signal,
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(
        typeof value.detail === "string"
          ? value.detail
          : "The request was rejected. Check the input format.",
      );
    return value;
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error(
        "Request timed out. For large training jobs, use the local Python script.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
