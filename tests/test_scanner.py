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


@pytest.mark.parametrize('ip', ['127.0.0.1', '10.0.0.1', '192.168.1.2', '169.254.169.254', '0.0.0.0', '::1', 'fc00::1', '224.0.0.1', '::ffff:127.0.0.1', '100.64.0.1', '192.0.2.1'])
def test_non_public_addresses_rejected(monkeypatch, ip):
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda *a, **k: dns(ip))
    with pytest.raises(scanner.ScanError):
        scanner.public_addresses('example.com', 443, 1)


def test_all_dns_answers_are_validated(monkeypatch):
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda *a, **k: dns('93.184.216.34', '10.0.0.1'))
    with pytest.raises(scanner.ScanError):
        scanner.public_addresses('example.com', 443, 1)


def test_redirect_to_internal_network_blocked(monkeypatch):
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', lambda host, *a, **k: dns('93.184.216.34' if host == 'example.com' else '127.0.0.1'))
    head = Mock(return_value=(302, 'http://127.0.0.1/admin'))
    monkeypatch.setattr(scanner, 'pinned_head', head)
    result = scanner.scan_url('https://example.com')
    assert result['status'] == 'unavailable' and 'blocked' in result['reason']
    assert result['observed_url'] is None
    assert head.call_count == 1


@pytest.mark.parametrize('destination', ['file:///etc/passwd', 'http://user:pass@example.com', 'https://example.com:8080/private'])
def test_unsafe_redirects(monkeypatch, destination):
    monkeypatch.setattr(scanner, 'public_addresses', lambda *a: ['93.184.216.34'])
    head = Mock(return_value=(302, destination))
    monkeypatch.setattr(scanner, 'pinned_head', head)
    assert scanner.scan_url('https://example.com')['status'] == 'unavailable'
    assert head.call_count == 1


def test_redirect_limit(monkeypatch):
    monkeypatch.setattr(scanner, 'public_addresses', lambda *a: ['93.184.216.34'])
    counter = iter(range(10))
    monkeypatch.setattr(scanner, 'pinned_head', lambda *a: (302, f'/redirect-{next(counter)}'))
    result = scanner.scan_url('https://example.com')
    assert result['status'] == 'unavailable' and '5 redirects' in result['reason']
    assert len(result['chain']) == 6


def test_dns_failure_and_timeout(monkeypatch):
    def fail(*a, **k): raise socket.gaierror('not found')
    monkeypatch.setattr(scanner.socket, 'getaddrinfo', fail)
    result = scanner.scan_url('https://example.com')
    assert result['reason'] == 'DNS resolution failed.'
    monkeypatch.setattr(scanner, 'public_addresses', lambda *a: ['93.184.216.34'])
    def timeout(*a): raise socket.timeout()
    monkeypatch.setattr(scanner, 'pinned_head', timeout)
    assert scanner.scan_url('https://example.com')['status'] == 'unavailable'


def test_no_get_fallback_on_other_domains(monkeypatch):
    monkeypatch.setattr(scanner, 'public_addresses', lambda *a: ['93.184.216.34'])
    head = Mock(return_value=(405, None))
    get = Mock()
    monkeypatch.setattr(scanner, 'pinned_head', head)
    monkeypatch.setattr(scanner, 'pinned_get', get)
    result = scanner.scan_url('https://example.com')
    assert result['status'] == 'unavailable' and 'HEAD' in result['reason']
    assert head.call_count == 1
    get.assert_not_called()


@pytest.mark.parametrize('head_status', [200, 302, 403, 405, 501])
def test_header_only_get_reuses_a_shorteners_pin_and_destination_uses_head(monkeypatch, head_status):
    initial = 'https://user123.psce.pw/token'
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
        {'url': initial, 'status': 302, 'method': 'GET'},
        {'url': destination, 'status': 200, 'method': 'HEAD'},
    ]
    assert [args.args[0] for args in dns.call_args_list] == ['user123.psce.pw', 'example.com']
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
