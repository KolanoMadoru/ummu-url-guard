import socket
import time
from unittest.mock import Mock

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


def test_no_get_fallback(monkeypatch):
    monkeypatch.setattr(scanner, 'public_addresses', lambda *a: ['93.184.216.34'])
    head = Mock(return_value=(405, None))
    monkeypatch.setattr(scanner, 'pinned_head', head)
    result = scanner.scan_url('https://example.com')
    assert result['status'] == 'unavailable' and 'HEAD' in result['reason']
    assert head.call_count == 1


def test_pinned_ip_host_tls_and_headers_only(monkeypatch):
    response = bytearray(b'HTTP/1.1 200 OK\r\nServer: test\r\n\r\nDO NOT DOWNLOAD THIS BODY')
    transport = Mock()
    transport.recv.side_effect = lambda n: bytes([response.pop(0)])
    monkeypatch.setattr(scanner.socket, 'socket', lambda *a: transport)
    context = Mock()
    context.wrap_socket.return_value = transport
    monkeypatch.setattr(scanner.ssl, 'create_default_context', lambda: context)
    assert scanner.pinned_head('https://example.com/check', '93.184.216.34', time.monotonic() + 5) == (200, None)
    transport.connect.assert_called_once_with(('93.184.216.34', 443))
    context.wrap_socket.assert_called_once_with(transport, server_hostname='example.com')
    request = transport.sendall.call_args.args[0]
    assert request.startswith(b'HEAD /check HTTP/1.1') and b'Host: example.com' in request
    assert b'Cookie:' not in request and b'Authorization:' not in request
    assert response == b'DO NOT DOWNLOAD THIS BODY'


def test_header_limit(monkeypatch):
    transport = Mock()
    transport.recv.return_value = b'x'
    monkeypatch.setattr(scanner.socket, 'socket', lambda *a: transport)
    with pytest.raises(scanner.ScanError, match='32 KiB'):
        scanner.pinned_head('http://example.com/', '93.184.216.34', time.monotonic() + 5)
