"""Deterministic lexical features. No network calls or label-derived references."""
from collections import Counter
from functools import lru_cache
import hashlib
from importlib.resources import files
import ipaddress
import math
import re
from urllib.parse import urlsplit, urlunsplit, quote

import idna
import tldextract

SCHEMA_VERSION = "lexical-v2"
MAX_URL_LENGTH = 4096
MAX_RESEARCH_URL_LENGTH = 16_384
# Freeze the catalogs before a run. Change their versions and the schema when editing them.
REFERENCE_VERSION = "brand-references-v1"
REFERENCES = ("google.com", "microsoft.com", "apple.com", "amazon.com", "paypal.com", "facebook.com")
SHORTENER_VERSION = "shortener-catalog-v1"
# Each entry specifies whether child hostnames belong to the service.
SHORTENER_HOSTS = (
    ("bit.ly", False),
    ("cutt.ly", False),
    ("flyn.co", False),
    ("is.gd", False),
    ("l.ead.me", False),
    ("ln.run", False),
    ("psce.pw", True),
    ("q-r.to", False),
    ("qrco.de", False),
    ("rebrand.ly", False),
    ("s.id", False),
    ("short-url.cc", False),
    ("t.co", False),
    ("t.ly", False),
    ("tinyurl.com", False),
)
SHORTENERS = frozenset(host for host, _ in SHORTENER_HOSTS)
KEYWORDS = ("login", "verify", "account", "secure", "update", "password", "signin", "banking")
EXTRACT = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None, include_psl_private_domains=True)
_PSL_HASH = hashlib.sha256(files("tldextract").joinpath(".tld_set_snapshot").read_bytes()).hexdigest()
PSL_VERSION = f"tldextract-{tldextract.__version__}:sha256:{_PSL_HASH}:private"
DEFINITIONS = {
    "url_length": "Characters in the original URL",
    "domain_length": "Characters in the ASCII hostname",
    "path_length": "Characters in the original path",
    "query_length": "Characters in the original query",
    "dot_count": "Dots in the original URL",
    "hyphen_count": "Hyphens in the original URL",
    "digit_count": "ASCII digits in the original URL",
    "special_count": "Characters in the original URL other than ASCII letters and digits",
    "subdomain_count": "Labels preceding the registered domain (offline public suffix list)",
    "keyword_count": "Occurrences of the fixed suspicious keyword list",
    "ip_address": "Hostname is an IP literal",
    "https": "HTTPS scheme indicator",
    "shortener": "Known shortener host with a nonempty path token",
    "domain_entropy": "Shannon entropy of the ASCII hostname",
    "digit_ratio": "Digit count divided by URL length",
    "special_ratio": "Special count divided by URL length",
    "typo_similarity": "Best normalized Damerau–Levenshtein similarity to fixed registered-domain references; exact matches score zero",
    "registered_length": "Characters in the registered domain",
    "suffix_length": "Characters in the public suffix",
}
FEATURE_NAMES = tuple(DEFINITIONS)
BASIC_FEATURES = ("url_length", "domain_length", "digit_count", "dot_count", "hyphen_count", "special_count", "subdomain_count")


def normalize_url(value: str, *, max_length: int = MAX_URL_LENGTH) -> str:
    if not isinstance(value, str) or not value or len(value) > max_length:
        raise ValueError(f"URL must contain 1–{max_length} characters.")
    if re.search(r"[\s\x00-\x20\x7f\\]", value):
        raise ValueError("Whitespace, control characters, and backslashes are not allowed.")
    try:
        p = urlsplit(value)
        if p.scheme.lower() not in ("http", "https") or not p.netloc or not p.hostname:
            raise ValueError("Use an absolute HTTP or HTTPS URL.")
        if p.username is not None or p.password is not None:
            raise ValueError("Credentials in URLs are not allowed.")
        host = p.hostname.rstrip(".")
        if len(host) > 253:
            raise ValueError("Hostname exceeds 253 characters.")
        try:
            ip = ipaddress.ip_address(host)
            host = f"[{ip.compressed}]" if ip.version == 6 else ip.compressed
        except ValueError:
            host = idna.encode(host, uts46=True, std3_rules=True).decode("ascii").lower()
        port = p.port
        if port == 0:
            raise ValueError("Invalid port.")
        if port and port != (443 if p.scheme.lower() == "https" else 80):
            host += f":{port}"
        # Encode Unicode paths while preserving existing percent escapes and URL separators.
        path = quote(p.path or "/", safe="/%:@!$&'()*+,;=-._~")
        query = quote(p.query, safe="/%?:@!$&'()*+,;=-._~")
        fragment = quote(p.fragment, safe="/%?:@!$&'()*+,;=-._~")
        normalized = urlunsplit((p.scheme.lower(), host, path, query, fragment))
        if len(normalized) > max_length:
            raise ValueError(f"Normalized URL exceeds {max_length} characters.")
        return normalized
    except (ValueError, idna.IDNAError) as exc:
        raise ValueError(f"Invalid URL: {exc}") from None


def registered_domain(host: str) -> str:
    parts = EXTRACT(host)
    return parts.top_domain_under_public_suffix or host


def shortener_service(host: str) -> str | None:
    if host in SHORTENERS:
        return host
    return next(
        (provider for provider, include_children in SHORTENER_HOSTS
         if include_children and host.endswith("." + provider)),
        None,
    )


def shortener_provider(host: str, path: str) -> str | None:
    return shortener_service(host) if path.strip("/") else None


def damerau_levenshtein(a: str, b: str) -> int:
    """Count inserts, deletes, substitutions and adjacent transpositions."""
    sentinel = len(a) + len(b)
    distance = [[sentinel] * (len(b) + 2) for _ in range(len(a) + 2)]
    for i in range(len(a) + 1):
        distance[i + 1][1] = i
    for j in range(len(b) + 1):
        distance[1][j + 1] = j
    last_row: dict[str, int] = {}
    for i, source in enumerate(a, 1):
        last_column = 0
        for j, target in enumerate(b, 1):
            matching_row = last_row.get(target, 0)
            matching_column = last_column
            substitution = int(source != target)
            if substitution == 0:
                last_column = j
            distance[i + 1][j + 1] = min(
                distance[i][j + 1] + 1,
                distance[i + 1][j] + 1,
                distance[i][j] + substitution,
                distance[matching_row][matching_column] + (i - matching_row) + (j - matching_column) - 1,
            )
        last_row[source] = i
    return distance[-1][-1]


def _unicode_domain(domain: str) -> str:
    try:
        return idna.decode(domain)
    except idna.IDNAError:
        return domain


@lru_cache(maxsize=8192)
def _best_reference(domain: str) -> tuple[str, float, int]:
    text = _unicode_domain(domain)
    candidates = []
    for reference in REFERENCES:
        reference_text = _unicode_domain(reference)
        distance = damerau_levenshtein(text, reference_text)
        ratio = distance / max(len(text), len(reference_text))
        candidates.append((ratio, reference, distance))
    ratio, reference, distance = min(candidates)
    return reference, 1 - ratio, distance


def typo_analysis(domain: str) -> dict:
    domain = registered_domain(domain)
    ref, similarity, distance = _best_reference(domain)
    text, reference_text = _unicode_domain(domain), _unicode_domain(ref)
    change = "multiple edits"
    if not distance:
        change = "exact match"
    elif text.replace("-", "") == reference_text:
        change = "hyphen insertion"
    elif distance == 1:
        if len(text) > len(reference_text):
            change = "insertion"
        elif len(text) < len(reference_text):
            change = "deletion"
        else:
            differences = sum(a != b for a, b in zip(text, reference_text))
            change = "transposition" if differences == 2 else "substitution"
    return {"domain": domain, "reference": ref, "similarity": similarity, "distance": distance,
            "change": change, "indicator": similarity >= 0.8 and 0 < distance <= 2}


def extract_features(value: str, *, max_length: int = MAX_RESEARCH_URL_LENGTH) -> dict:
    url = normalize_url(value, max_length=max_length)
    p = urlsplit(url)
    original = urlsplit(value)
    host = p.hostname
    parts = EXTRACT(host)
    try:
        ipaddress.ip_address(host)
        is_ip = 1
    except ValueError:
        is_ip = 0
    counts = Counter(host)
    entropy = -sum((n / len(host)) * math.log2(n / len(host)) for n in counts.values())
    digits = sum(c in "0123456789" for c in value)
    special = sum(not c.isascii() or not c.isalnum() for c in value)
    typo = typo_analysis(host)
    provider = shortener_provider(host, p.path)
    values = dict(zip(FEATURE_NAMES, (
        len(value), len(host), len(original.path), len(original.query), value.count("."), value.count("-"), digits, special,
        len(parts.subdomain.split(".")) if parts.subdomain and not is_ip else 0,
        sum(value.lower().count(k) for k in KEYWORDS), is_ip, int(p.scheme == "https"), int(provider is not None),
        entropy, digits / len(value), special / len(value),
        typo["similarity"] if typo["distance"] else 0.0, len(typo["domain"]), len(parts.suffix),
    )))
    return {"url": url, "registered_domain": typo["domain"], "features": values, "typosquatting": typo,
            "shortener_provider": provider, "shortener_service": provider or shortener_service(host),
            "schema_version": SCHEMA_VERSION,
            "reference_version": REFERENCE_VERSION, "shortener_version": SHORTENER_VERSION, "psl_version": PSL_VERSION,
            "definitions": DEFINITIONS, "feature_types": {k: "float" if isinstance(v, float) else "integer" for k, v in values.items()}}


def mask_url(value: str) -> str:
    """Keep only the origin. Paths, credentials, fragments, and queries can hold secrets."""
    try:
        p = urlsplit(normalize_url(value, max_length=MAX_RESEARCH_URL_LENGTH))
        return urlunsplit((p.scheme, p.netloc, "/…", "", ""))
    except ValueError:
        return "[invalid URL]"
