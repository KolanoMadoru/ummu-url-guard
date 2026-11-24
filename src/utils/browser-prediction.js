export function predictBrowserForest(model, featureResult) {
  if (model?.schema !== "ummu-random-forest-v1" ||
      model.schema_version !== featureResult.schema_version ||
      model.feature_names?.length !== 19 || !model.trees?.length) return null;
  const features = model.feature_names.map((name) => Math.fround(featureResult.features[name]));
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
