import hashlib
import json
import numpy as np
import joblib
import pytest
import sklearn

from ml.features import extract_features, FEATURE_NAMES, SCHEMA_VERSION
from ml.model import ProductionModel, run_experiment, split_dataset
from ml.evaluation import evaluate


def test_model_unavailable(tmp_path):
    result = ProductionModel(tmp_path).predict(extract_features('https://example.com'))
    assert result['available'] is False
    assert result['probability'] is None
    assert 'not trained' in result['reason']


def test_domain_groups_do_not_leak(dataset):
    df, _ = dataset
    train, val, test, y, seed = split_dataset(df)
    sets = [set(df.iloc[idx]['group']) for idx in (train, val, test)]
    assert sets[0].isdisjoint(sets[1]) and sets[0].isdisjoint(sets[2]) and sets[1].isdisjoint(sets[2])
    assert len(train) + len(val) + len(test) == len(df)
    assert all(len(set(y[idx])) == 2 for idx in (train, val, test))
    assert np.array_equal(train, split_dataset(df)[0])


def test_actual_training_comparison_and_persistence(dataset, tmp_path):
    df, summary = dataset
    report, bundle = run_experiment(df, summary, feature_sets=('basic', 'extended'))
    assert len(report['results']) == 6
    assert len({r['test_count'] for r in report['results']}) == 1
    assert {r['model_name'] for r in report['results']} == {'Random Forest', 'Logistic Regression', 'Decision Tree'}
    for result in report['results']:
        m = result['metrics']
        assert sum(map(sum, m['confusion_matrix'])) == result['test_count']
        assert 0 <= m['accuracy'] <= 1 and m['roc_curve'] is not None
    artifact = tmp_path / 'production.joblib'
    joblib.dump(bundle, artifact)
    info = {'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest(), 'schema_version': SCHEMA_VERSION,
            'feature_names': list(FEATURE_NAMES), 'sklearn_version': sklearn.__version__, 'version': bundle['version']}
    (tmp_path / 'model_metadata.json').write_text(json.dumps(info))
    model = ProductionModel(tmp_path)
    result = model.predict(extract_features('https://public-example.com/login'))
    assert result['available'] and result['model_version'] == bundle['version']
    assert 0 <= result['probability'] <= 1
    # A tampered artifact must be rejected before joblib deserialization.
    artifact.write_bytes(b'untrusted pickle')
    assert ProductionModel(tmp_path).model is None


def test_imbalanced_or_insufficient_data_rejected(dataset):
    df, summary = dataset
    df['label'] = 'benign'
    with pytest.raises(ValueError, match='Each label'):
        split_dataset(df)
    with pytest.raises(ValueError, match='30 unique'):
        split_dataset(df.head(3))


def test_confusion_and_undefined_auc():
    result = evaluate([0, 0, 1, 1], [0, 1, 0, 1], [0.1, 0.7, 0.2, 0.9])
    assert result['confusion_matrix'] == [[1, 1], [1, 1]]
    assert result['accuracy'] == result['precision'] == result['recall'] == result['f1'] == 0.5
    assert evaluate([0, 0], [0, 0], [0.1, 0.2])['roc_auc'] is None
