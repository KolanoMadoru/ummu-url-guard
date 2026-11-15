"""Deterministic lexical features. No network calls or label-derived references."""
from collections import Counter
import ipaddress
import math
import re
from urllib.parse import urlsplit, urlunsplit, quote

import idna
import tldextract

SCHEMA_VERSION = "lexical-v1"
MAX_URL_LENGTH = 4096
# Freeze this list before an experiment; never derive references from held-out labels.
REFERENCES = ("google.com", "microsoft.com", "apple.com", "amazon.com", "paypal.com", "facebook.com")
SHORTENERS = frozenset(("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly"))
KEYWORDS = ("login", "verify", "account", "secure", "update", "password", "signin", "banking")
EXTRACT = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None, include_psl_private_domains=True)
DEFINITIONS = {
    "url_length": "Characters in the normalized URL",
    "domain_length": "Characters in the ASCII hostname",
    "path_length": "Characters in the path",
    "query_length": "Characters in the query",
    "dot_count": "Dots in the normalized URL",
    "hyphen_count": "Hyphens in the normalized URL",
    "digit_count": "ASCII digits in the normalized URL",
    "special_count": "Characters other than ASCII letters and digits",
    "subdomain_count": "Labels preceding the registered domain (offline public suffix list)",
    "keyword_count": "Occurrences of the fixed suspicious keyword list",
    "ip_address": "Hostname is an IP literal",
    "https": "HTTPS scheme indicator",
    "shortener": "Exact known shortener hostname indicator",
    "domain_entropy": "Shannon entropy of the ASCII hostname",
    "digit_ratio": "Digit count divided by URL length",
    "special_ratio": "Special count divided by URL length",
    "typo_similarity": "Best normalized edit similarity to fixed registered-domain references; exact matches score zero",
    "registered_length": "Characters in the registered domain",
    "suffix_length": "Characters in the public suffix",
}
FEATURE_NAMES = tuple(DEFINITIONS)
BASIC_FEATURES = ("url_length", "domain_length", "digit_count", "dot_count", "hyphen_count", "special_count", "subdomain_count")


def normalize_url(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > MAX_URL_LENGTH:
        raise ValueError("URL must contain 1–4096 characters.")
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
        if len(normalized) > MAX_URL_LENGTH:
            raise ValueError("Normalized URL exceeds 4096 characters.")
        return normalized
    except (ValueError, idna.IDNAError) as exc:
        raise ValueError(f"Invalid URL: {exc}") from None


def registered_domain(host: str) -> str:
    parts = EXTRACT(host)
    return parts.top_domain_under_public_suffix or host


def levenshtein(a: str, b: str) -> int:
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        next_row = [i]
        for j, cb in enumerate(b, 1):
            next_row.append(min(next_row[-1] + 1, row[j] + 1, row[j - 1] + (ca != cb)))
        row = next_row
    return row[-1]


def typo_analysis(domain: str) -> dict:
    domain = registered_domain(domain)
    if domain in REFERENCES:
        return {"domain": domain, "reference": domain, "similarity": 1.0, "distance": 0, "change": "exact match", "indicator": False}
    ref = min(REFERENCES, key=lambda x: (levenshtein(domain, x) / max(len(domain), len(x)), x))
    distance = levenshtein(domain, ref)
    similarity = 1 - distance / max(len(domain), len(ref))
    change = "multiple edits"
    if domain.replace("-", "") == ref:
        change = "hyphen insertion"
    elif distance == 1:
        change = "insertion" if len(domain) > len(ref) else "deletion" if len(domain) < len(ref) else "substitution"
    elif len(domain) == len(ref):
        diffs = [i for i, (a, b) in enumerate(zip(domain, ref)) if a != b]
        if len(diffs) == 2 and diffs[1] == diffs[0] + 1 and domain[diffs[0]] == ref[diffs[1]] and domain[diffs[1]] == ref[diffs[0]]:
            change = "transposition"
    return {"domain": domain, "reference": ref, "similarity": similarity, "distance": distance, "change": change, "indicator": similarity >= 0.8 and distance <= 2}


def extract_features(value: str) -> dict:
    url = normalize_url(value)
    p = urlsplit(url)
    host = p.hostname
    parts = EXTRACT(host)
    try:
        ipaddress.ip_address(host)
        is_ip = 1
    except ValueError:
        is_ip = 0
    counts = Counter(host)
    entropy = -sum((n / len(host)) * math.log2(n / len(host)) for n in counts.values())
    digits = sum(c in "0123456789" for c in url)
    special = sum(not c.isascii() or not c.isalnum() for c in url)
    typo = typo_analysis(host)
    values = dict(zip(FEATURE_NAMES, (
        len(url), len(host), len(p.path), len(p.query), url.count("."), url.count("-"), digits, special,
        len(parts.subdomain.split(".")) if parts.subdomain and not is_ip else 0,
        sum(url.lower().count(k) for k in KEYWORDS), is_ip, int(p.scheme == "https"), int(host in SHORTENERS),
        entropy, digits / len(url), special / len(url),
        typo["similarity"] if typo["distance"] else 0, len(registered_domain(host)), len(parts.suffix),
    )))
    return {"url": url, "registered_domain": registered_domain(host), "features": values, "typosquatting": typo,
            "shortener_provider": host if host in SHORTENERS else None, "schema_version": SCHEMA_VERSION,
            "definitions": DEFINITIONS, "feature_types": {k: "float" if isinstance(v, float) else "integer" for k, v in values.items()}}


def mask_url(value: str) -> str:
    """Keep only the origin. Paths, credentials, fragments, and queries can hold secrets."""
    try:
        p = urlsplit(normalize_url(value))
        return urlunsplit((p.scheme, p.netloc, "/…", "", ""))
    except ValueError:
        return "[invalid URL]"
