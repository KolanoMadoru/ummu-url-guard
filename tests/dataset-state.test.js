import test from "node:test";
import assert from "node:assert/strict";
import {
  createDatasetStore,
  trainingEligibility,
} from "../src/utils/dataset-state.js";
const summary = {
  validation_status: "Validated",
  valid: true,
  total_records: 100,
  valid_records: 100,
  unique_records: 100,
  class_distribution: { benign: 50, phishing: 50 },
};

test("selection, concurrency, progress, cancel, stale events, reselection, cleanup and reset", () => {
  const workers = [];
  const store = createDatasetStore({
    workerFactory: () => {
      const w = {
        postMessage() {},
        terminate() {
          this.terminated = true;
        },
      };
      workers.push(w);
      return w;
    },
  });
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  store.select(new File(["url,label"], "first.csv"));
  store.start();
  store.start();
  assert.equal(workers.length, 1);
  const old = workers[0];
  old.onmessage({
    data: {
      type: "progress",
      progress: { percent: 20, rows: 10, bytes: 100, phase: "Processing" },
    },
  });
  assert.equal(store.get().status, "Processing");
  store.cancel();
  assert.ok(old.terminated);
  assert.equal(store.get().status, "Processing Cancelled");
  old.onmessage({ data: { type: "complete", summary } });
  assert.equal(store.get().summary, null);
  store.select(new File(["url,label"], "second.csv"));
  store.start();
  workers[1].onmessage({ data: { type: "complete", summary } });
  assert.equal(store.get().status, "Validated");
  assert.ok(trainingEligibility(store.get()).eligible);
  unsubscribe();
  const count = notifications;
  store.reset();
  assert.equal(notifications, count);
  assert.equal(store.get().file, null);
  assert.equal(createDatasetStore().get().status, "No File Selected");
});
test("large browser-validated datasets never become eligible for online training", () => {
  const result = trainingEligibility({
    file: { size: 3 * 1048576 },
    status: "Validated",
    summary,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.large, true);
  assert.equal(
    trainingEligibility({
      file: { size: 100 },
      status: "Validated",
      summary: { ...summary, total_records: 1001 },
    }).eligible,
    false,
  );
});
test("research metadata is routed to local audit even within online limits", () => {
  const result = trainingEligibility({
    file: { size: 8192 },
    status: "Validated",
    summary: { ...summary, hasResearchMetadata: true },
  });
  assert.deepEqual(result, {
    eligible: false,
    reason: "Research metadata requires the local audited pipeline.",
  });
});
