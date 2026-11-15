import pytest
from ml.dataset import read_dataset


@pytest.fixture
def research_csv():
    # Synthetic test fixture only. Never shipped as research data or a production model.
    rows = ['url,label']
    for i in range(100):
        label = 'phishing' if i % 4 == 0 else 'benign'
        path = '/login/verify123' if label == 'phishing' else '/about'
        rows.append(f'https://group{i}.com{path},{label}')
        rows.append(f'https://www.group{i}.com{path}/variant,{label}')
    return ('\n'.join(rows)).encode()


@pytest.fixture
def dataset(research_csv):
    return read_dataset(research_csv)
