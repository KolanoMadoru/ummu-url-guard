"""HEAD-only HTTP/1.1 scanner with pinned public IPs and verified TLS/SNI.

No environment proxies, cookies, body downloads, or automatic redirects. DNS runs in
bounded worker slots so a resolver stall cannot exhaust an unlimited thread pool.
"""
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from contextlib import closing
import ipaddress
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit, urljoin, urlunsplit

from ml.features import normalize_url, registered_domain

MAX_REDIRECTS = 5
REQUEST_TIMEOUT = 5.0
TOTAL_TIMEOUT = 12.0
MAX_HEADERS = 32768
DNS_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="scan-dns")
DNS_SLOTS = threading.BoundedSemaphore(4)
SCAN_SLOTS = threading.BoundedSemaphore(4)


class ScanError(ValueError):
    pass


def public_addresses(host: str, port: int, timeout: float) -> list[str]:
    if host.lower() == "localhost" or host.lower().endswith((".localhost", ".local", ".internal", ".home", ".lan")):
        raise ScanError("Internal hostnames are blocked.")
    if not DNS_SLOTS.acquire(blocking=False):
        raise ScanError("DNS capacity is busy; try again later.")
    def resolve():
        try:
            return socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        finally:
            DNS_SLOTS.release()
    future = DNS_POOL.submit(resolve)
    try:
        records = future.result(timeout=max(0.01, timeout))
    except FutureTimeout:
        raise ScanError("DNS resolution timed out.") from None
    except OSError:
        raise ScanError("DNS resolution failed.") from None
    addresses = sorted({item[4][0] for item in records})
    if not addresses:
        raise ScanError("DNS returned no addresses.")
    for value in addresses:
        address = ipaddress.ip_address(value)
        if not address.is_global or address.is_multicast or address.is_reserved or getattr(address, "ipv4_mapped", None) or address.is_unspecified:
            raise ScanError("A DNS address is not a public unicast IP; target blocked.")
    return addresses


def pinned_head(url: str, ip: str, deadline: float) -> tuple[int, str | None]:
    p = urlsplit(url)
    port = p.port or (443 if p.scheme == "https" else 80)
    timeout = min(REQUEST_TIMEOUT, deadline - time.monotonic())
    if timeout <= 0:
        raise ScanError("Online check exceeded its total time budget.")
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    # Connect to the numeric address directly: no second DNS lookup (rebinding).
    sock = socket.socket(family, socket.SOCK_STREAM)
    request_deadline = min(deadline, time.monotonic() + REQUEST_TIMEOUT)
    try:
        sock.settimeout(timeout)
        sock.connect((ip, port))
        if p.scheme == "https":
            sock.settimeout(max(0.001, request_deadline - time.monotonic()))
            sock = ssl.create_default_context().wrap_socket(sock, server_hostname=p.hostname)
        with closing(sock):
            target = urlunsplit(("", "", p.path or "/", p.query, ""))
            request = f"HEAD {target} HTTP/1.1\r\nHost: {p.netloc}\r\nUser-Agent: UMMU-URL-Guard/0.1\r\nAccept: */*\r\nConnection: close\r\n\r\n"
            sock.settimeout(max(0.001, request_deadline - time.monotonic()))
            sock.sendall(request.encode("ascii"))
            # Read only headers, byte by byte, to avoid consuming even a partial body.
            header = bytearray()
            while not header.endswith(b"\r\n\r\n"):
                remaining = request_deadline - time.monotonic()
                if remaining <= 0:
                    raise ScanError("HTTP request timed out.")
                sock.settimeout(remaining)
                byte = sock.recv(1)
                if not byte:
                    raise ScanError("Incomplete HTTP headers.")
                header.extend(byte)
                if len(header) > MAX_HEADERS:
                    raise ScanError("HTTP headers exceed 32 KiB.")
            lines = header.decode("iso-8859-1").split("\r\n")
            first = lines[0].split(" ", 2)
            if len(first) < 2 or first[0] not in ("HTTP/1.0", "HTTP/1.1") or not first[1].isdigit():
                raise ScanError("Invalid HTTP status line.")
            status = int(first[1])
            if not 200 <= status <= 599:
                raise ScanError("Unsupported HTTP status (including interim responses).")
            locations = []
            for line in lines[1:-2]:
                if not line or line[0].isspace() or ":" not in line:
                    raise ScanError("Invalid HTTP header.")
                key, value = line.split(":", 1)
                if key.lower() == "location":
                    locations.append(value.strip())
            if len(locations) > 1:
                raise ScanError("Ambiguous redirect location.")
            return status, locations[0] if locations else None
    finally:
        sock.close()


def _scan(value: str) -> dict:
    current = normalize_url(value)
    start = time.monotonic()
    deadline = start + TOTAL_TIMEOUT
    chain = []
    seen = set()
    try:
        for hop in range(MAX_REDIRECTS + 1):
            p = urlsplit(current)
            if p.port not in (None, 80 if p.scheme == "http" else 443):
                raise ScanError("Only the default HTTP/HTTPS ports are allowed.")
            if current in seen:
                raise ScanError("Redirect loop detected.")
            seen.add(current)
            addresses = public_addresses(p.hostname, p.port or (443 if p.scheme == "https" else 80), min(REQUEST_TIMEOUT, deadline - time.monotonic()))
            status, location = pinned_head(current, addresses[0], deadline)
            chain.append({"url": current, "status": status})
            if status in (405, 501):
                raise ScanError("Server does not support HEAD; no body fallback was attempted.")
            if status in (301, 302, 303, 307, 308):
                if not location:
                    raise ScanError("Redirect has no Location header.")
                if hop == MAX_REDIRECTS:
                    raise ScanError("Maximum of 5 redirects reached.")
                current = normalize_url(urljoin(current, location))
                continue
            return {"status": "complete", "reason": None, "final_url": current, "final_domain": registered_domain(p.hostname),
                    "http_status": status, "redirect_count": max(0, len(chain) - 1), "chain": chain,
                    "response_ms": round((time.monotonic() - start) * 1000)}
    except (ValueError, OSError, ssl.SSLError) as exc:
        # Avoid reflecting request paths or system exception strings containing secrets.
        reason = str(exc) if isinstance(exc, ScanError) else "Connection failed, timed out, or target URL is invalid; safe online check unavailable."
        return {"status": "unavailable", "reason": reason, "final_url": None, "http_status": chain[-1]["status"] if chain else None,
                "redirect_count": max(0, len(chain) - 1), "chain": chain, "response_ms": round((time.monotonic() - start) * 1000)}


def scan_url(value: str) -> dict:
    if not SCAN_SLOTS.acquire(blocking=False):
        return {"status": "unavailable", "reason": "Scanner capacity is busy.", "final_url": None, "http_status": None, "redirect_count": 0, "chain": []}
    try:
        return _scan(value)
    finally:
        SCAN_SLOTS.release()
