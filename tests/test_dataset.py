import pytest
from ml.dataset import read_dataset, MAX_ROWS


@pytest.mark.parametrize('data', [b'', b'url,label\n', b'wrong,label\na,benign', b'url,label\nhttps://example.com,unknown', b'url,label\n,benign', b'url,label\nhttps://example.com,benign\nhttps://example.com,phishing', b'url,label\nhttps://example.com,\xff'])
def test_rejects_invalid_datasets(data):
    with pytest.raises(ValueError):
        read_dataset(data)


def test_duplicates_and_label_normalization():
    df, summary = read_dataset(b'url,label\nhttps://EXAMPLE.com,0\nhttps://example.com/,benign\nhttps://second.com,1')
    assert len(df) == 2
    assert summary['duplicate_records'] == 1
    assert summary['class_distribution'] == {'benign': 1, 'phishing': 1}
    assert summary['preview'][0]['url'] == 'https://example.com/…'


def test_limits():
    with pytest.raises(ValueError, match='2 MiB'):
        read_dataset(b'a' * (2 * 1024 * 1024 + 1))
    with pytest.raises(ValueError, match='rows'):
        read_dataset(('url,label\n' + '\n'.join(f'https://site{i}.com,benign' for i in range(MAX_ROWS + 1))).encode())
