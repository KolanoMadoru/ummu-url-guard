# UMMU URL GUARD

Phishing URL Detection & Typosquatting Analysis — a Vite/vanilla JavaScript research workspace with a Python 3.12 FastAPI backend, scikit-learn models, and browser-local history.

## What works

- Nine responsive pages: dashboard, scanner, datasets, features, training, evaluation, feature experiments, analysis, and history.
- Deterministic Python lexical extraction, offline public-suffix parsing, known-shortener recognition, and registered-domain edit similarity against an explicit, fixed reference list.
- HEAD-only online metadata checks with public-address validation, pinned numeric connections, verified TLS/SNI, per-redirect validation, bounded headers, timeouts and concurrency. No page execution, body downloads or GET fallback.
- CSV validation, masked previews, deduplication and conflicting-label rejection.
- Real Random Forest, scaled Logistic Regression and Decision Tree training, validation-only selection, held-out metrics, curves, confusion matrices, feature importance and masked error analysis.
- A local research pipeline for audited master files and predefined splits, with six experiments, scenario-level evaluation, and JSON/CSV exports.
- Bounded, masked localStorage history with search, filter, individual deletion and exports; compact experiment metric summaries.

**No production model or research dataset is bundled.** Predictions correctly remain unavailable until you train and deploy a trusted artifact. Synthetic fixtures in tests verify software behavior only; their scores are not research findings. Shorteners, look-alike domains and benign predictions never establish website safety.

## Local development

Prerequisites: Python 3.12 and Node.js 24.x (matching Vercel and CI).

```sh
npm ci
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
python -m uvicorn api.index:app --host 127.0.0.1 --port 8000 --no-access-log
```

In a second terminal, run `npm run dev`. Vite proxies `/api` to Python on port 8000. Open the address printed by Vite. `/api/health` reports API and deployed-model availability; `/api/docs` documents the endpoints. On cloud machines with a read-only home directory, use `npm ci --cache /workspace/.npm-cache`.

No database, API key, cloud storage, or environment variables are required. Optional configuration is documented in `.env.example`. Export variables in the shell or configure them in your hosting provider. Exact CORS origins are opt-in through `ALLOWED_ORIGINS`. The scanner uses lexical analysis by default. Set `ONLINE_SCAN_ENABLED=1` only for deployments where optional outbound HEAD checks are needed.

The current cloud machine can run the app and experiments but does not resolve arbitrary outbound scanner targets. It returns an honest online-check-unavailable result while retaining lexical analysis. This does not establish live-network scanning readiness on a deployed host.

## Dataset and training

Bring a UTF-8 CSV containing `url,label`. Labels are `phishing` / `benign` or `1` / `0`. Verify provenance, collection dates, label quality, consent and licensing yourself; do not use real credentials in URLs.

Online **training** limits (separate from browser validation): 2 MiB, 1,000 source rows, at least 30 unique normalized URLs, at least 10 registered-domain groups, and at least 6 rows per label. Both classes must be present in all three partitions. Missing cells, invalid URLs, invalid labels and identical-URL label conflicts reject the upload with a useful error. Identical normalized duplicates with consistent labels are removed. Data is held only for the request, not persisted on Vercel or in browser storage.

### Browser validation up to 25 MiB

Dataset Management validates CSV locally using a module Web Worker, Papa Parse's incremental parser, strict streaming UTF-8 decoding and incremental SHA-256. It does not call `file.text()` or load the complete file into an array. Progress comes from actual bytes read and records parsed. UTF-8 BOM, LF/CRLF, quoted commas, escaped quotes and multiline quoted fields are supported. Malformed CSV, invalid encoding and resource limits produce explicit failures.

Select or drag and drop a CSV, then choose **Validate dataset**. Cancel terminates the worker; Reset clears the File and summary. Navigation keeps the File reference and state in session memory, including in-progress validation. A refresh discards them and asks you to select the file again. Neither datasets nor File objects enter localStorage.

The summary reports total/valid/invalid records, missing values, malformed rows, invalid URL/label counts, duplicates across all chunks, conflicting labels, class distribution, and an exact file hash. Valid class counts include consistent duplicate rows, which are separately counted; no rows are silently removed by the browser. Every otherwise valid record in a conflicting URL group is reclassified invalid. Python removes consistent normalized duplicates before training. Browser normalization uses HTTP(S) syntax, IDNA hostnames, default ports and percent encoding; Python independently revalidates the original file and can reject additional cases. Neither validation route proves a URL safe.

Only the first 50 masked preview records and first 100 issue events are retained; preview pages render 10 records at a time. All displayed CSV strings are escaped. Preview and exports mask origins, removing URL paths, query parameters and fragments. The worker retains bounded SHA-256 URL keys for whole-file duplicate detection and releases its data on completion, error or cancellation. Download Summary includes the source (`browser`) and any separately requested Python result. Export Validation Report is bounded and protects spreadsheet formulas.

Default resource limits are **25 MiB**, **1,000,000 records**, **250,000 unique normalized URLs**, and **256 KiB per logical record**. Reading uses 256 KiB chunks. `.env.example` documents build-time `VITE_DATASET_MAX_MIB`, `VITE_DATASET_MAX_ROWS`, and `VITE_DATASET_MAX_UNIQUE_URLS` overrides (hard ceilings 100 MiB / 2 million records / 500,000 unique URLs). Files within the size limit may still exceed a row/unique-record budget; the error directs you to local processing. Changes require rebuilding Vite. Browser memory and speed vary by device.

Browser review and the local research pipeline accept original and normalized URLs up to 16,384 characters. Datasets with URLs above the online limit of 4,096 characters remain eligible for local processing.

Large files are never posted to Vercel. For small valid files, **Verify small dataset with Python** explicitly uploads to `/api/dataset/analyze`, with a visible notice. The API helper rejects source files over 2 MiB before serialization and checks the actual serialized multipart byte size (2 MiB + 64 KiB maximum); it preserves the multipart boundary's case. HTTP status and Content-Type are checked before JSON parsing. Provider plaintext/HTML 413/422/429/5xx errors, malformed JSON, network failures, cancellation and timeouts are shown as useful errors, never as successful results or raw HTML.

Model Training and Feature Experiment share the selected File and validation metadata. The selected full dataset must be valid and within the existing Python upload/row budgets to enable online training; Python still checks domain groups and class splits. A larger validated file shows **Large Dataset — Local Training Required**, disables online training and offers local instructions/configuration export. No sampling, chunk-wise training or combined chunk metrics occur. Experiment results remain tied to their own metadata even if another file is later selected.

The old page uploaded the whole file into the 2 MiB / 1,000-row Python endpoint and called `response.json()` on any response, including provider errors. This explains the reported `Unexpected token 'R'` failure. The live deployment could not be inspected from this cloud environment (its hostname is blocked by the network proxy); no live-deployment fix is claimed before merging and redeploying.

Validated locally: exact-size 500 KiB, 1, 2, 2.1, 3, 5, 10, 15, 20 and 25 MiB fixtures; 100, 1,000, 1,001, 5,000, 10,000, 50,000 and 100,000 records; chunk-invariant aggregation, invalid encoding, malformed CSV, conflicts, cancellation, limits and API error handling. Chromium exercises a 25 MiB file, 3 MiB reselection, navigation, cancel/reset, drag/drop, masking, pagination, download, refresh, plaintext 413 and the existing small-data training flow. These are synthetic test fixtures, not model research findings.

### Jalankan pipeline penelitian

Pratinjau dan validasi struktur CSV tersedia di **Manajemen Dataset**. Untuk dataset penelitian, jalankan audit dan pelatihan pada komputer lokal atau Colab dengan Python 3.12 dan dependensi dari `requirements-dev.txt`. Proses ini bekerja dari berkas privat dan tidak mengirim dataset ke Vercel. Dataset utama dua kolom tidak membawa metadata skenario atau split asli.

```sh
. .venv/bin/activate
python -m ml.research_pipeline /path/02_UPLOAD_EKSPERIMEN_METADATA.csv --audit-only
python -m ml.research_pipeline /path/01_MASTER_EKSPERIMEN_METADATA.csv --dataset-version audit-18722
```

Jika master menyertakan split, pipeline mempertahankannya. Untuk memverifikasi ketiga berkas terhadap master, berikan semuanya sekaligus. Mode ZIP membaca empat berkas dengan nama baku dan mengabaikan berkas skenario, karantina, cadangan, dan laporan yang sudah ada.

```sh
python -m ml.research_pipeline /path/01_MASTER_EKSPERIMEN_METADATA.csv \
  --train /path/TRAIN.csv --validation /path/VALIDATION.csv --test /path/TEST.csv \
  --dataset-version audit-18722
python -m ml.research_pipeline /path/UMMU_PAKET_AUDIT_AKHIR_18722.zip --dataset-version audit-18722
```

Jalankan dengan `--audit-only` untuk memeriksa berkas sebelum pelatihan. Periksa `audit.json` dan `validation-issues.csv` untuk jumlah, alasan dan nomor record. Kesalahan audit menghentikan pipeline sebelum fitting. Bila data memiliki split kosong seluruhnya, pipeline membuat split berbasis kelompok. Bila split hanya terisi di sebagian baris atau berbeda antara master dan berkas split, perbaiki sumber data sebelum menjalankan ulang. Jumlah baris mengikuti input dan hasil audit.

Setiap eksekusi membuat folder privat terpisah di `.research-runs/` (atau direktori dari `--output`). Folder berisi status, laporan audit dan, setelah sukses, subfolder `results/` dengan laporan lengkap, CSV metrik, dua ekspor fitur ber-ID baris, dan artefak model setiap konfigurasi. Jika pelatihan terhenti, jalankan ulang perintah yang sama untuk memakai kembali cache fitur yang sesuai. Proses berikutnya memakai ID eksperimen baru sehingga laporan lama tetap tersedia.

Impor `results/research-summary.json` melalui **Manajemen Dataset** untuk melihat ringkasan di dashboard dan halaman hasil, termasuk setelah refresh. Browser menyimpan agregat dan metrik di perangkat. CSV penelitian, matriks fitur, prediksi per baris, serta artefak model tetap berada di penyimpanan privat yang Anda kendalikan. Simpan cadangan privat bila menggunakan lingkungan sementara seperti Colab. Penyimpanan cloud privat opsional dan dikelola sendiri, sehingga alur ini tidak memerlukan akun penyimpanan, layanan berbayar, atau variabel baru. Unggah hanya ringkasan agregat ke UI.

Jika ingin mengaktifkan inferensi, tinjau terlebih dahulu laporan dan salin pasangan tepercaya `results/deployment-model/production.joblib` dan `model_metadata.json` ke `models/` dalam sumber deployment privat. Paket tersebut berisi **Random Forest 19 fitur (E2)**. Artefak bertahan saat cold start karena ikut dalam paket deployment. Restart API setelah penggantian lokal. Inference verifies SHA-256, schema, feature order and scikit-learn version before deserializing the fixed deployment-owned path. A checksum detects accidental changes. Load only artifacts you produced and control. For legacy two-column training, `python -m ml.train_local` remains available.

### Research protocol

Features have a fixed ordered schema (`lexical-v2`) in `ml/features.py`. The seven basic values are an ordered subset of the 19 extended values. The scanner and both training paths share the same extractor. References, shorteners and the public suffix list have recorded versions. Changes to feature semantics require retraining before inference. Metadata, labels and verified redirect destinations are excluded from feature input.

The research path audits URL duplicates, normalized variants, recorded domain groups and known links from original or destination metadata without fetching URLs. See `audit.json` for rule-level coverage, the PSL version and documented limitations. When the input has no split, GroupShuffleSplit targets **70/15/15 of audited groups**. The seed search starts at 42 and requires both labels in all three partitions. The effective seed and actual row/class/group counts are recorded. Historical redirect destinations can be unknown, and the audit cannot establish content, campaign or temporal independence.

The audit conservatively groups the registered domain of a shared shortener as well as known destination and paired URLs. Groups computed with the offline PSL private section can be further joined by explicit domain or group metadata. If the source audit used different hosting or shortener rules, review the reported rows and the original rule before using an existing split.

Scalers are fitted inside a training-only Logistic Regression pipeline. Configurations are fixed and selection uses validation F1 before the test comparison. E1/E2 are Random Forest, E3/E4 Decision Tree, and E5/E6 Logistic Regression, with basic and extended features respectively. Every configuration evaluates the same test rows. Phishing is positive (1). Reports include accuracy, precision, recall, F1, ROC-AUC, **average precision as PR-AUC**, ROC/PR curves, and confusion matrices in `[benign, phishing]` order. Research reports add specificity, false-positive and false-negative rates, timing, and scenario-specific metrics when the matching metadata exists.

Repeated experiments expose the same holdout and can bias future decisions. Reserve an external, untouched test set for final research claims. Probabilities are explicitly **uncalibrated model estimates**. Similarity can flag legitimate domains; feature importance is associative and subject to impurity bias. Extended features may perform worse than basic features.

Online experiments never activate or replace the production model. Full reports stay in session memory and must be exported before reloading. Only ten compact metric summaries persist locally. `/api/evaluate` recomputes metrics from user-supplied held-out labels/predictions/scores; it does not certify their provenance. The evaluation page supports this JSON format.

## API

| Endpoint | Input | Result |
| --- | --- | --- |
| `GET /api/health` | — | API readiness and deployed-model status |
| `POST /api/features` | JSON `{ "url": "https://example.com" }` | Ordered features, definitions, types, similarity |
| `POST /api/predict` | URL JSON | Lexical features and deployed prediction, or explicit unavailable state |
| `POST /api/scan` | URL JSON | Lexical prediction plus separate network metadata |
| `POST /api/dataset/analyze` | Multipart field `file` | Validated counts, hash, masked preview |
| `POST /api/train` | CSV upload | Three models on extended features |
| `POST /api/experiment` | CSV upload | Six model/feature combinations on a common split |
| `POST /api/evaluate` | JSON arrays `actual`, `predicted`, `phishing_scores` | Recomputed evaluation metrics |

## Network and privacy safeguards

Input permits HTTP(S) only, with no URL credentials, whitespace, control characters or backslashes; hostnames use IDNA normalization. The scanner permits only each scheme's default port, validates **every** DNS answer, rejects non-public IPs/internal names, then connects to a validated numeric IP without re-resolving. HTTPS uses the original hostname for SNI and certificate verification. Every redirect repeats the full checks. Mixed public/private DNS answers reject the target. At most five redirects, 32 KiB headers per response, five seconds per request and twelve seconds total are allowed. DNS and network concurrency are bounded. Unsupported HEAD returns unavailable; there is no GET fallback. Proxies are not used because connection pinning could not otherwise be established. A restricted environment may therefore disable online checking safely.

Request bodies and CSV rows are bounded. Rate limits allow 30 requests per minute per client/process, and one training job/four scans per process. Forwarded headers are not trusted directly. **In-memory limits are not distributed protection:** before public launch, configure Vercel Firewall/WAF rate limits and authentication/access rules for training endpoints according to your plan and audience. Shared serverless client IPs can cause conservative throttling. Online training checks a 35-second budget between bounded fits; the provider remains responsible for the hard function timeout. Larger jobs belong in the local script.

No user cookies, authorization headers or page scripts reach targets. Original URLs are transient API inputs/results rendered as escaped text. History and report errors retain **origin only**, removing paths as well as queries and fragments. Browser history is capped at 200 records. localStorage remains accessible to scripts on the same origin and is not encrypted or synced. CSV exports neutralize spreadsheet formulas. API access logging is disabled in documented startup commands; configure provider request logging and retention carefully. No sensitive URLs are logged by application code.

## Validation

```sh
. .venv/bin/activate
python -m pytest -q
pip check
npm test
npm run build
npm audit --audit-level=moderate
npx playwright install chromium
npm run test:browser
```

The browser runner starts Python and Vite when needed. On a machine with system Chromium, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser`. Ensure the venv is activated so its Python is used. CI also runs the workflow on push and pull request. Backend tests use mocked network responses and safe test targets, never live phishing sites.

Validated in this cloud instance: lexical extraction, URL rejection and IDNA, real test-fixture training and model reload/checksum rejection, group isolation, metrics, CSV validation, DNS/IP/redirect blocking, pinned connections with verified TLS context, HEAD-only reads, body/rate limits, localStorage masking/deletion/exports, all nine pages, frontend/API integration and mobile navigation. See the pull request for final test counts. This is **not** evidence of Vercel deployment or real-world classifier accuracy.

## Vercel deployment

1. Run validation and train/review a real model as above if inference is needed.
2. Commit the project to GitHub, including the lockfile and any explicitly trusted model files.
3. Import the repository in Vercel with framework preset **Vite**, build command `npm run build`, output `dist`, and Python **3.12**. The repository pins Python in `.python-version`; verify the build log uses it.
4. `vercel.json` routes `/api/*` to the FastAPI Python function, includes `ml/` and `models/`, sets a 60-second function maximum and security headers. Hash-based frontend navigation needs no catch-all rewrite and cannot shadow the API. Dependencies are installed from `requirements.txt`.
5. Add optional environment configuration and configure public API abuse controls. Do not put credentials in frontend code. History uses browser localStorage; experiments use temporary request memory.
6. Deploy. Verify function dependency/bundle size and duration against your plan. Python scientific packages are substantial; do not assume a successful Vite build proves Python bundling succeeds. No production database or durable serverless filesystem is required.
7. On the real deployment, check `/api/health`, `/api/features`, a controlled public HEAD/redirect target, a blocked private target, CSV training and artifact-backed prediction. Verify the console and mobile navigation. If outbound connection safety cannot be established, the online check must stay unavailable.

**Vercel publication has not been performed in this cloud task:** no Vercel project or deployment credentials were supplied. Routing and configuration are provided, but an authenticated deployment and live smoke checks remain required. No claim of production deployment is made.

### Python function bundle size

Vercel's Vite/static builder otherwise auto-installs root `requirements.txt` into `.vercel_python_packages` before building the frontend. The Python function then installs the same dependencies into its own environment and, without an exclusion, also packages that first directory as application files. This duplicates the scientific stack and caused the 502.41 MiB `LAMBDA_SIZE_EXCEEDED` failure.

`vercel.json` sets the frontend install command to `npm ci`, leaving Python installation to the Python builder. The function also excludes `.vercel_python_packages/**` (including leftovers from an older build cache) and frontend/test outputs. `ml/*.py` and `models/**` remain explicitly included; NumPy, Pandas, SciPy, scikit-learn and the other declared runtime dependencies remain managed by the Python builder. No ML functionality or model artifacts are removed. Node is pinned to `24.x` so new major releases are not selected automatically.

The local `@vercel/python` 33.0.0 builder selected SciPy wheels targeting newer glibc when the dependency was unpinned. It had to bundle SciPy in the function and exceeded its 225 MiB limit after optimization. SciPy 1.16.3 provides a compatible `manylinux_2_17` wheel for Python 3.12 on x86-64, so the builder can install it from the package registry at runtime. With the pin, the local Python bundle stayed below the limit and excluded a probe in a stale `.vercel_python_packages` directory. A hosted preview still needs to verify cold-start dependency installation, request duration, and bundle size with any deployed model artifact.

## Project map

- `src/pages/`: nine working pages; `src/utils/`: API, shared dataset state/configuration, chunked CSV aggregation, charts, escaping, masked browser storage and exports. `src/workers/csv-worker.js` performs browser validation; `src/components/dataset-readiness.js` connects training to the selected dataset.
- `api/index.py`: FastAPI routes, request bounds, CORS, rate/concurrency guards.
- `ml/features.py`, `scanner.py`, `dataset.py`, `model.py`, `evaluation.py`, `train_local.py`: shared Python logic and local training CLI.
- `models/model_metadata.json`: honest untrained state; real artifacts are generated only from supplied data.
- `tests/`: Python, JavaScript and browser integration tests; `.github/workflows/checks.yml`: CI.
- `vite.config.js`, `vercel.json`: development proxy and deployment configuration.
