import pytest
from ml.features import (
    BASIC_FEATURES, FEATURE_NAMES, MAX_RESEARCH_URL_LENGTH, PSL_VERSION,
    REFERENCE_VERSION, SHORTENER_VERSION, damerau_levenshtein, extract_features,
    mask_url, normalize_url, typo_analysis,
)


@pytest.mark.parametrize('value', ['example.com', 'javascript:alert(1)', 'ftp://example.com', 'https://user:pass@example.com', 'https://', 'https://exa mple.com', 'https://example.com\\@localhost', 'https://example.com:0', 'https://example.com\r\nX-Foo:a', 'https://%31%32%37.0.0.1'])
def test_invalid_urls(value):
    with pytest.raises(ValueError):
        normalize_url(value)


def test_unicode_normalization():
    assert normalize_url('https://BÜCHER.de/über') == 'https://xn--bcher-kva.de/%C3%BCber'
    assert normalize_url('HTTPS://Example.COM.:443') == 'https://example.com/'


def test_exact_feature_order_and_determinism():
    a = extract_features('https://sub.example.com/a-12?verify=3')
    assert tuple(a['features']) == FEATURE_NAMES
    assert len(FEATURE_NAMES) == 19 and len(BASIC_FEATURES) == 7
    assert set(BASIC_FEATURES) <= set(FEATURE_NAMES)
    assert a == extract_features(a['url'])
    assert a['features']['subdomain_count'] == 1
    assert a['features']['digit_count'] == 3
    assert a['features']['keyword_count'] == 1
    assert a['features']['https'] == 1
    assert a['registered_domain'] == 'example.com'


def test_original_lexical_values_are_separate_from_normalized_url():
    original = 'HTTPS://BÜCHER.de:443/über,ok?q=%2F#É'
    result = extract_features(original)
    features = result['features']
    assert result['url'] == 'https://xn--bcher-kva.de/%C3%BCber,ok?q=%2F#%C3%89'
    assert features['url_length'] == len(original)
    assert features['domain_length'] == len('xn--bcher-kva.de')
    assert features['path_length'] == len('/über,ok')
    assert features['query_length'] == len('q=%2F')
    assert features['digit_count'] == 4
    assert result['reference_version'] == REFERENCE_VERSION
    assert result['shortener_version'] == SHORTENER_VERSION
    assert result['psl_version'] == PSL_VERSION
    assert ':sha256:' in PSL_VERSION


def test_research_feature_extraction_accepts_long_urls_within_its_budget():
    url = 'https://example.com/' + 'a' * 8000
    assert extract_features(url)['features']['url_length'] == len(url)
    with pytest.raises(ValueError, match='4096'):
        normalize_url(url)
    with pytest.raises(ValueError, match=str(MAX_RESEARCH_URL_LENGTH)):
        extract_features(url + 'a' * MAX_RESEARCH_URL_LENGTH)


def test_shortener_and_ip_literal():
    assert extract_features('https://bit.ly/abc')['shortener_provider'] == 'bit.ly'
    assert extract_features('https://notbit.ly/abc')['shortener_provider'] is None
    assert extract_features('http://127.0.0.1/a')['features']['ip_address'] == 1
    assert extract_features('http://[::1]/a')['features']['ip_address'] == 1


@pytest.mark.parametrize(('host', 'provider'), [
    ('t.ly', 't.ly'), ('flyn.co', 'flyn.co'), ('short-url.cc', 'short-url.cc'),
    ('qrco.de', 'qrco.de'), ('l.ead.me', 'l.ead.me'), ('q-r.to', 'q-r.to'),
    ('ln.run', 'ln.run'), ('s.id', 's.id'), ('rebrand.ly', 'rebrand.ly'),
    ('preview.psce.pw', 'psce.pw'), ('notpsce.pw', None),
    ('psce.pw.example.com', None), ('cdn.bit.ly', None),
])
def test_shortener_catalog_host_boundaries_and_token(host, provider):
    result = extract_features(f'https://{host}/aB%2Fc?source=synthetic')
    assert result['shortener_provider'] == provider
    assert result['features']['shortener'] == int(provider is not None)
    assert result['url'].endswith('/aB%2Fc?source=synthetic')
    homepage = extract_features(f'https://{host}/?source=synthetic')
    assert homepage['shortener_service'] == provider
    assert homepage['shortener_provider'] is None
    assert homepage['features']['shortener'] == 0


@pytest.mark.parametrize(('domain', 'change'), [('gooogle.com', 'insertion'), ('gogle.com', 'deletion'), ('goagle.com', 'substitution'), ('googel.com', 'transposition'), ('goo-gle.com', 'hyphen insertion')])
def test_typo_edits(domain, change):
    result = typo_analysis(domain)
    assert result['reference'] == 'google.com'
    assert result['indicator']
    assert result['distance'] == 1
    assert result['change'] == change
    assert not typo_analysis('google.com')['indicator']


def test_damerau_levenshtein_handles_edits_after_transposition_and_idna():
    assert damerau_levenshtein('CA', 'ABC') == 2
    assert damerau_levenshtein('ABC', 'CA') == 2
    assert damerau_levenshtein('', 'ABC') == 3
    domain = extract_features('https://góogle.com/')['typosquatting']
    assert domain['distance'] == 1 and domain['change'] == 'substitution'
    assert domain['reference'] == 'google.com'


def test_masking_removes_all_sensitive_parts():
    assert mask_url('https://example.com/password/token?access_token=secret#private') == 'https://example.com/…'
