import socket
import time
from unittest.mock import Mock, call

import pytest
from ml import scanner


def dns(*addresses):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, 443)) for ip in addresses]


@pytest.mark.parametrize('host', ['localhost', 'x.localhost', 'foo.internal', 'foo.local', 'foo.lan'])
def test_internal_hostnames(host):
    with pytest.raises(scanner.ScanError):
        scanner.public_addresses(host, 80, 1)


@pytest.mark.parametrize('ip', [
    '127.0.0.1', '10.0.0.1', '192.168.1.2', '169.254.169.254', '0.0.0.0',
    '::1', 'fc00::1', '224.0.0.1', '::ffff:127.0.0.1', '100.64.0.1', '192.0.2.1',
    'fec0::1', '64:ff9b::1', '2002::1', '2606:4700::1111%eth0',
])
def test_non_public_addresses_rejected(monkeypatch, ip):
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda *a, **k: dns(ip))
    with pytest.raises(scanner.ScanError):
        scanner.public_addresses('example.com', 443, 1)


def test_all_dns_answers_are_validated(monkeypatch):
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda *a, **k: dns('93.184.216.34', '10.0.0.1'))
    with pytest.raises(scanner.ScanError):
        scanner.public_addresses('example.com', 443, 1)


def test_public_ipv4_is_preferred_after_validating_ipv6(monkeypatch):
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda *a, **k: dns('2606:4700::1111', '93.184.216.34'))
    assert scanner.public_addresses('example.com', 443, 1) == ['93.184.216.34', '2606:4700::1111']


def test_redirect_to_internal_network_blocked(monkeypatch):
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda host, *a, **k: dns('93.184.216.34' if host == 'example.com' else '127.0.0.1'))
    head = Mock(return_value=(302, 'http://127.0.0.1/admin'))
    monkeypatch.setattr(scanner, 'pinned_head', head)
    result = scanner.scan_url('https://example.com')
    assert result['status'] == 'unavailable' and 'blocked' in result['reason']
    assert result['resolution_status'] == 'UNSAFE_DESTINATION'
    assert result['observed_url'] is None
    assert result['last_observed_url'] == 'https://example.com/'
    assert result['final_url'] is None and not result['destination_confirmed']
    assert head.call_count == 1


@pytest.mark.parametrize('destination', [
    'file:///etc/passwd', 'http://user:pass@example.com', 'https://example.com:8080/private',
    '\t/landing', '//example.com/invalid path', 'javascript:void(0)',
])
def test_unsafe_redirects(monkeypatch, destination):
    monkeypatch.setattr(scanner, 'public_addresses', lambda *a: ['93.184.216.34'])
    head = Mock(return_value=(302, destination))
    monkeypatch.setattr(scanner, 'pinned_head', head)
    result = scanner.resolve_url('https://example.com')
    assert result['status'] == 'unavailable' and result['error_code'] == 'UNSAFE_DESTINATION'
    assert head.call_count == 1


def test_redirect_limit(monkeypatch):
    monkeypatch.setattr(scanner, 'public_addresses', lambda *a: ['93.184.216.34'])
    counter = iter(range(scanner.MAX_REDIRECTS + 1))
    monkeypatch.setattr(scanner, 'pinned_head', lambda *a: (302, f'/redirect-{next(counter)}'))
    result = scanner.scan_url('https://example.com')
    assert result['status'] == 'unavailable' and '10 redirects' in result['reason']
    assert result['error_code'] == 'MAX_REDIRECT_EXCEEDED'
    assert result['redirect_count'] == 10 and len(result['chain']) == 11


def test_loop_ignores_fragments(monkeypatch):
    monkeypatch.setattr(scanner, 'public_addresses', lambda *a: ['93.184.216.34'])
    head = Mock(return_value=(302, '#other-fragment'))
    monkeypatch.setattr(scanner, 'pinned_head', head)
    result = scanner.resolve_url('https://example.com/#first-fragment')
    assert result['error_code'] == 'REDIRECT_LOOP' and result['final_url'] is None
    assert result['redirect_count'] == 1
    head.assert_called_once()


def test_dns_failure_and_timeout(monkeypatch):
    def fail(*a, **k): raise socket.gaierror('not found')
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', fail)
    result = scanner.scan_url('https://example.com')
    assert result['reason'] == 'DNS resolution failed.'
    assert result['error_code'] == 'DNS_ERROR'
    monkeypatch.setattr(scanner, 'public_addresses', lambda *a: ['93.184.216.34'])
    def timeout(*a): raise socket.timeout()
    monkeypatch.setattr(scanner, 'pinned_head', timeout)
    result = scanner.scan_url('https://example.com')
    assert result['status'] == 'unavailable' and result['error_code'] == 'TIMEOUT'


def test_ordinary_url_without_redirect_has_no_distinct_destination(monkeypatch):
    monkeypatch.setattr(scanner, 'public_addresses', Mock(return_value=['93.184.216.34']))
    monkeypatch.setattr(scanner, 'pinned_head', Mock(return_value=(200, None)))
    get = Mock(return_value=(200, None))
    monkeypatch.setattr(scanner, 'pinned_get', get)
    result = scanner.resolve_url('https://example.com/')
    assert result['resolution_status'] == 'NO_REDIRECT' and result['error_code'] is None
    assert result['original_url'] == result['last_observed_url'] == 'https://example.com/'
    assert result['original_domain'] == 'example.com' and result['final_domain'] is None
    assert not result['is_short_url'] and not result['is_redirected'] and not result['destination_confirmed']
    assert result['final_url'] is None and result['redirect_count'] == 0
    assert result['http_status'] == 200
    assert [row['method'] for row in result['redirect_chain']] == ['HEAD', 'GET']
    get.assert_called_once()


@pytest.mark.parametrize(('status', 'code'), [
    (401, 'ACCESS_BLOCKED'), (403, 'ACCESS_BLOCKED'), (429, 'ACCESS_BLOCKED'),
    (404, 'HTTP_ERROR'), (410, 'HTTP_ERROR'), (503, 'HTTP_ERROR'), (300, 'UNSUPPORTED_REDIRECT'),
])
def test_terminal_errors_report_the_actual_http_status_without_get(monkeypatch, status, code):
    monkeypatch.setattr(scanner, 'public_addresses', Mock(return_value=['93.184.216.34']))
    monkeypatch.setattr(scanner, 'pinned_head', Mock(return_value=(status, None)))
    get = Mock()
    monkeypatch.setattr(scanner, 'pinned_get', get)
    result = scanner.resolve_url('https://t.ly/token')
    assert result['resolution_status'] == result['error_code'] == code
    assert result['http_status'] == status and result['error_message']
    assert result['is_short_url'] and result['final_url'] is None and not result['destination_confirmed']
    get.assert_not_called()


def test_resolves_unlisted_host_relative_redirect_and_http_upgrade(monkeypatch):
    dns = Mock(return_value=['93.184.216.34'])
    head = Mock(side_effect=[(301, 'https://short.example/r'), (307, '/middle'), (308, '//target.example/landing'), (204, None)])
    get = Mock()
    monkeypatch.setattr(scanner, 'public_addresses', dns)
    monkeypatch.setattr(scanner, 'pinned_head', head)
    monkeypatch.setattr(scanner, 'pinned_get', get)
    result = scanner.resolve_url('http://short.example/r')
    assert result['resolution_status'] == 'RESOLVED'
    assert result['final_url'] == result['last_observed_url'] == 'https://target.example/landing'
    assert result['original_domain'] == 'short.example' and result['final_domain'] == 'target.example'
    assert not result['is_short_url'] and result['is_redirected'] and result['destination_confirmed']
    assert result['redirect_count'] == 3 and result['http_status'] == 204
    assert result['resolved_at'].endswith('+00:00') and result['response_time_ms'] >= 0
    assert [(item['url'], item['status']) for item in result['redirect_chain']] == [
        ('http://short.example/r', 301), ('https://short.example/r', 307),
        ('https://short.example/middle', 308), ('https://target.example/landing', 204),
    ]
    assert [entry.args[:2] for entry in dns.call_args_list] == [
        ('short.example', 80), ('short.example', 443), ('short.example', 443), ('target.example', 443),
    ]
    get.assert_not_called()


@pytest.mark.parametrize('head_status', [200, 302, 400, 405, 501])
def test_header_only_get_reuses_an_unlisted_shorteners_pin_and_destination_uses_head(monkeypatch, head_status):
    initial = 'https://short.example/token'
    destination = 'https://example.com/landing'
    dns = Mock(side_effect=[['93.184.216.34'], ['93.184.216.35']])
    head = Mock(side_effect=[(head_status, None), (200, None)])
    get = Mock(return_value=(302, destination))
    monkeypatch.setattr(scanner, 'public_addresses', dns)
    monkeypatch.setattr(scanner, 'pinned_head', head)
    monkeypatch.setattr(scanner, 'pinned_get', get)

    result = scanner.scan_url(initial)

    assert result['status'] == 'complete' and result['final_url'] == destination
    assert result['redirect_count'] == 1
    assert result['chain'] == [
        {'url': initial, 'status': head_status, 'method': 'HEAD'},
        {'url': initial, 'status': 302, 'method': 'GET'},
        {'url': destination, 'status': 200, 'method': 'HEAD'},
    ]
    assert [args.args[0] for args in dns.call_args_list] == ['short.example', 'example.com']
    deadline = head.call_args_list[0].args[2]
    get.assert_called_once_with(initial, '93.184.216.34', deadline)
    assert head.call_args_list == [call(initial, '93.184.216.34', deadline), call(destination, '93.184.216.35', deadline)]


def test_get_fallback_used_at_most_once(monkeypatch):
    initial, destination = 'https://bit.ly/token', 'https://t.ly/next'
    monkeypatch.setattr(scanner, 'public_addresses', Mock(return_value=['93.184.216.34']))
    monkeypatch.setattr(scanner, 'pinned_head', Mock(side_effect=[(405, None), (405, None)]))
    get = Mock(return_value=(302, destination))
    monkeypatch.setattr(scanner, 'pinned_get', get)

    result = scanner.scan_url(initial)

    assert result['status'] == 'unavailable' and result['final_url'] is None
    assert result['observed_url'] == destination
    assert get.call_count == 1


def test_get_fallback_cannot_follow_a_private_target(monkeypatch):
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda host, *a, **k: dns(
        '93.184.216.34' if host == 't.ly' else '10.0.0.1'
    ))
    head = Mock(return_value=(405, None))
    monkeypatch.setattr(scanner, 'pinned_head', head)
    monkeypatch.setattr(scanner, 'pinned_get', Mock(return_value=(302, 'http://10.0.0.1/')))

    result = scanner.scan_url('https://t.ly/token')

    assert result['status'] == 'unavailable' and 'blocked' in result['reason']
    assert result['observed_url'] is None
    assert head.call_count == 1


def test_same_host_redirect_revalidates_dns_and_blocks_rebinding(monkeypatch):
    lookup = Mock(side_effect=[dns('93.184.216.34'), dns('127.0.0.1')])
    head = Mock(return_value=(302, '/second'))
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lookup)
    monkeypatch.setattr(scanner, 'pinned_head', head)
    result = scanner.resolve_url('https://example.com/first')
    assert lookup.call_count == 2 and head.call_count == 1
    assert head.call_args.args[:2] == ('https://example.com/first', '93.184.216.34')
    assert result['error_code'] == 'UNSAFE_DESTINATION' and result['observed_url'] is None
    assert result['last_observed_url'] == 'https://example.com/first'


def test_invalid_url_does_not_echo_embedded_credentials(monkeypatch):
    dns = Mock()
    monkeypatch.setattr(scanner, 'public_addresses', dns)
    result = scanner.resolve_url('https://user:secret@example.com/')
    assert result['error_code'] == 'INVALID_URL' and result['original_url'] is None
    assert 'secret' not in str(result)
    dns.assert_not_called()


def test_public_location_reported_but_not_confirmed_after_timeout(monkeypatch):
    destination = 'https://example.com/landing'
    monkeypatch.setattr(scanner, 'public_addresses', Mock(return_value=['93.184.216.34']))
    monkeypatch.setattr(scanner, 'pinned_head', Mock(side_effect=[(302, destination), socket.timeout()]))
    get = Mock()
    monkeypatch.setattr(scanner, 'pinned_get', get)

    result = scanner.scan_url('https://t.ly/token')

    assert result['status'] == 'unavailable' and result['final_url'] is None
    assert result['observed_url'] == destination and result['redirect_count'] == 1
    get.assert_not_called()


def test_shortener_timeout_does_not_retry_with_get(monkeypatch):
    monkeypatch.setattr(scanner, 'public_addresses', Mock(return_value=['93.184.216.34']))
    monkeypatch.setattr(scanner, 'pinned_head', Mock(side_effect=socket.timeout))
    get = Mock()
    monkeypatch.setattr(scanner, 'pinned_get', get)
    result = scanner.scan_url('https://t.ly/token')
    assert result['status'] == 'unavailable' and result['observed_url'] is None
    get.assert_not_called()


def test_exhausted_budget_skips_dns(monkeypatch):
    monkeypatch.setattr(scanner, 'TOTAL_TIMEOUT', 0)
    dns = Mock()
    monkeypatch.setattr(scanner, 'public_addresses', dns)
    assert 'total time budget' in scanner.scan_url('https://t.ly/token')['reason']
    dns.assert_not_called()


def test_busy_is_distinct_from_failure_to_reach_a_destination(monkeypatch):
    slots = Mock()
    slots.acquire.return_value = False
    monkeypatch.setattr(scanner, 'SCAN_SLOTS', slots)
    request = Mock()
    monkeypatch.setattr(scanner, 'pinned_head', request)
    result = scanner.resolve_url('https://t.ly/token')
    assert result['resolution_status'] == result['error_code'] == 'BUSY'
    assert result['last_observed_url'] is None and not result['destination_confirmed']
    request.assert_not_called()


@pytest.mark.parametrize(('send', 'method'), [(scanner.pinned_head, b'HEAD'), (scanner.pinned_get, b'GET')])
def test_pinned_ip_host_tls_and_headers_only(monkeypatch, send, method):
    response = bytearray(b'HTTP/1.1 200 OK\r\nServer: test\r\n\r\nDO NOT DOWNLOAD THIS BODY')
    transport = Mock()
    transport.recv.side_effect = lambda n: bytes([response.pop(0)])
    monkeypatch.setattr(scanner.socket, 'socket', lambda *a: transport)
    context = Mock()
    context.wrap_socket.return_value = transport
    monkeypatch.setattr(scanner.ssl, 'create_default_context', lambda: context)
    assert send('https://example.com/check', '93.184.216.34', time.monotonic() + 5) == (200, None)
    transport.connect.assert_called_once_with(('93.184.216.34', 443))
    context.wrap_socket.assert_called_once_with(transport, server_hostname='example.com')
    request = transport.sendall.call_args.args[0]
    assert request.startswith(method + b' /check HTTP/1.1') and b'Host: example.com' in request
    assert b'Cookie:' not in request and b'Authorization:' not in request
    assert response == b'DO NOT DOWNLOAD THIS BODY'
    transport.close.assert_called_once()


def test_header_limit(monkeypatch):
    transport = Mock()
    transport.recv.return_value = b'x'
    monkeypatch.setattr(scanner.socket, 'socket', lambda *a: transport)
    with pytest.raises(scanner.ScanError, match='32 KiB'):
        scanner.pinned_head('http://example.com/', '93.184.216.34', time.monotonic() + 5)


def test_refresh_header_is_reported_without_following_or_reading_body(monkeypatch):
    response = bytearray(b'HTTP/1.1 200 OK\r\nRefresh: 0; url=/second\r\n\r\nPage body')
    transport = Mock()
    transport.recv.side_effect = lambda n: bytes([response.pop(0)])
    monkeypatch.setattr(scanner.socket, 'socket', lambda *a: transport)
    monkeypatch.setattr(scanner, 'public_addresses', Mock(return_value=['93.184.216.34']))
    result = scanner.resolve_url('http://example.com/')
    assert result['resolution_status'] == 'UNSUPPORTED_REDIRECT' and result['http_status'] == 200
    assert result['final_url'] is None and not result['destination_confirmed']
    assert result['redirect_chain'] == [{'url': 'http://example.com/', 'status': 200, 'method': 'HEAD'}]
    assert response == b'Page body'
    transport.close.assert_called_once()
