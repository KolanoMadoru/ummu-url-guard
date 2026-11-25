const BASIC_FEATURE_NAMES = [
  "url_length", "domain_length", "digit_count", "dot_count",
  "hyphen_count", "special_count", "subdomain_count",
];

export function predictBrowserForest(model, featureResult, { basic = false } = {}) {
  if (model?.schema !== "ummu-random-forest-v1" ||
      model.schema_version !== featureResult?.schema_version ||
      !Array.isArray(model.feature_names) ||
      model.feature_names.length !== (basic ? BASIC_FEATURE_NAMES.length : 19) ||
      (basic && !BASIC_FEATURE_NAMES.every((name, index) => model.feature_names[index] === name)) ||
      !Array.isArray(model.trees) || !model.trees.length) return null;
  const values = model.feature_names.map((name) => featureResult.features?.[name]);
  if (!values.every(Number.isFinite)) return null;
  const features = values.map(Math.fround);
  if (!features.every(Number.isFinite)) return null;
  let sum = 0;
  for (const tree of model.trees) {
    let index = 0, probability;
    for (let depth = 0; depth < tree.length; depth++) {
      const node = tree[index];
      if (!node) break;
      const [feature, threshold, left, right] = node;
      if (feature === -1) {
        probability = threshold;
        break;
      }
      index = features[feature] <= threshold ? left : right;
    }
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) return null;
    sum += probability;
  }
  const probability = sum / model.trees.length;
  return { probability, prediction: probability > 0.5 ? "phishing" : "benign" };
}
