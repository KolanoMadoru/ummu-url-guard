// Synthetic UI fixture; these aggregate values are not research evidence.
export function researchReport(experimentId = "synthetic-test-run") {
  const metrics = {
    rows: 2,
    benign: 1,
    phishing: 1,
    accuracy: 0.5,
    precision: 0.5,
    recall: 1,
    f1: 2 / 3,
    specificity: 0,
    false_positive_rate: 1,
    false_negative_rate: 0,
    roc_auc: null,
    confusion_matrix: [[0, 1], [0, 1]],
  };
  return {
    schema: "ummu-research-summary-v1",
    experiment_id: experimentId,
    dataset_hash: "1".repeat(64),
    dataset_version: "synthetic-test",
    feature_schema: "lexical-v2",
    rows: 12,
    split_method: "predefined",
    split: {
      train: { rows: 8, benign: 4, phishing: 4 },
      validation: { rows: 2, benign: 1, phishing: 1 },
      test: { rows: 2, benign: 1, phishing: 1 },
    },
    categories: { biasa_0: 6, biasa_1: 6 },
    sources: { Synthetic: 12 },
    shorteners: {},
    audit: { status: "passed", metadata: true, checks: { group: 0, domain: 0 } },
    results: ["Random Forest", "Decision Tree", "Logistic Regression"].flatMap(
      (model, i) => ["basic", "extended"].map((features, j) => ({
        id: `E${2 * i + j + 1}`,
        model_name: model,
        feature_set: features,
        metrics,
        scenarios: { biasa: metrics, pendek: null, merek: null },
      })),
    ),
  };
}
