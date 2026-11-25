"""HTTP redirect scanner with pinned public IPs and verified TLS/SNI.

Use HEAD first, with at most one header-only GET fallback per hop.
No environment proxies, cookies, response body reads, or automatic redirects.
DNS runs in bounded worker slots.
"""
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import datetime, timezone
import errno
import ipaddress
import re
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit, urljoin, urlunsplit

from ml.features import normalize_url, registered_domain, shortener_provider, shortener_service

MAX_REDIRECTS = 10
REQUEST_TIMEOUT = 5.0
TOTAL_TIMEOUT = 18.0
MAX_HEADERS = 32768
REDIRECT_STATUSES = frozenset((301, 302, 303, 307, 308))
HEAD_FALLBACK_STATUSES = frozenset((400, 405, 501))
BLOCKED_STATUSES = frozenset((401, 403, 407, 429))
UNREACHABLE_ERRORS = frozenset((errno.ECONNREFUSED, errno.ENETUNREACH, errno.EHOSTUNREACH))
# IPv6 transition mechanisms can route to embedded IPv4 addresses.
TRANSITION_PREFIXES = tuple(map(ipaddress.IPv6Network, (
    "64:ff9b::/96", "64:ff9b:1::/48", "2001::/32", "2002::/16",
)))
DNS_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="scan-dns")
DNS_SLOTS = threading.BoundedSemaphore(4)
SCAN_SLOTS = threading.BoundedSemaphore(4)


class ScanError(ValueError):
    def __init__(self, message: str, code: str = "NETWORK_ERROR", *, http_status: int | None = None):
        super().__init__(message)
        self.code = code
        self.http_status = http_status


class UnreachableAddress(OSError):
    """The pinned address failed before any TLS or HTTP exchange."""


def public_addresses(host: str, port: int, timeout: float) -> list[str]:
    if host.lower() == "localhost" or host.lower().endswith((".localhost", ".local", ".internal", ".home", ".lan")):
        raise ScanError("Internal hostnames are blocked.", "UNSAFE_DESTINATION")
    if not DNS_SLOTS.acquire(blocking=False):
        raise ScanError("DNS capacity is busy; try again later.", "BUSY")
    def resolve():
        try:
            return socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        finally:
            DNS_SLOTS.release()
    future = DNS_POOL.submit(resolve)
    try:
        records = future.result(timeout=timeout)
    except FutureTimeout:
        raise ScanError("DNS resolution timed out.", "TIMEOUT") from None
    except OSError:
        raise ScanError("DNS resolution failed.", "DNS_ERROR") from None
    try:
        addresses = {ipaddress.ip_address(item[4][0]) for item in records}
    except ValueError:
        raise ScanError("DNS returned an invalid address.", "DNS_ERROR") from None
    if not addresses:
        raise ScanError("DNS returned no addresses.", "DNS_ERROR")
    for address in addresses:
        unsafe_ipv6 = isinstance(address, ipaddress.IPv6Address) and (
            address.scope_id is not None or address.ipv4_mapped is not None or address.is_site_local
            or any(address in network for network in TRANSITION_PREFIXES)
        )
        if not address.is_global or address.is_multicast or address.is_reserved or unsafe_ipv6:
            raise ScanError("A DNS address is not a public unicast IP; target blocked.", "UNSAFE_DESTINATION")
    # Prefer IPv4 when available. IPv6 remains supported for hosts with only IPv6.
    return [str(address) for address in sorted(addresses, key=lambda address: (address.version, int(address)))]


def remaining_time(deadline: float, reason: str = "Online check exceeded its total time budget.") -> float:
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise ScanError(reason, "TIMEOUT")
    return seconds


def _pinned_headers(url: str, ip: str, deadline: float, method: str) -> tuple[int, str | None]:
    p = urlsplit(url)
    port = p.port or (443 if p.scheme == "https" else 80)
    request_deadline = min(deadline, time.monotonic() + REQUEST_TIMEOUT)
    timed_out = "HTTP request timed out."
    timeout = remaining_time(request_deadline, timed_out)
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    # Connect to the numeric address directly: no second DNS lookup (rebinding).
    sock = socket.socket(family, socket.SOCK_STREAM)
    try:
        sock.settimeout(timeout)
        try:
            sock.connect((ip, port))
        except OSError as error:
            if error.errno in UNREACHABLE_ERRORS:
                raise UnreachableAddress from None
            raise
        if p.scheme == "https":
            sock.settimeout(remaining_time(request_deadline, timed_out))
            sock = ssl.create_default_context().wrap_socket(sock, server_hostname=p.hostname)
        target = urlunsplit(("", "", p.path or "/", p.query, ""))
        request = f"{method} {target} HTTP/1.1\r\nHost: {p.netloc}\r\nUser-Agent: UMMU-URL-Guard/0.1\r\nAccept: */*\r\nConnection: close\r\n\r\n"
        sock.settimeout(remaining_time(request_deadline, timed_out))
        sock.sendall(request.encode("ascii"))
        # Stop after the header terminator, including when GET was used.
        header = bytearray()
        while not header.endswith(b"\r\n\r\n"):
            sock.settimeout(remaining_time(request_deadline, timed_out))
            byte = sock.recv(1)
            if not byte:
                raise ScanError("Incomplete HTTP headers.", "HTTP_ERROR")
            header.extend(byte)
            if len(header) > MAX_HEADERS:
                raise ScanError("HTTP headers exceed 32 KiB.", "HTTP_ERROR")
        lines = header.decode("iso-8859-1").split("\r\n")
        first = lines[0].split(" ", 2)
        if len(first) < 2 or first[0] not in ("HTTP/1.0", "HTTP/1.1") or not re.fullmatch(r"[1-5][0-9]{2}", first[1]):
            raise ScanError("Invalid HTTP status line.", "HTTP_ERROR")
        status = int(first[1])
        if not 200 <= status <= 599:
            raise ScanError("Unsupported HTTP status (including interim responses).", "HTTP_ERROR")
        locations = []
        refresh = False
        for line in lines[1:-2]:
            if not line or line[0].isspace() or ":" not in line:
                raise ScanError("Invalid HTTP header.", "HTTP_ERROR", http_status=status)
            key, value = line.split(":", 1)
            key = key.lower()
            if key == "location":
                locations.append(value.strip())
            elif key == "refresh" and value.strip():
                refresh = True
        if len(locations) > 1:
            raise ScanError("Ambiguous redirect location.", "UNSUPPORTED_REDIRECT", http_status=status)
        if refresh and 200 <= status < 300:
            raise ScanError("HTTP Refresh is not supported.", "UNSUPPORTED_REDIRECT", http_status=status)
        return status, locations[0] if locations else None
    finally:
        sock.close()


def pinned_head(url: str, ip: str, deadline: float) -> tuple[int, str | None]:
    return _pinned_headers(url, ip, deadline, "HEAD")


def pinned_get(url: str, ip: str, deadline: float) -> tuple[int, str | None]:
    return _pinned_headers(url, ip, deadline, "GET")


def resolution_result(url: str | None, resolution_status: str, *, original_domain: str | None = None,
                      is_short_url: bool = False, error_message: str | None = None,
                      final_url: str | None = None, final_domain: str | None = None,
                      last_observed_url: str | None = None, observed_url: str | None = None,
                      redirect_count: int = 0, chain: list | None = None, response_time_ms: int = 0) -> dict:
    confirmed = resolution_status == "RESOLVED"
    complete = confirmed or resolution_status == "NO_REDIRECT"
    legacy_status = {"DISABLED": "disabled", "NOT_REQUESTED": "not_requested"}.get(
        resolution_status, "complete" if complete else "unavailable",
    )
    chain = [] if chain is None else chain
    return {
        "original_url": url, "original_domain": original_domain, "is_short_url": is_short_url,
        "final_url": final_url, "final_domain": final_domain,
        "last_observed_url": last_observed_url, "is_redirected": redirect_count > 0,
        "redirect_count": redirect_count, "redirect_chain": chain,
        "http_status": chain[-1]["status"] if chain else None,
        "resolution_status": resolution_status, "response_time_ms": response_time_ms,
        "destination_confirmed": confirmed, "error_code": None if complete else resolution_status,
        "error_message": error_message, "resolved_at": datetime.now(timezone.utc).isoformat(),
        # The scanner and its browser history still use these aliases.
        "status": legacy_status, "reason": error_message, "chain": chain,
        "observed_url": observed_url, "response_ms": response_time_ms,
    }


def _scan(value: str, normalized: str, start: float, original_domain: str, is_short_url: bool) -> dict:
    current = normalized
    deadline = start + TOTAL_TIMEOUT
    chain = []
    seen = set()
    observed_url = None
    last_observed_url = None
    redirect_count = 0

    def finish(code, reason=None, final_url=None, final_domain=None):
        return resolution_result(
            value, code, original_domain=original_domain, is_short_url=is_short_url, error_message=reason,
            final_url=final_url, final_domain=final_domain, last_observed_url=last_observed_url,
            observed_url=observed_url if final_url is None else None, redirect_count=redirect_count,
            chain=chain, response_time_ms=round((time.monotonic() - start) * 1000),
        )

    def request_headers(send, method, ip):
        remaining_time(deadline)
        try:
            status, location = send(current, ip, deadline)
        except ScanError as error:
            if error.http_status is not None:
                chain.append({"url": current, "status": error.http_status, "method": method})
            raise
        chain.append({"url": current, "status": status, "method": method})
        return status, location

    try:
        for hop in range(MAX_REDIRECTS + 1):
            observed_url = None
            p = urlsplit(current)
            default_port = 443 if p.scheme == "https" else 80
            if p.port not in (None, default_port):
                raise ScanError("Only the default HTTP/HTTPS ports are allowed.", "UNSAFE_DESTINATION")
            request_url = current.partition("#")[0]
            if request_url in seen:
                raise ScanError("Redirect loop detected.", "REDIRECT_LOOP")
            seen.add(request_url)
            addresses = public_addresses(p.hostname, default_port,
                                         min(REQUEST_TIMEOUT, remaining_time(deadline)))
            # A public Location can be reported separately if its request cannot complete.
            observed_url = current if hop else None
            last_observed_url = current
            ip = addresses[0]
            try:
                status, location = request_headers(pinned_head, "HEAD", ip)
            except UnreachableAddress:
                # Reuse this hop's fully validated DNS answers. TLS and HTTP errors stop the check.
                if len(addresses) == 1:
                    raise
                ip = addresses[1]
                status, location = request_headers(pinned_head, "HEAD", ip)
            needs_fallback = (
                (200 <= status < 300 and status not in (204, 205)) or status in HEAD_FALLBACK_STATUSES
                or (status in REDIRECT_STATUSES and not location)
            )
            if needs_fallback:
                status, location = request_headers(pinned_get, "GET", ip)
            if status in REDIRECT_STATUSES:
                if not location:
                    raise ScanError("Redirect has no Location header.", "UNSUPPORTED_REDIRECT")
                if hop == MAX_REDIRECTS:
                    raise ScanError(f"Maximum of {MAX_REDIRECTS} redirects reached.", "MAX_REDIRECT_EXCEEDED")
                try:
                    if re.search(r"[\s\x00-\x20\x7f\\]", location):
                        raise ValueError
                    current = normalize_url(urljoin(current, location))
                except ValueError:
                    raise ScanError("Redirect destination is not a valid public HTTP(S) URL.", "UNSAFE_DESTINATION") from None
                redirect_count += 1
                continue
            if status in BLOCKED_STATUSES:
                raise ScanError(f"Access denied or limited by HTTP {status}.", "ACCESS_BLOCKED")
            if 300 <= status < 400:
                raise ScanError(f"HTTP {status} does not provide a supported redirect.", "UNSUPPORTED_REDIRECT")
            if not 200 <= status < 300:
                raise ScanError(f"Server returned HTTP {status}.", "HTTP_ERROR")
            if not hop:
                return finish("NO_REDIRECT")
            if shortener_service(p.hostname):
                raise ScanError(
                    "Redirect stopped at a URL shortening service; the final destination is unconfirmed.",
                    "UNSUPPORTED_REDIRECT",
                )
            return finish("RESOLVED", final_url=current, final_domain=registered_domain(p.hostname))
    except ScanError as error:
        return finish(error.code, str(error))
    except TimeoutError:
        return finish("TIMEOUT", "HTTP request timed out.")
    except (OSError, ValueError):
        # System exceptions may contain credentials or target paths.
        return finish("NETWORK_ERROR", "Could not connect securely to the target.")


def resolve_url(value: str) -> dict:
    start = time.monotonic()
    try:
        normalized = normalize_url(value)
    except ValueError:
        return resolution_result(None, "INVALID_URL", error_message="Invalid HTTP or HTTPS URL.")
    parts = urlsplit(normalized)
    domain = registered_domain(parts.hostname)
    is_short_url = bool(shortener_provider(parts.hostname, parts.path))
    if not SCAN_SLOTS.acquire(blocking=False):
        return resolution_result(value, "BUSY", original_domain=domain, is_short_url=is_short_url,
                                 error_message="Scanner capacity is busy.")
    try:
        return _scan(value, normalized, start, domain, is_short_url)
    finally:
        SCAN_SLOTS.release()


def scan_url(value: str) -> dict:
    return resolve_url(value)
