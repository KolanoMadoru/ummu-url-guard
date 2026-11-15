import pytest
from ml.features import normalize_url, extract_features, FEATURE_NAMES, mask_url, typo_analysis


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
    assert a == extract_features(a['url'])
    assert a['features']['subdomain_count'] == 1
    assert a['features']['digit_count'] == 3
    assert a['features']['keyword_count'] == 1
    assert a['features']['https'] == 1
    assert a['registered_domain'] == 'example.com'


def test_shortener_and_ip_literal():
    assert extract_features('https://bit.ly/abc')['shortener_provider'] == 'bit.ly'
    assert extract_features('https://notbit.ly/abc')['shortener_provider'] is None
    assert extract_features('http://127.0.0.1/a')['features']['ip_address'] == 1
    assert extract_features('http://[::1]/a')['features']['ip_address'] == 1


@pytest.mark.parametrize(('domain', 'change'), [('gooogle.com', 'insertion'), ('gogle.com', 'deletion'), ('goagle.com', 'substitution'), ('googel.com', 'transposition'), ('goo-gle.com', 'hyphen insertion')])
def test_typo_edits(domain, change):
    result = typo_analysis(domain)
    assert result['reference'] == 'google.com'
    assert result['indicator']
    assert result['change'] == change
    assert not typo_analysis('google.com')['indicator']


def test_masking_removes_all_sensitive_parts():
    assert mask_url('https://example.com/password/token?access_token=secret#private') == 'https://example.com/…'
