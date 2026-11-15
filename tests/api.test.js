import test from "node:test";
import assert from "node:assert/strict";
import { api, APIError } from "../src/utils/api.js";

for (const status of [413, 422, 429, 500, 502, 503, 504]) {
  test(`handles HTTP ${status} plaintext and HTML without a JSON SyntaxError`, async () => {
    for (const [body, type] of [
      ["Request Entity Too Large", "text/plain"],
      ["<html>Upstream error</html>", "text/html"],
    ]) {
      global.fetch = async () =>
        new Response(body, { status, headers: { "Content-Type": type } });
      await assert.rejects(
        api("train"),
        (e) =>
          e instanceof APIError &&
          e.status === status &&
          !/Unexpected token/.test(e.message) &&
          !e.message.includes("<html>"),
      );
    }
  });
}
test("parses JSON errors, validation arrays, non-JSON success and malformed JSON safely", async () => {
  global.fetch = async () =>
    Response.json({ detail: "Invalid labels" }, { status: 422 });
  await assert.rejects(api("train"), /Invalid labels/);
  global.fetch = async () =>
    Response.json(
      { detail: [{ loc: ["body", "file"], msg: "Required field" }] },
      { status: 422 },
    );
  await assert.rejects(api("train"), /Required field/);
  global.fetch = async () =>
    new Response("not json", {
      headers: { "Content-Type": "application/json" },
    });
  await assert.rejects(api("health"), /invalid JSON/);
  global.fetch = async () =>
    new Response("HTML page", { headers: { "Content-Type": "text/html" } });
  await assert.rejects(api("health"), /non-JSON/);
  global.fetch = async () => Response.json({ status: "ok" });
  assert.deepEqual(await api("health"), { status: "ok" });
});
test("timeout, cancellation and network failure have distinct useful errors", async () => {
  global.fetch = async (url, { signal }) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
      else
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
    });
  await assert.rejects(api("train", { timeoutMs: 10 }), /timed out/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    api("train", { signal: controller.signal }),
    /cancelled/,
  );
  global.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(api("health"), /Cannot reach/);
});
test("large files never reach fetch; small multipart payload size and boundary match the actual body", async () => {
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.ok(options.body.size > 20);
    assert.ok(options.body.size <= 2 * 1048576 + 65536);
    const boundary = options.headers["Content-Type"].split("boundary=")[1];
    assert.ok((await options.body.text()).startsWith("--" + boundary));
    return Response.json({ ok: true });
  };
  await assert.rejects(
    api("train", { file: new File(["x".repeat(3 * 1048576)], "large.csv") }),
    /2 MiB/,
  );
  assert.equal(calls, 0);
  await api("dataset/analyze", {
    file: new File(["url,label\nhttps://x.com,0"], "small.csv"),
  });
  assert.equal(calls, 1);
});
