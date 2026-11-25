import hashlib
import socket
from unittest.mock import Mock

import numpy as np
import pytest
from fastapi.testclient import TestClient
from api import index
from ml import scanner


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


def test_scan_features_survive_online_failure_without_short_link_prediction(client, monkeypatch):
    monkeypatch.setenv('ONLINE_SCAN_ENABLED', '1')
    monkeypatch.setattr(index, 'scan_url', lambda u: {'status': 'unavailable', 'reason': 'DNS resolution failed.', 'redirect_count': 0})
    predict = Mock(side_effect=AssertionError('Do not predict an unresolved short link'))
    monkeypatch.setattr(index.production, 'predict', predict)
    result = client.post('/api/scan', json={'url': 'https://t.ly/example', 'check_redirect': True}).json()
    assert result['online']['status'] == 'unavailable' and result['features']['url_length'] > 0
    assert result['destination'] is None
    assert result['available'] is False and result['prediction'] is None
    assert result['probability'] is None and result['model_version'] is None
    assert result['reason'] == 'Check the redirect destination before predicting a short link.'
    predict.assert_not_called()
    assert 'guarantee' in result['disclaimer']


def test_scan_defaults_to_offline_and_shares_the_original_url_features(client, monkeypatch):
    monkeypatch.delenv('ONLINE_SCAN_ENABLED', raising=False)
    monkeypatch.delenv('VERCEL', raising=False)
    payload = {'url': 'HTTPS://BÜCHER.de:443/über'}
    scan = client.post('/api/scan', json=payload).json()
    features = client.post('/api/features', json=payload).json()
    assert not client.get('/api/health').json()['online_scan_enabled']
    assert scan['online']['status'] == 'disabled'
    assert scan['features'] == features['features']
    assert scan['features']['url_length'] == len(payload['url'])


@pytest.mark.parametrize(('enabled', 'payload', 'status', 'should_predict'), [
    ('0', {'url': 'https://t.ly/token', 'check_redirect': True}, 'disabled', False),
    ('1', {'url': 'https://t.ly/token'}, 'not_requested', False),
    ('0', {'url': 'https://example.com/token', 'check_redirect': True}, 'disabled', True),
    ('1', {'url': 'https://example.com/token'}, 'not_requested', True),
    ('1', {'url': 'https://t.ly/?q=token'}, 'not_requested', True),
])
def test_scan_requires_explicit_opt_in_and_online_configuration(
    client, monkeypatch, enabled, payload, status, should_predict,
):
    head = Mock(side_effect=AssertionError('HEAD must not be called'))
    predict = Mock(return_value={'available': True, 'prediction': 'benign', 'probability': 0.15, 'model_version': 'test'})
    monkeypatch.setenv('ONLINE_SCAN_ENABLED', enabled)
    monkeypatch.setattr(index, 'scan_url', head)
    monkeypatch.setattr(index.production, 'predict', predict)
    response = client.post('/api/scan', json=payload)
    assert response.status_code == 200
    result = response.json()
    assert result['online']['status'] == status
    assert result['online']['resolution_status'] == status.upper()
    assert result['destination'] is None
    assert result['initial_url'] == payload['url']
    assert len(result['features']) == 19
    head.assert_not_called()
    if should_predict:
        assert result['available'] is True and result['prediction'] == 'benign'
        assert result['prediction_target'] == 'initial'
        assert predict.call_args.args[0]['features'] == result['features']
        assert predict.call_count == 1
    else:
        assert result['available'] is False and result['prediction'] is None
        assert result['prediction_target'] is None
        predict.assert_not_called()


def test_scan_rejects_a_non_boolean_redirect_opt_in(client, monkeypatch):
    monkeypatch.setenv('ONLINE_SCAN_ENABLED', '1')
    head = Mock(side_effect=AssertionError('HEAD must not be called'))
    monkeypatch.setattr(index, 'scan_url', head)
    assert client.post('/api/scan', json={'url': 'https://t.ly/token', 'check_redirect': 'true'}).status_code == 422
    head.assert_not_called()


def dns_response(address):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (address, 443))]


@pytest.mark.parametrize(('initial_url', 'normalized_url', 'known_shortener'), [
    ('HTTPS://T.LY:443/Token', 'https://t.ly/Token', True),
    ('https://shorturl.at/Token', 'https://shorturl.at/Token', False),
])
def test_scan_extracts_initial_and_observed_destination_with_same_feature_schema(
    client, monkeypatch, initial_url, normalized_url, known_shortener,
):
    monkeypatch.setenv('ONLINE_SCAN_ENABLED', '1')
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda *_a, **_kw: dns_response('93.184.216.34'))
    destination_url = 'https://destination.example/login/123?a=1'
    head = Mock(side_effect=[(302, destination_url), (200, None)])
    monkeypatch.setattr(scanner, 'pinned_head', head)
    monkeypatch.setattr(scanner, 'pinned_get', Mock(return_value=(200, None)))
    predict = Mock(return_value={'available': True, 'prediction': 'phishing', 'probability': 0.9, 'model_version': 'test'})
    monkeypatch.setattr(index.production, 'predict', predict)
    response = client.post('/api/scan', json={'url': initial_url, 'check_redirect': True})
    assert response.status_code == 200
    result = response.json()
    destination = result['destination']
    assert result['initial_url'] == initial_url
    assert result['features'] == client.post('/api/features', json={'url': initial_url}).json()['features']
    assert destination['features'] == client.post('/api/features', json={'url': destination_url}).json()['features']
    assert result['features']['shortener'] == int(known_shortener)
    assert destination['features']['shortener'] == 0
    assert result['basic_features'] == list(index.BASIC_FEATURES)
    assert destination['schema_version'] == result['schema_version']
    assert result['online']['redirect_count'] == 1
    assert result['online']['status'] == 'complete'
    assert result['online']['resolution_status'] == 'RESOLVED'
    assert result['online']['destination_confirmed'] is True
    assert result['online']['is_redirected'] is True
    assert destination['url'] == destination_url
    assert result['prediction'] is None and result['available'] is False
    assert result['prediction_target'] == 'destination'
    assert result['probability'] is None and result['model_version'] is None
    assert destination['available'] is True and destination['prediction'] == 'phishing'
    assert destination['probability'] == 0.9 and destination['model_version'] == 'test'
    assert predict.call_args.args[0]['url'] == destination_url
    assert predict.call_args.args[0]['features'] == destination['features']
    assert predict.call_count == 1
    assert [call.args[0] for call in head.call_args_list] == [normalized_url, destination_url]


@pytest.mark.parametrize(('second_response', 'address', 'reason', 'head_calls'), [
    ((200, None), '10.0.0.1', 'blocked', 1),
    ((200, None), '169.254.169.254', 'blocked', 1),
    (socket.timeout(), '93.184.216.34', 'timed out', 2),
])
def test_scan_does_not_use_a_blocked_or_unconfirmed_destination(client, monkeypatch, second_response, address, reason, head_calls):
    monkeypatch.setenv('ONLINE_SCAN_ENABLED', '1')
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda host, *_a, **_kw: dns_response('93.184.216.34' if host == 't.ly' else address))
    head = Mock(side_effect=[(302, 'https://destination.example/login'), second_response])
    monkeypatch.setattr(scanner, 'pinned_head', head)
    predict = Mock()
    monkeypatch.setattr(index.production, 'predict', predict)
    initial_url = 'https://t.ly/token'
    response = client.post('/api/scan', json={'url': initial_url, 'check_redirect': True})
    assert response.status_code == 200
    result = response.json()
    assert result['online']['status'] == 'unavailable'
    assert reason in result['online']['reason']
    assert result['online']['observed_url'] == (
        'https://destination.example/login' if isinstance(second_response, socket.timeout) else None
    )
    assert result['destination'] is None
    assert result['available'] is False and result['prediction'] is None
    predict.assert_not_called()
    assert result['features'] == client.post('/api/features', json={'url': initial_url}).json()['features']
    assert head.call_count == head_calls


def test_scan_does_not_report_the_shortener_itself_as_a_destination(client, monkeypatch):
    monkeypatch.setenv('ONLINE_SCAN_ENABLED', '1')
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda *_a, **_kw: dns_response('93.184.216.34'))
    monkeypatch.setattr(scanner, 'pinned_head', Mock(return_value=(200, None)))
    monkeypatch.setattr(scanner, 'pinned_get', Mock(return_value=(200, None)))
    result = client.post('/api/scan', json={'url': 'https://t.ly/token', 'check_redirect': True}).json()
    assert result['online']['resolution_status'] == 'NO_REDIRECT'
    assert result['online']['destination_confirmed'] is False
    assert result['online']['final_url'] is None
    assert result['destination'] is None
    assert result['prediction_target'] is None


def test_scan_recovers_get_redirects_at_multiple_hops(client, monkeypatch):
    intermediate = 'https://bridge.example/path'
    destination = 'https://destination.example/landing'
    monkeypatch.setenv('ONLINE_SCAN_ENABLED', '1')
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda *_a, **_kw: dns_response('93.184.216.34'))
    monkeypatch.setattr(scanner, 'pinned_head', Mock(side_effect=[(405, None), (200, None), (200, None)]))
    monkeypatch.setattr(scanner, 'pinned_get', Mock(side_effect=[(302, intermediate), (307, destination), (200, None)]))
    predict = Mock(return_value={'prediction': 'benign', 'available': True})
    monkeypatch.setattr(index.production, 'predict', predict)
    result = client.post('/api/scan', json={'url': 'https://t.ly/token', 'check_redirect': True}).json()
    assert result['online']['status'] == 'complete'
    assert [hop['method'] for hop in result['online']['chain']] == ['HEAD', 'GET'] * 3
    assert result['online']['redirect_count'] == 2
    assert result['online']['http_status'] == 200
    assert result['prediction_target'] == 'destination'
    assert result['destination']['url'] == destination
    assert result['destination']['prediction'] == 'benign'
    assert len(result['destination']['features']) == 19 and len(result['basic_features']) == 7
    predict.assert_called_once()
    assert predict.call_args.args[0]['url'] == destination


def test_ordinary_url_with_no_redirect_is_predicted_from_initial_features(client, monkeypatch):
    url = 'https://ordinary.example/path'
    monkeypatch.setenv('ONLINE_SCAN_ENABLED', '1')
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda *_a, **_kw: dns_response('93.184.216.34'))
    monkeypatch.setattr(scanner, 'pinned_head', Mock(return_value=(200, None)))
    monkeypatch.setattr(scanner, 'pinned_get', Mock(return_value=(200, None)))
    predict = Mock(return_value={'available': True, 'prediction': 'benign'})
    monkeypatch.setattr(index.production, 'predict', predict)
    result = client.post('/api/scan', json={'url': url, 'check_redirect': True}).json()
    assert result['online']['resolution_status'] == 'NO_REDIRECT'
    assert result['online']['final_url'] is None
    assert result['prediction_target'] == 'initial'
    assert result['prediction'] == 'benign' and result['destination'] is None
    predict.assert_called_once()
    assert predict.call_args.args[0]['url'] == url


@pytest.mark.parametrize(('status', 'resolution_status'), [(403, 'ACCESS_BLOCKED'), (404, 'HTTP_ERROR')])
def test_scan_retains_lexical_features_without_an_unverified_prediction(
    client, monkeypatch, status, resolution_status,
):
    url = 'https://ordinary.example/path'
    monkeypatch.setenv('ONLINE_SCAN_ENABLED', '1')
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda *_a, **_kw: dns_response('93.184.216.34'))
    monkeypatch.setattr(scanner, 'pinned_head', Mock(return_value=(status, None)))
    get = Mock(side_effect=AssertionError('This HTTP status is terminal'))
    monkeypatch.setattr(scanner, 'pinned_get', get)
    predict = Mock(side_effect=AssertionError('The unresolved check must not predict'))
    monkeypatch.setattr(index.production, 'predict', predict)
    result = client.post('/api/scan', json={'url': url, 'check_redirect': True}).json()
    assert result['online']['resolution_status'] == resolution_status
    assert result['online']['http_status'] == status
    assert result['features']['url_length'] == len(url)
    assert result['prediction_target'] is None and result['prediction'] is None
    get.assert_not_called()
    predict.assert_not_called()


def test_resolver_tracks_relative_redirects_and_does_not_infer(client, monkeypatch):
    original = 'http://links.example/a/link'
    destination = 'https://links.example/final'
    monkeypatch.setenv('ONLINE_SCAN_ENABLED', '1')
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda *_a, **_kw: dns_response('93.184.216.34'))
    head = Mock(side_effect=[(301, 'https://links.example/a/link'), (307, '../final'), (200, None)])
    monkeypatch.setattr(scanner, 'pinned_head', head)
    monkeypatch.setattr(scanner, 'pinned_get', Mock(return_value=(200, None)))
    predict = Mock(side_effect=AssertionError('The resolver does not run inference'))
    monkeypatch.setattr(index.production, 'predict', predict)

    response = client.post('/api/resolve-url', json={'url': original})
    assert response.status_code == 200
    assert response.headers['Cache-Control'] == 'no-store'
    result = response.json()
    assert result['original_url'] == original and result['final_url'] == destination
    assert result['original_domain'] == result['final_domain'] == 'links.example'
    assert result['is_short_url'] is False and result['is_redirected'] is True
    assert result['redirect_count'] == 2 and result['destination_confirmed'] is True
    assert [row['url'] for row in result['redirect_chain']] == [
        original, 'https://links.example/a/link', destination, destination,
    ]
    assert [row['method'] for row in result['redirect_chain']] == ['HEAD', 'HEAD', 'HEAD', 'GET']
    assert result['resolution_status'] == 'RESOLVED' and result['http_status'] == 200
    assert result['error_code'] is None and result['error_message'] is None
    assert result['response_time_ms'] >= 0 and result['resolved_at']
    assert 'last_observed_url' in result
    predict.assert_not_called()


def test_resolver_validates_input_without_echoing_credentials_and_checks_opt_in(client, monkeypatch):
    monkeypatch.setenv('ONLINE_SCAN_ENABLED', '0')
    resolver = Mock(side_effect=AssertionError('Disabled or invalid requests must not use the resolver'))
    monkeypatch.setattr(index, 'scan_url', resolver)
    disabled = client.post('/api/resolve-url', json={'url': 'https://t.ly/token'})
    assert disabled.status_code == 200
    assert disabled.json()['resolution_status'] == 'DISABLED'
    assert disabled.json()['destination_confirmed'] is False
    assert disabled.json()['final_url'] is None
    invalid = client.post('/api/resolve-url', json={'url': 'https://example:private-secret@example.com/'})
    assert invalid.status_code == 422
    assert invalid.json()['resolution_status'] == 'INVALID_URL'
    assert 'private-secret' not in invalid.text
    resolver.assert_not_called()


def test_resolver_and_scanner_share_a_rate_limit(client, monkeypatch):
    monkeypatch.setenv('ONLINE_SCAN_ENABLED', '0')
    monkeypatch.setitem(index.RATE_LIMITS, 'url_scan', 2)
    payload = {'url': 'https://example.com/'}
    assert client.post('/api/resolve-url', json=payload).status_code == 200
    assert client.post('/api/scan', json=payload).status_code == 200
    assert client.post('/api/resolve-url', json=payload).status_code == 429
    assert client.get('/api/health').status_code == 200


def test_analyze_and_train(client, research_csv):
    assert client.post('/api/dataset/analyze', files={'file': ('research.csv', research_csv, 'text/csv')}).status_code == 200
    result = client.post('/api/train', files={'file': ('research.csv', research_csv, 'text/csv')})
    assert result.status_code == 200
    assert len(result.json()['results']) == 3
    assert index.production.model is None
    assert client.post('/api/train', files={'file': ('empty.csv', b'', 'text/csv')}).status_code == 422


@pytest.mark.parametrize('endpoint', ['train', 'experiment'])
def test_online_training_cannot_discard_declared_research_metadata(client, endpoint):
    csv = b'url,label, SPLIT_FINAL \nhttps://one.example.com,0,train\nhttps://two.example.com,1,test\n'
    files = {'file': ('synthetic.csv', csv, 'text/csv')}
    analysis = client.post('/api/dataset/analyze', files=files)
    assert analysis.status_code == 200 and analysis.json()['has_research_metadata']
    result = client.post(f'/api/{endpoint}', files=files)
    assert result.status_code == 422
    assert result.json()['detail'] == 'Research metadata requires the local audited pipeline.'


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


def test_research_features_share_lexical_extraction_without_scanning(client, monkeypatch):
    def unexpected_scan(_):
        pytest.fail("Batch features must not check a target over the network")

    monkeypatch.setenv('ONLINE_SCAN_ENABLED', '1')
    monkeypatch.setattr(index, 'scan_url', unexpected_scan)
    urls = [
        'http://www.example.com/Pa%74h/?a=%2F#part',
        'https://example.com/Path?a=%2f',
        'https://t.ly/AsIs',
        'https://t.ly/',
        'http://127.0.0.1/path',
        'https://site.example.co.id/',
        None,
        'invalid',
    ]
    response = client.post('/api/research/features', json={'urls': urls})
    assert response.status_code == 200
    assert response.headers['Cache-Control'] == 'no-store'
    batch = response.json()
    assert len(batch['feature_names']) == 19 and len(batch['basic_features']) == 7
    assert batch['schema_version'] == 'lexical-v2'
    assert ':sha256:' in batch['psl_version']
    first, second, short, homepage, ip, idn_domain, *invalid = batch['rows']
    assert first['normalized'] != second['normalized']
    assert first['related'] == second['related'] == '//example.com/Path?a=%2F'
    assert first['domain'] == second['domain'] == 'example.com'
    assert short['provider'] == 't.ly' and homepage['provider'] is None
    assert ip['domain'] == '127.0.0.1'
    assert idn_domain['domain'] == 'example.co.id'
    assert invalid == [None, None]
    single = client.post('/api/features', json={'url': urls[0]}).json()
    assert first['features'] == [single['features'][name] for name in batch['feature_names']]


def test_research_feature_batch_bounds_and_rate_scope(client, monkeypatch):
    path = '/api/research/features'
    for _ in range(index.RATE_LIMITS['default']):
        assert client.get('/api/health').status_code == 200
    assert client.get('/api/health').status_code == 429
    assert client.post(path, json={'urls': ['https://example.com/']}).status_code == 200
    assert client.post(path, json={'urls': [None] * (index.FEATURE_BATCH_ROWS + 1)}).status_code == 413
    assert client.post(path, content=b'x' * (index.FEATURE_BATCH_BYTES + 1)).status_code == 413
    assert client.post(path, json={'urls': []}).status_code == 422
    assert client.post(path, data={'urls': 'https://example.com/'}).status_code == 415
    invalid = client.post(path, content=b'{"secret":"test-private"', headers={'Content-Type': 'application/json'})
    assert invalid.status_code == 422 and 'test-private' not in invalid.text
    monkeypatch.setattr(index, 'RESEARCH_RESPONSE_BYTES', 512)
    assert client.post(path, json={'urls': ['https://example.com/']}).status_code == 413


def test_research_feature_busy_releases_capacity(client):
    path = '/api/research/features'
    payload = {'urls': ['https://example.com/']}
    for _ in range(2):
        assert index.FEATURE_BATCH_SLOTS.acquire(blocking=False)
    try:
        response = client.post(path, json=payload)
        assert response.status_code == 429
        assert response.headers['Retry-After'] == '1'
    finally:
        for _ in range(2):
            index.FEATURE_BATCH_SLOTS.release()
    assert client.post(path, json=payload).status_code == 200


def test_research_train_consumes_bounded_binary_requests(client):
    path = '/api/research/train/'
    content_type = {'Content-Type': 'application/octet-stream'}
    urls = [f'https://site-{row}.example.com/{row}' for row in range(12)]
    batch = client.post('/api/research/features', json={'urls': urls}).json()
    matrix = np.array([row['features'] for row in batch['rows']], dtype='<f4')
    labels = bytes([0, 1] * 6)
    splits = bytes([0] * 4 + [1] * 4 + [2] * 4)
    scenarios = bytes(12)
    payload = matrix.tobytes() + labels + splits + scenarios
    response = client.post(path + 'E4', content=payload, headers=content_type)
    assert response.status_code == 200
    result = response.json()
    assert result['configuration_id'] == 'E4'
    assert result['model_name'] == 'Decision Tree'
    assert result['matrix_sha256'] == hashlib.sha256(payload).hexdigest()
    assert result['train_count'] == result['validation_count'] == result['test_count'] == 4
    assert len(result['test_predictions']) == 4
    assert client.post(path + 'E7', content=payload, headers=content_type).status_code == 422
    assert client.post(path + 'E4', content=payload).status_code == 415
    assert client.post(path + 'E4', content=payload[:-1], headers=content_type).status_code == 422
    too_large = b'x' * (index.MAX_BROWSER_TRAINING_BYTES + 1)
    assert client.post(path + 'E4', content=too_large, headers=content_type).status_code == 413


def test_vercel_redirect_default_respects_explicit_opt_out(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("ONLINE_SCAN_ENABLED", raising=False)
    assert index.online_scan_enabled()
    monkeypatch.setenv("ONLINE_SCAN_ENABLED", "0")
    assert not index.online_scan_enabled()
