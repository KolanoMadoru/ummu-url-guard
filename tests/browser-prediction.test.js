import test from "node:test";
import assert from "node:assert/strict";

import { predictBrowserForest } from "../src/utils/browser-prediction.js";

const featureNames = [
  "url_length", "domain_length", "digit_count", "dot_count",
  "hyphen_count", "special_count", "subdomain_count",
];
const basicModel = {
  schema: "ummu-random-forest-v1",
  schema_version: "fixture",
  feature_names: featureNames,
  trees: [[[0, 30, 1, 2], [-1, 0.2, 0, 0], [-1, 0.8, 0, 0]]],
};
const featureResult = {
  schema_version: "fixture",
  features: Object.fromEntries(featureNames.map((name, index) => [name, index ? 1 : 35])),
};

test("only the explicitly requested basic model uses the ordered seven features", () => {
  assert.equal(predictBrowserForest(basicModel, featureResult), null);
  assert.deepEqual(predictBrowserForest(basicModel, featureResult, { basic: true }), {
    prediction: "phishing", probability: 0.8,
  });
  const reordered = { ...basicModel, feature_names: [...featureNames].reverse() };
  assert.equal(predictBrowserForest(reordered, featureResult, { basic: true }), null);
});

test("missing, nonnumeric, or incompatible features produce no fallback prediction", () => {
  const futureSchema = { ...featureResult, schema_version: "different" };
  assert.equal(predictBrowserForest(basicModel, futureSchema, { basic: true }), null);
  for (const url_length of [undefined, null, "35", Infinity]) {
    const partial = { ...featureResult, features: { ...featureResult.features, url_length } };
    assert.equal(predictBrowserForest(basicModel, partial, { basic: true }), null);
  }
});
