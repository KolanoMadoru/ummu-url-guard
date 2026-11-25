# UMMU URL GUARD

Phishing URL Detection & Typosquatting Analysis — a Vite/vanilla JavaScript research workspace with a Python 3.12 FastAPI backend, scikit-learn models, and browser-local history.

## Alur penelitian di website

1. Buka **Manajemen Dataset** dan pilih atau seret satu CSV UTF-8 (BOM didukung).
   Gunakan kolom `url,label`, dengan `0` untuk benign dan `1` untuk phishing.
2. Pilih **Jalankan Penelitian Otomatis**. Aplikasi membaca record, menghitung fitur secara leksikal per batch, membersihkan data, membuat split, mengaudit pemisahan, melatih E1–E6, lalu menampilkan evaluasi. Tombol per tahap memakai checkpoint yang sama.
3. Buka **Evaluasi Model** atau **Analisis Hasil** untuk melihat hasil. Unduh laporan JSON lengkap, CSV metrik, split, fitur, dan alasan setiap record yang dikeluarkan.
4. Buka **Pemindai URL** untuk menggunakan Random Forest 19 fitur (E2) dari penelitian yang selesai di browser ini.

```csv
url,label
"https://example.com/path?value=a,b",0
https://example.org/,1
```

Contoh tersebut menunjukkan format CSV. Penelitian memerlukan kedua label pada setiap split, dengan sedikitnya tiga kelompok domain berbeda yang memuat masing-masing label. Pratinjau menampilkan maksimal 20 record dan menyamarkan URL. Distribusi, hasil evaluasi, dan status berasal dari data yang diproses.

Dataset, model, dan hasil riset tidak disertakan. Label historis dan keluaran model tidak menjamin keamanan URL.

## Perbandingan URL pendek

Di **Pemindai URL**, gunakan **Pindai URL** untuk menghitung fitur URL yang dimasukkan. **Periksa Tujuan Redirect** menelusuri URL publik HTTP(S) lewat server, termasuk penyedia yang belum masuk katalog. Aktifkan `ONLINE_SCAN_ENABLED=1` untuk mengizinkan pemeriksaan. Pemindai mencoba HEAD lebih dulu dan dapat mencoba satu GET terbatas ketika respons HEAD tidak cukup. Status 401, 403, dan 429 dilaporkan sebagai akses diblokir. Aplikasi menampilkan status dan metode setiap tahap bersama rantai pengalihan.

Pemindai menampilkan fitur awal dan tujuan berdampingan. Penanda **Dasar** menunjukkan tujuh fitur yang juga termasuk dalam 19 fitur lengkap. Jika HTTP redirect berakhir pada respons sukses, model E2 menilai fitur URL tujuan. URL biasa yang selesai diperiksa tanpa pengalihan dinilai dari URL awal. Lokasi publik yang teramati sebelum kegagalan dilaporkan terpisah sebagai lokasi terakhir yang diketahui. Skor model belum dikalibrasi. Pengamatan ini berlaku pada waktu pemindaian dan dapat berbeda untuk klien lain.

Jika pemeriksaan tautan pendek yang dikenali gagal, fitur URL awal tetap tampil. Cadangan E1 **7 fitur dari URL awal** hanya aktif untuk eksperimen browser yang memiliki kedua label pada cohort kegagalan redirect terdokumentasi di pelatihan, validasi, dan pengujian. Hasil validasi dan uji cohort disimpan dalam laporan lengkap. Cadangan memakai label asal dan fitur URL awal, dengan keterangannya sendiri. Pada model lama atau CSV tanpa bukti kegagalan yang cukup, prediksi cadangan tidak tersedia. Riwayat mencatat dasar prediksi yang dipakai dan menyamarkan asal URL.

### Cakupan URL pendek dalam dataset

Setelah data dibagi, **Cakupan URL Pendek per Partisi** menunjukkan jumlah benign dan phishing per penyedia di pelatihan, validasi, dan pengujian. Unduh tabel sebagai CSV dari **Manajemen Dataset**. Aplikasi memperingatkan jika satu label berasal dari terlalu sedikit kelompok independen atau tidak terwakili dalam suatu split. Menambah tautan dari domain yang sama dapat menambah jumlah sampel, sedangkan contoh dari domain penyedia yang berbeda dapat menambah jumlah kelompok. Split yang sudah disimpan dapat dihitung ulang cakupannya saat workspace dibuka.

Di **Evaluasi Model**, **Positif Palsu pada URL Pendek** menunjukkan berapa URL pendek benign yang diprediksi phishing dari seluruh URL pendek benign pada data uji. Jika penyebutnya nol, tingkat positif palsu tampil sebagai N/A. Gunakan jumlah dan cakupan kelompok ketika menafsirkan hasil dengan sampel kecil.

### Analisis bukti historis

Impor utama tetap memakai satu CSV `url,label`. Kolom opsional `final_url`, `resolution_status`, `source` (sitasi atau ID arsip), dan `observed_at` (tanggal ISO) dapat mencatat bukti historis. Arahan tujuan yang valid secara leksikal menggabungkan kelompok URL dan domain terkait sebelum split. Aplikasi menyimpan status dan provenance dalam laporan, menggunakan label asli, dan menghitung fitur model dari URL awal dataset. Kegagalan historis seperti `TIMEOUT` dipakai hanya untuk memeriksa kelayakan cadangan E1. Tidak ada permintaan ke situs tujuan saat impor. Kegagalan resolusi online saat ini tidak mengubah bukti historis.

Setelah penelitian E1–E6 selesai, buka **Evaluasi Model**. Analisis pasangan merupakan langkah opsional. Unduh **Pembagian Dataset** untuk mendapatkan nomor record dan pilih tautan pendek dari partisi `test`. Buat satu CSV bukti dengan kolom berikut. Baris ini hanya contoh format.

```csv
row,url_awal,url_tujuan,sumber
2,https://t.ly/contoh,https://example.com/arsip,ARSIP-CONTOH-001
```

`row` adalah nomor record dari ekspor split. `url_awal` harus cocok setelah normalisasi dengan record yang dirujuk, `url_tujuan` adalah tujuan historis yang dicatat, dan `sumber` berisi sitasi singkat atau ID arsip. Gunakan bukti yang kredibel. Aplikasi mencocokkan bukti dengan dataset dan menghitung fitur secara leksikal melalui API aplikasi, tanpa mengakses situs dalam file bukti.

Kedua representasi dinilai pada pasangan uji yang sama menggunakan E2 yang dilatih dari URL awal. Label berasal dari CSV utama. Bukti ambigu, bukti yang tidak cocok, dan pasangan dengan tujuan yang bertumpang tindih dengan URL terkait atau domain di data pelatihan/validasi dikeluarkan. Laporan memuat cakupan, alasan pengecualian, sumber, dan metrik kedua representasi. ROC-AUC ditampilkan sebagai N/A jika hanya ada satu kelas. Perbandingan ini bersifat tambahan dan tidak mengubah split, model, atau metrik agregat E1–E6. Label historis pada pasangan tidak mengonfirmasi kondisi tujuan saat ini.

Laporan pasangan dapat diunduh sebagai JSON dengan hash file bukti, nomor record, label, sumber, fitur, prediksi, dan skor. Browser menyimpan laporan dan sidik hash bersalt untuk mencocokkan record, sementara URL dari file bukti hanya diproses selama evaluasi. Untuk workspace penelitian yang dibuat sebelum fitur ini tersedia, jalankan kembali CSV utama agar sidik pencocokan dibuat.

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

No database, API key, cloud storage, or environment variables are required. Optional configuration is documented in `.env.example`. Export variables in the shell or configure them in your hosting provider. Exact CORS origins are opt-in through `ALLOWED_ORIGINS`. The scanner uses lexical analysis by default. Set `ONLINE_SCAN_ENABLED=1` to allow optional outbound redirect checks.

The current cloud machine can run the app and experiments but does not resolve arbitrary outbound scanner targets. It returns an honest online-check-unavailable result while retaining lexical analysis. This does not establish live-network scanning readiness on a deployed host.

## Batas dan penyimpanan

- Alur website mendukung **50.000 record data per CSV**, maksimum **25 MiB** secara default, dan **256 KiB per record CSV**. URL asli dan representasi ternormalisasi masing-masing dibatasi 16.384 karakter. Batas ini membatasi sumber daya. Indikator seperti penggunaan IP, query panjang, domain pendek, dan banyak subdomain tetap diperbolehkan.
- Web Worker membaca CSV bertahap dan menghitung SHA-256. Hanya URL dari record yang lolos pemeriksaan struktur dan label yang dikirim ke API ekstraksi asal yang sama. API menghitung fitur leksikal, tanpa membuka target. Setiap permintaan fitur dibatasi 2.500 URL dan 1,5 MB. Batch yang menghasilkan 413 dibelah dan dicoba kembali.
- Web Worker menyimpan checkpoint dalam IndexedDB, termasuk split, fitur, laporan dan Random Forest E2. File mentah, path, query, serta token tautan tidak disimpan dalam checkpoint. Preview terbatas menyimpan origin yang disamarkan. Unduhan split dan fitur menggunakan nomor record CSV, sehingga bisa dirujuk kembali ke file asli.
- Tahap yang selesai tersedia setelah refresh pada profil browser dan origin yang sama. Jika salah satu eksperimen gagal, retry melanjutkan dari konfigurasi tersimpan. Bila tahap pemrosesan awal terputus sebelum selesai, pilih kembali file untuk memulainya. Simpan unduhan sebagai cadangan sebelum menghapus data situs atau berganti perangkat. Memilih CSV baru mengganti workspace aktif dan melepas model browser sebelumnya. Ringkasan eksperimen terdahulu tetap dapat dilihat dari daftar laporan.
- Interpreter Python melatih satu konfigurasi per request, tanpa menyimpan data riset atau model di server. Request training membawa matriks numerik 19 kolom Float32, satu byte label, split, dan indikator per record. Maksimum total 3.950.000 byte. JSON model E2 berisi struktur pohon numerik. Website tidak menerima unggahan pickle atau joblib.

Variabel opsional dijelaskan di `.env.example`. Tidak ada penyimpanan cloud, akun, atau service eksternal tambahan yang dibutuhkan untuk workflow situs. `VITE_DATASET_MAX_MIB` dan `VITE_DATASET_MAX_ROWS` dapat digunakan untuk membatasi beban. Mengubah batas konfigurasi tidak menaikkan batas training 50.000 record.

## Metodologi

- **Preprocessing.** Baris kosong diabaikan. URL dipangkas dari spasi luar lalu divalidasi sebagai HTTP(S). Representasi asli dipakai untuk menghitung fitur. Normalisasi konservatif dipakai untuk deduplikasi. Untuk label yang konsisten, hanya kemunculan pertama dari URL ternormalisasi yang digunakan. Jika label bertentangan, setiap anggota grup duplikat dikarantina. Ekspor masalah mencatat alasan dan nomor record tanpa menyalin URL.
- **Audit dan split.** Registrable domain memakai snapshot Public Suffix List dari `tldextract`, termasuk private suffix, dan IP memakai representasi kanonik. Setiap grup mencakup domain yang sama dan variasi URL terkait, termasuk HTTP/HTTPS dan awalan www. Dengan seed 42, aplikasi mengalokasikan grup utuh ke target **70/15/15 baris** dan mengupayakan distribusi label serta tautan pendek yang representatif. Memecah grup besar seperti T.LY akan menghasilkan kebocoran, sehingga rasio aktual dapat menyimpang. Statistik split dan peringatan tercantum di UI/ekspor. Audit memeriksa bahwa URL ternormalisasi, hubungan URL, dan domain tidak melintasi partisi. Cakupan ini tidak menjelaskan tujuan redirect historis yang tidak tercatat, maupun kesamaan kampanye atau konten.
- **Fitur.** Skema `lexical-v2` mempertahankan 7 fitur dasar sebagai subset dari 19 fitur lengkap. Training dan scanner memakai ekstraktor yang sama. Katalog pemendek dan referensi merek dicatat versinya. Damerau–Levenshtein menghitung penambahan, penghapusan, penggantian, dan pertukaran huruf. Label, split, kolom tambahan, dan status audit tidak masuk ke matriks fitur.
- **Eksperimen.** E1/E2 memakai Random Forest, E3/E4 Decision Tree, dan E5/E6 Logistic Regression, masing-masing dengan 7/19 fitur. Parameter tetap sebelum eksperimen. Fitting, termasuk scaler, hanya memakai training. Aplikasi membandingkan konfigurasi berdasarkan F1 validation. Metrik test dihitung dari prediksi dan skor kelas phishing (1) pada partisi test yang sama untuk semua konfigurasi. Model browser adalah E2 sesuai rancangan penelitian. Skor belum dikalibrasi dan tingkat kepentingan fitur pohon berasal dari impuritas.
- **Evaluasi.** Hasil global adalah hasil utama. Subset test tambahan berasal dari heuristik URL. URL biasa berarti tidak teridentifikasi sebagai tautan pendek. Indikasi kemiripan merek dapat tumpang tindih dengan kedua kelompok. Aplikasi menampilkan jumlah per kelas, confusion matrix [benign, phishing], metrik yang tersedia, dan waktu eksekusi. ROC-AUC membutuhkan kedua kelas. PR-AUC menggunakan average precision. JSON ekspor menyimpan hash, versi, parameter, pembagian, dan prediksi per record agar metrik dapat diperiksa ulang.

Laporan lama dalam format `research-summary.json` masih dapat diimpor secara opsional. Pipeline CLI dari rilis sebelumnya juga tetap dapat dipakai untuk audit master/split peneliti yang sudah ada. Untuk penggunaan normal, cukup unggah satu CSV ke website.

## API

| Endpoint | Input | Result |
| --- | --- | --- |
| `GET /api/health` | — | API readiness and deployed-model status |
| `POST /api/features` | JSON `{ "url": "https://example.com" }` | Ordered features, definitions, types, similarity |
| `POST /api/predict` | URL JSON | Lexical features and deployed prediction, or explicit unavailable state |
| `POST /api/scan` | JSON dengan `url` dan `check_redirect` opsional | Fitur awal, status resolusi, dan prediksi yang merujuk URL awal atau tujuan terkonfirmasi melalui `prediction_target`. |
| `POST /api/resolve-url` | JSON dengan `url` | Resolver mandiri dengan URL dan domain awal/akhir, status, kode kegagalan, rantai, metode, dan waktu. `final_url` dipakai untuk tujuan redirect yang terkonfirmasi. |
| `POST /api/research/features` | JSON daftar URL terbatas | Fitur leksikal dan kunci pengelompokan dalam urutan input |
| `POST /api/research/train/{E1…E6}` | Byte matriks, label, split, dan indikator | Satu hasil eksperimen. E2 menyertakan forest numerik. |
| `POST /api/dataset/analyze` | Multipart field `file` | Validated counts, hash, masked preview |
| `POST /api/train` | CSV upload | Three models on extended features |
| `POST /api/experiment` | CSV upload | Six model/feature combinations on a common split |
| `POST /api/evaluate` | JSON arrays `actual`, `predicted`, `phishing_scores` | Recomputed evaluation metrics |

## Network and privacy safeguards

Input permits HTTP(S) only. Credentials, whitespace, control characters, and backslashes are rejected. Hostnames use IDNA normalization. The scanner permits only each scheme's default port, validates **every** DNS answer, rejects non-public IPs and internal names, and connects to a validated numeric IP. HTTPS uses the original hostname for SNI and certificate verification. Every redirect repeats these checks. Mixed public/private DNS answers reject the target. The scanner allows up to ten redirects, 32 KiB of headers per response, one GET fallback, five seconds per request, and eighteen seconds total. It closes the connection at the end of the headers. HTML or JavaScript navigation, interstitials, and interactive protections are outside the HTTP header check. Direct connections preserve IP pinning and depend on destination reachability from the deployment.

Request bodies and CSV rows are bounded. Rate limits per client and process are 100 feature-batch requests, 12 browser-training requests, and 30 other requests per minute. Each process handles one training request at a time. Forwarded headers are not trusted directly. For a public deployment, review Vercel Firewall and access rules for the intended audience. The provider enforces the function deadline.

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

The browser runner starts Python and Vite when needed. On a machine with system Chromium, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser`. Ensure the venv is activated so its Python is used. CI also runs the workflow on push and pull request. Redirect tests use mocked HEAD and DNS responses for success, blocked destinations, and timeout. Historical comparison tests use synthetic evidence. Live targets and the original research dataset are outside this test coverage.

Validated in this cloud instance: lexical extraction, URL rejection and IDNA, real test-fixture training and model reload/checksum rejection, group isolation, metrics, CSV validation, DNS/IP/redirect blocking, pinned connections with verified TLS context, header-only responses, body/rate limits, localStorage masking/deletion/exports, all nine pages, frontend/API integration and mobile navigation. Hosted deployment and performance on the original research dataset need separate verification.

## Vercel deployment

1. Run the validation commands.
2. Push the source and lockfile to GitHub. Browser-trained models are saved by the app.
3. Import the repository in Vercel with framework preset **Vite**, build command `npm run build`, output `dist`, and Python **3.12**. The repository pins Python in `.python-version`; verify the build log uses it.
4. `vercel.json` routes `/api/*` to the FastAPI Python function, includes `ml/` and `models/`, sets a 60-second function maximum and security headers. Hash-based frontend navigation needs no catch-all rewrite and cannot shadow the API. Dependencies are installed from `requirements.txt`.
5. Create a preview deployment. Check Python build output, dependency download on cold start, and the 60-second function duration against the selected plan.
6. Open the preview and run one complete research job with a synthetic CSV. Check `/api/health`, CSV upload, six fits, data restoration after refresh, scanner prediction, and download. Confirm behavior at 50.000 rows on the hosted plan before sharing a production URL.
7. Promote a verified preview using the Vercel project workflow.

Local validation used the official Vercel Python builder for a roughly 180.5 MiB bundle. Chromium ran all six configurations from a synthetic 50,000-row CSV (2.76 MB) against the packaged API with dependencies prewarmed, then recovered the E2 scanner model after refresh. Each binary training request was 3.95 MB. The separate 50,000-row E2 benchmark with high-entropy features took about 12 seconds and returned less than 0.7 MB. Hosted Vercel preview, cold start, and the original research dataset still require verification.

### Python function bundle size

Vercel's Vite/static builder otherwise auto-installs root `requirements.txt` into `.vercel_python_packages` before building the frontend. The Python function then installs the same dependencies into its own environment and, without an exclusion, also packages that first directory as application files. This duplicates the scientific stack and caused the 502.41 MiB `LAMBDA_SIZE_EXCEEDED` failure.

`vercel.json` sets the frontend install command to `npm ci`, leaving Python installation to the Python builder. The function also excludes `.vercel_python_packages/**` (including leftovers from an older build cache) and frontend/test outputs. `ml/*.py` and `models/**` remain explicitly included; NumPy, Pandas, SciPy, scikit-learn and the other declared runtime dependencies remain managed by the Python builder. No ML functionality or model artifacts are removed. Node is pinned to `24.x` so new major releases are not selected automatically.

The local `@vercel/python` 33.0.0 builder selected SciPy wheels targeting newer glibc when the dependency was unpinned. It had to bundle SciPy in the function and exceeded its 225 MiB limit after optimization. SciPy 1.16.3 provides a compatible `manylinux_2_17` wheel for Python 3.12 on x86-64, so the builder can install it from the package registry at runtime. With the pin, the local Python bundle stayed below the limit and excluded a probe in a stale `.vercel_python_packages` directory. A hosted preview still needs to verify cold-start dependency installation, request duration, and bundle size with any deployed model artifact.

## Project map

- `src/pages/`: nine pages. `src/workers/automatic-research.js` runs the browser pipeline and checkpoints progress. `src/utils/automatic-data.js` validates records and builds deterministic partitions, and `src/utils/browser-prediction.js` reads numeric E2 trees.
- `api/index.py`: FastAPI routes, request bounds, CORS, rate/concurrency guards.
- `ml/features.py`, `scanner.py`, `dataset.py`, `model.py`, `evaluation.py`: shared Python logic. `ml/browser_training.py` fits one configuration per request. `ml/research_pipeline.py` remains available for local metadata audits.
- `models/model_metadata.json`: honest untrained state; real artifacts are generated only from supplied data.
- `tests/`: Python, JavaScript and browser integration tests; `.github/workflows/checks.yml`: CI.
- `vite.config.js`, `vercel.json`: development proxy and deployment configuration.
