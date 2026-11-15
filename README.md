# UMMU URL GUARD

Phishing URL Detection & Typosquatting Analysis — a Vite/vanilla JavaScript research workspace with a Python 3.12 FastAPI backend, scikit-learn models, and browser-local history.

## What works

- Nine responsive pages: dashboard, scanner, datasets, features, training, evaluation, feature experiments, analysis, and history.
- Deterministic Python lexical extraction, offline public-suffix parsing, known-shortener recognition, and registered-domain edit similarity against an explicit, fixed reference list.
- HEAD-only online metadata checks with public-address validation, pinned numeric connections, verified TLS/SNI, per-redirect validation, bounded headers, timeouts and concurrency. No page execution, body downloads or GET fallback.
- CSV validation, masked previews, deduplication and conflicting-label rejection.
- Real Random Forest, scaled Logistic Regression and Decision Tree training, validation-only selection, held-out metrics, curves, confusion matrices, feature importance and masked error analysis.
- Basic/extended comparisons sharing identical domain-disjoint splits; JSON, CSV and research-summary exports.
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

No database, API key, or cloud storage is required. Optional configuration is documented in `.env.example`: export variables in the shell or configure them in your hosting provider; the Python backend does not automatically load `.env`. Exact CORS origins are opt-in; same-origin deployment needs none. Set `ONLINE_SCAN_ENABLED=0` to disable outbound checks.

The current cloud machine can run the app and experiments but does not resolve arbitrary outbound scanner targets. It returns an honest online-check-unavailable result while retaining lexical analysis. This does not establish live-network scanning readiness on a deployed host.

## Dataset and training

Bring a UTF-8 CSV containing `url,label`. Labels are `phishing` / `benign` or `1` / `0`. Verify provenance, collection dates, label quality, consent and licensing yourself; do not use real credentials in URLs.

Online limits: 2 MiB, 1,000 source rows, at least 30 unique normalized URLs, at least 10 registered-domain groups, and at least 6 rows per label. Both classes must be present in all three partitions. Missing cells, invalid URLs, invalid labels and identical-URL label conflicts reject the upload with a useful error. Identical normalized duplicates with consistent labels are removed. Data is held only for the request, not persisted on Vercel or in browser storage.

For larger datasets or a permanent inference model:

```sh
. .venv/bin/activate
python -m ml.train_local /absolute/path/to/labeled.csv
```

This writes `models/production.joblib`, `models/model_metadata.json`, and `models/experiment.json` from actual training. The deployed classifier is explicitly the **extended Random Forest**, even if a baseline wins the validation comparison. Inspect the report before using it. No untrusted pickle/joblib upload endpoint exists.

To include a verified model in deployment, deliberately add the locally generated artifact (`git add -f models/production.joblib`) and its metadata, then commit and redeploy. Artifacts are ignored by default to avoid accidental model uploads. Restart Python after replacing artifacts. Inference verifies SHA-256, schema, feature order and scikit-learn version before deserializing the fixed deployment-owned path. A checksum detects accidental changes; trust still comes from controlling the artifact and its metadata. Never load downloaded or user-supplied joblib files.

### Research protocol

Features have a fixed ordered schema (`lexical-v1`) in `ml/features.py`. References, suspicious keywords and known shorteners are explicit constants, independent of dataset labels. Freeze them before evaluation; changing them requires retraining and versioning the feature schema.

Registered-domain groups include private public-suffix boundaries. GroupShuffleSplit targets **70/15/15 of domain groups**, so row proportions can differ. A deterministic seed search (starting at 42) requires both labels in each partition; the effective seed and actual row/class/group counts are recorded. No registered domain crosses partitions. More complex related-domain relationships, campaigns and temporal leakage require a researcher-defined dataset and additional independent validation.

Scalers are fitted inside a training-only Logistic Regression pipeline. Configurations are fixed; selection uses validation F1. Each model/feature set evaluates the same test rows once. Phishing is positive (1). Reports include accuracy, precision, recall, F1, ROC-AUC, **average precision as PR-AUC**, ROC/PR curves, and confusion matrices in `[benign, phishing]` order. Undefined AUC is null/N/A. Precision/recall/F1 use zero for zero denominators.

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

Validated locally with `@vercel/python` 31.0.2, the builder used by Vercel CLI 65.15.0: the duplicate-directory case reproduced 502.41 MiB; the corrected Python 3.12 bundle was 188.96 MiB with that stale directory still present. The packaged API and model training also ran using a prewarmed runtime dependency cache. Vercel may optimize larger scientific dependencies into its managed runtime installation; a cold-start download could not be validated here because direct DNS is restricted. Final size depends on resolved wheels and any deployed model artifact; redeploy and check the live function.

## Project map

- `src/pages/`: nine working pages; `src/utils/`: API, charts, escaping, masked browser storage and exports.
- `api/index.py`: FastAPI routes, request bounds, CORS, rate/concurrency guards.
- `ml/features.py`, `scanner.py`, `dataset.py`, `model.py`, `evaluation.py`, `train_local.py`: shared Python logic and local training CLI.
- `models/model_metadata.json`: honest untrained state; real artifacts are generated only from supplied data.
- `tests/`: Python, JavaScript and browser integration tests; `.github/workflows/checks.yml`: CI.
- `vite.config.js`, `vercel.json`: development proxy and deployment configuration.
