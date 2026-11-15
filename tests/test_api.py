import pytest
from fastapi.testclient import TestClient
from api import index


@pytest.fixture
def client():
    index.RATE_BUCKETS.clear()
    return TestClient(index.app)


def test_health_features_and_model_unavailable(client):
    assert client.get('/api/health').json()['status'] == 'ok'
    response = client.post('/api/features', json={'url': 'https://example.com'})
    assert response.status_code == 200 and response.json()['features']['https'] == 1
    assert client.post('/api/features', json={'url': 'ftp://example.com'}).status_code == 422
    prediction = client.post('/api/predict', json={'url': 'https://example.com'}).json()
    assert prediction['prediction'] is None and prediction['available'] is False


def test_scan_prediction_survives_online_failure(client, monkeypatch):
    monkeypatch.setattr(index, 'scan_url', lambda u: {'status': 'unavailable', 'reason': 'DNS resolution failed.', 'redirect_count': 0})
    result = client.post('/api/scan', json={'url': 'https://example.com'}).json()
    assert result['online']['status'] == 'unavailable' and result['features']['url_length'] > 0
    assert 'guarantee' in result['disclaimer']


def test_analyze_and_train(client, research_csv):
    assert client.post('/api/dataset/analyze', files={'file': ('research.csv', research_csv, 'text/csv')}).status_code == 200
    result = client.post('/api/train', files={'file': ('research.csv', research_csv, 'text/csv')})
    assert result.status_code == 200
    assert len(result.json()['results']) == 3
    assert index.production.model is None
    assert client.post('/api/train', files={'file': ('empty.csv', b'', 'text/csv')}).status_code == 422


def test_evaluate_input_validation(client):
    data = {'actual': [0, 1], 'predicted': [0, 1], 'phishing_scores': [0.1, 0.9]}
    assert client.post('/api/evaluate', json=data).json()['metrics']['accuracy'] == 1
    data['predicted'] = [1, 2]
    assert client.post('/api/evaluate', json=data).status_code == 422
    data['predicted'] = [1, 0, 1]
    assert client.post('/api/evaluate', json=data).status_code == 422


def test_body_limit_and_rate_limit(client):
    assert client.post('/api/features', content=b'x' * 17000).status_code == 413
    for _ in range(29):
        client.get('/api/health')
    assert client.get('/api/health').status_code == 429
