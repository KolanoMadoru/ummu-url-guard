// Presentation only: API payloads, worker statuses, CSV labels and stored records stay unchanged.
const messages = {
  benign: "Aman (benign)", phishing: "Phishing", unavailable: "Tidak Tersedia",
  complete: "Selesai", disabled: "Dinonaktifkan", browser: "Browser", python: "Python",
  basic: "Fitur Dasar", extended: "Fitur Tambahan", train: "Pelatihan",
  validation: "Validasi", test: "Pengujian", integer: "Bilangan bulat", float: "Bilangan desimal",
  accuracy: "Akurasi", precision: "Presisi", recall: "Recall", f1: "Skor F1",
  roc_auc: "ROC-AUC", pr_auc: "PR-AUC (AP)", false_positive: "Positif Palsu", false_negative: "Negatif Palsu",
  "N/A": "Tidak Tersedia", "No File Selected": "Belum Ada File Terpilih",
  "File Selected": "File Terpilih", Validating: "Sedang Memvalidasi", Processing: "Sedang Diproses",
  Validated: "Validasi Berhasil", "Validation Failed": "Validasi Gagal", "Processing Cancelled": "Pemrosesan Dibatalkan",
  "Dataset Ready": "Dataset Siap", "Not validated": "Belum divalidasi",
  "Select and validate a CSV in Dataset Management.": "Pilih dan validasi CSV di Manajemen Dataset.",
  "Validate the selected dataset successfully in Dataset Management first.": "Validasi dataset terpilih di Manajemen Dataset hingga berhasil terlebih dahulu.",
  "Large Dataset — Local Training Required": "Dataset Besar — Pelatihan Lokal Diperlukan",
  "Online training needs 30 unique URLs, 6 rows per label, and 10 independent domain groups. Python verifies domain splits.": "Pelatihan daring memerlukan 30 URL unik, 6 baris per label, dan 10 kelompok domain independen. Python memverifikasi pembagian domain.",
  "Dataset Ready · within online upload/row limits. Python verifies domain groups and split eligibility.": "Dataset Siap · memenuhi batas unggahan dan jumlah baris daring. Python memverifikasi kelompok domain dan kelayakan pembagian.",
  "Only .csv files are supported.": "Hanya file .csv yang didukung.", "CSV is empty.": "CSV kosong.",
  "CSV worker failed.": "Pemroses CSV gagal.",
  "CSV worker failed or ran out of resources. Use a smaller file or local processing.": "Pemroses CSV gagal atau kehabisan sumber daya. Gunakan file lebih kecil atau pemrosesan lokal.",
  "CSV worker could not start. Use a current browser or local processing.": "Pemroses CSV tidak dapat dimulai. Gunakan browser terbaru atau pemrosesan lokal.",
  "CSV is empty. Select a file with url,label and data rows.": "CSV kosong. Pilih file dengan kolom url,label dan baris data.",
  "Select a .csv file containing UTF-8 text.": "Pilih file .csv berisi teks UTF-8.",
  "Invalid parser chunk size.": "Ukuran potongan pemroses tidak valid.",
  "A CSV record exceeds the 256 KiB resource limit.": "Satu data CSV melebihi batas sumber daya 256 KiB.",
  "CSV requires distinct url,label headers (additional columns are allowed).": "CSV memerlukan judul kolom url,label yang berbeda (kolom tambahan diperbolehkan).",
  "Malformed CSV or inconsistent field count": "Format CSV atau jumlah kolom tidak sesuai",
  "Missing URL": "URL kosong", "Missing label": "Label kosong",
  "Invalid label; use benign=0 or phishing=1": "Label tidak valid; gunakan benign=0 atau phishing=1",
  "Invalid HTTP/HTTPS URL syntax": "Sintaks URL HTTP/HTTPS tidak valid",
  "Conflicting labels": "Label bertentangan", "Conflicting labels · invalid": "Label bertentangan · tidak valid",
  "[invalid URL]": "[URL tidak valid]", "[invalid label]": "[label tidak valid]",
  Valid: "Valid", "Valid · duplicate URL": "Valid · URL duplikat",
  "Invalid UTF-8 encoding. Save the CSV as UTF-8 and select it again.": "Enkode UTF-8 tidak valid. Simpan CSV sebagai UTF-8 dan pilih ulang file.",
  "CSV must contain url,label headers and at least one data row.": "CSV harus memiliki judul kolom url,label dan minimal satu baris data.",
  "Valid records exclude invalid rows and every intrinsically valid row in a conflicting URL group. Consistent duplicate rows remain counted, and are separately reported; Python removes them before training.": "Data valid tidak mencakup baris tidak valid dan seluruh baris dalam kelompok URL berlabel bertentangan. Duplikat dengan label konsisten tetap dihitung dan dilaporkan terpisah; Python menghapusnya sebelum pelatihan.",
  "Browser storage is unavailable or damaged. History may not persist.": "Penyimpanan browser tidak tersedia atau rusak. Riwayat mungkin tidak tersimpan.",
  "Browser storage is full or blocked. Export results before leaving.": "Penyimpanan browser penuh atau diblokir. Ekspor hasil sebelum menutup halaman.",
  "Prediction unavailable — model not trained": "Prediksi Tidak Tersedia — model belum dilatih",
  "Production model could not be verified; regenerate the trusted artifact.": "Model produksi tidak dapat diverifikasi; buat ulang artefak tepercaya.",
  "Uncalibrated model estimate for phishing, not a safety guarantee": "Estimasi model untuk phishing belum dikalibrasi dan bukan jaminan keamanan",
  "exact match": "Sama persis", "multiple edits": "Beberapa perubahan", "hyphen insertion": "Penyisipan tanda hubung",
  insertion: "Penyisipan", deletion: "Penghapusan", substitution: "Penggantian", transposition: "Pertukaran posisi",
  "Online checking is disabled by environment configuration.": "Pemeriksaan jaringan dinonaktifkan oleh konfigurasi lingkungan.",
  "Internal hostnames are blocked.": "Nama host internal diblokir.",
  "DNS capacity is busy; try again later.": "Kapasitas DNS sedang sibuk; coba lagi nanti.",
  "DNS resolution timed out.": "Waktu resolusi DNS habis.", "DNS resolution failed.": "Resolusi DNS gagal.",
  "DNS returned no addresses.": "DNS tidak mengembalikan alamat.",
  "A DNS address is not a public unicast IP; target blocked.": "Alamat DNS bukan IP unicast publik; tujuan diblokir.",
  "Online check exceeded its total time budget.": "Pemeriksaan jaringan melebihi batas waktu total.",
  "HTTP request timed out.": "Waktu permintaan HTTP habis.", "Incomplete HTTP headers.": "Header HTTP tidak lengkap.",
  "HTTP headers exceed 32 KiB.": "Header HTTP melebihi 32 KiB.", "Invalid HTTP status line.": "Baris status HTTP tidak valid.",
  "Unsupported HTTP status (including interim responses).": "Status HTTP tidak didukung (termasuk respons sementara).",
  "Invalid HTTP header.": "Header HTTP tidak valid.", "Ambiguous redirect location.": "Lokasi pengalihan ambigu.",
  "Only the default HTTP/HTTPS ports are allowed.": "Hanya port bawaan HTTP/HTTPS yang diperbolehkan.",
  "Redirect loop detected.": "Pengalihan berulang terdeteksi.",
  "Server does not support HEAD; no body fallback was attempted.": "Server tidak mendukung HEAD; isi halaman tidak diunduh sebagai alternatif.",
  "Redirect has no Location header.": "Pengalihan tidak memiliki header Location.",
  "Maximum of 5 redirects reached.": "Batas maksimal 5 pengalihan tercapai.",
  "Connection failed, timed out, or target URL is invalid; safe online check unavailable.": "Koneksi gagal, waktu habis, atau URL tujuan tidak valid; pemeriksaan jaringan yang aman tidak tersedia.",
  "Scanner capacity is busy.": "Kapasitas pemindai sedang sibuk.",
  "URL must contain 1–4096 characters.": "URL harus berisi 1–4096 karakter.",
  "Whitespace, control characters, and backslashes are not allowed.": "Spasi, karakter kontrol, dan garis miring terbalik tidak diperbolehkan.",
  "Use an absolute HTTP or HTTPS URL.": "Gunakan URL HTTP atau HTTPS lengkap.",
  "Credentials in URLs are not allowed.": "Kredensial dalam URL tidak diperbolehkan.",
  "Hostname exceeds 253 characters.": "Nama host melebihi 253 karakter.", "Invalid port.": "Port tidak valid.",
  "Normalized URL exceeds 4096 characters.": "URL hasil normalisasi melebihi 4096 karakter.",
  "Dataset is empty.": "Dataset kosong.",
  "CSV exceeds the 2 MiB online upload limit; use local training.": "CSV melebihi batas unggahan daring 2 MiB; gunakan pelatihan lokal.",
  "Invalid CSV. Use UTF-8 text with url,label columns.": "CSV tidak valid. Gunakan teks UTF-8 dengan kolom url,label.",
  "CSV must contain url,label columns and at least one row.": "CSV harus memiliki kolom url,label dan minimal satu baris data.",
  "Labels must be phishing/benign (or 1/0, respectively).": "Label harus berupa phishing/benign (masing-masing 1/0).",
  "Training needs at least 30 unique URLs and 10 registered-domain groups with both labels spread across groups.": "Pelatihan memerlukan minimal 30 URL unik dan 10 kelompok domain terdaftar dengan kedua label tersebar di berbagai kelompok.",
  "Each label needs at least 6 records for meaningful train/validation/test partitions.": "Setiap label memerlukan minimal 6 data untuk partisi pelatihan, validasi, dan pengujian yang bermakna.",
  "Could not create disjoint domain groups with both classes in every split. Add more independent domains per label.": "Tidak dapat membentuk kelompok domain tanpa irisan dengan kedua kelas di setiap partisi. Tambahkan domain independen untuk setiap label.",
  "Experiment exceeded the online time budget. Use python -m ml.train_local.": "Eksperimen melebihi batas waktu daring. Gunakan python -m ml.train_local.",
  "Experiment exceeded the time budget. Use local training; no successful experiment is reported.": "Eksperimen melebihi batas waktu. Gunakan pelatihan lokal; tidak ada eksperimen berhasil yang dilaporkan.",
  "Prediction arrays must have equal lengths.": "Larik prediksi harus memiliki panjang yang sama.",
  "Labels must be 0/1 and scores must be finite values in [0,1].": "Label harus 0/1 dan skor harus bernilai terbatas dalam rentang [0,1].",
  "Registered-domain GroupShuffleSplit; target group proportions 70/15/15; actual row counts reported.": "GroupShuffleSplit berdasarkan domain terdaftar; target proporsi kelompok 70/15/15; jumlah baris aktual dilaporkan.",
  "Phishing is the positive class. PR-AUC uses average precision.": "Phishing adalah kelas positif. PR-AUC menggunakan rerata presisi.",
  "All comparisons share the same held-out test rows; selection uses validation F1 only.": "Semua perbandingan menggunakan baris data uji terpisah yang sama; pemilihan hanya menggunakan skor F1 validasi.",
  "Models are fit only on training rows; test is evaluated once per model and feature set.": "Model hanya dilatih pada baris pelatihan; pengujian dilakukan sekali untuk setiap model dan kelompok fitur.",
  "Repeated experiments can overfit the holdout. Reserve an independent external test set for final research claims.": "Eksperimen berulang dapat terlalu menyesuaikan data uji. Sisihkan data uji eksternal independen untuk klaim penelitian akhir.",
  "Online results never replace the production Random Forest.": "Hasil daring tidak pernah menggantikan Random Forest produksi.",
  "Ukuran request melebihi batas server. Dataset akan diproses melalui mekanisme yang mendukung file besar. Return to Dataset Management for browser validation; large datasets require local training.": "Ukuran permintaan melebihi batas server. Kembali ke Manajemen Dataset untuk validasi di browser; dataset besar memerlukan pelatihan lokal.",
  "Dataset or request validation failed. Check the required fields, labels and backend training limits.": "Validasi dataset atau permintaan gagal. Periksa kolom wajib, label, dan batas pelatihan backend.",
  "Too many requests or an experiment is already running. Wait a minute and try again.": "Terlalu banyak permintaan atau eksperimen sedang berjalan. Tunggu satu menit dan coba lagi.",
  "The server could not complete this operation. No successful result was recorded.": "Server tidak dapat menyelesaikan operasi. Tidak ada hasil berhasil yang dicatat.",
  "The API gateway could not reach the backend. Try again later.": "Gerbang API tidak dapat menghubungi backend. Coba lagi nanti.",
  "The backend is temporarily unavailable. Try again later.": "Backend sementara tidak tersedia. Coba lagi nanti.",
  "The server timed out. Use the local training script for larger datasets.": "Waktu permintaan server habis. Gunakan skrip pelatihan lokal untuk dataset besar.",
  "This file exceeds the 2 MiB backend upload limit. Validate it in the browser and use local training.": "File melebihi batas unggahan backend 2 MiB. Validasi di browser dan gunakan pelatihan lokal.",
  "Multipart request exceeds the backend limit. Use local training.": "Permintaan multipart melebihi batas backend. Gunakan pelatihan lokal.",
  "The server returned an invalid JSON response. No successful result was recorded.": "Server mengembalikan respons JSON tidak valid. Tidak ada hasil berhasil yang dicatat.",
  "The server returned a non-JSON response. Check the API route; no successful result was recorded.": "Server mengembalikan respons bukan JSON. Periksa rute API; tidak ada hasil berhasil yang dicatat.",
  "Request timed out. For large training jobs, use the local Python script.": "Waktu Permintaan Habis. Untuk pelatihan besar, gunakan skrip Python lokal.",
  "Request cancelled.": "Permintaan dibatalkan.",
  "Cannot reach the API. Check your connection and backend availability.": "Terjadi Kesalahan Jaringan. Periksa koneksi dan ketersediaan backend.",
  "Request body exceeds the endpoint limit.": "Isi permintaan melebihi batas endpoint.",
  "Server rate-limit capacity reached.": "Kapasitas pembatasan permintaan server tercapai.",
  "Limit: 30 requests per minute per client/process.": "Batas: 30 permintaan per menit untuk setiap klien/proses.",
  "An experiment is already running in this process.": "Eksperimen sedang berjalan dalam proses ini.",
  "Required field": "Kolom wajib diisi", "Field required": "Kolom wajib diisi", "Invalid value": "Nilai tidak valid",
  "Invalid labels": "Label tidak valid",
};
const patterns = [
  [/^File exceeds the (.+) MiB browser validation limit\.$/, (n) => `File melebihi batas validasi browser ${n} MiB.`],
  [/^Dataset exceeds the (.+) (record|unique URL) resource limit\. Use local processing\.$/, (n, kind) => `Dataset melebihi batas ${n} ${kind === "record" ? "data" : "URL unik"}. Gunakan pemrosesan lokal.`],
  [/^Online datasets are limited to (\d+) rows; use the local script\.$/, (n) => `Dataset daring dibatasi ${n} baris; gunakan skrip lokal.`],
  [/^Dataset has (\d+) rows with missing URL or label; clean it before upload\.$/, (n) => `Dataset memiliki ${n} baris dengan URL atau label kosong; bersihkan sebelum mengunggah.`],
  [/^Invalid URL on CSV row (\d+); URL values are not logged\.$/, (n) => `URL Tidak Valid pada baris CSV ${n}; nilai URL tidak dicatat dalam log.`],
  [/^Conflicting labels for (\d+) identical normalized URLs\.$/, (n) => `Label bertentangan pada ${n} URL identik setelah normalisasi.`],
  [/^Request failed \(HTTP (\d+)\)\.$/, (n) => `Permintaan gagal (HTTP ${n}).`],
  [/^Invalid URL: (.+)$/s, (detail) => `URL Tidak Valid: ${displayText(detail)}`],
  [/^Input should be a valid (.+)$/, (kind) => `Masukan harus memiliki tipe yang valid (${displayText(kind)}).`],
  [/^String should have at (least|most) (\d+) characters?$/, (bound, n) => `Teks harus berisi ${bound === "least" ? "minimal" : "maksimal"} ${n} karakter.`],
  [/^List should have at (least|most) (\d+) items? after validation, not \d+$/, (bound, n) => `Larik harus berisi ${bound === "least" ? "minimal" : "maksimal"} ${n} elemen setelah validasi.`],
];

export function displayText(value) {
  if (value == null) return "Tidak Tersedia";
  const text = String(value);
  if (Object.hasOwn(messages, text)) return messages[text];
  for (const [pattern, translate] of patterns) {
    const match = text.match(pattern);
    if (match) return translate(...match.slice(1));
  }
  // Validation issues may contain multiple messages; API errors retain field paths.
  if (text.includes("; ")) return text.split("; ").map(displayText).join("; ");
  if (/^(body|query|path)\./.test(text) && text.includes(": ")) {
    const colon = text.indexOf(": ");
    return `${text.slice(0, colon)}: ${displayText(text.slice(colon + 2))}`;
  }
  return text;
}

export function errorText(error) {
  if (error instanceof SyntaxError) return "JSON tidak valid. Periksa sintaks file prediksi.";
  const original = error?.message || String(error);
  const translated = displayText(original);
  // Unrecognized provider diagnostics are retained as text, never rendered as HTML.
  return translated === original && /\b(invalid|error|failed|must|should|not|unable)\b/i.test(original)
    ? `Operasi gagal. Rincian diagnostik: ${original}`
    : translated;
}

const features = {
  url_length: ["Panjang URL", "Jumlah karakter dalam URL yang dinormalisasi"],
  domain_length: ["Panjang Domain", "Jumlah karakter dalam nama host ASCII"],
  path_length: ["Panjang Jalur", "Jumlah karakter dalam jalur URL"],
  query_length: ["Panjang Kueri", "Jumlah karakter dalam kueri URL"],
  dot_count: ["Jumlah Titik", "Jumlah titik dalam URL yang dinormalisasi"],
  hyphen_count: ["Jumlah Tanda Hubung", "Jumlah tanda hubung dalam URL yang dinormalisasi"],
  digit_count: ["Jumlah Angka", "Jumlah angka ASCII dalam URL yang dinormalisasi"],
  special_count: ["Jumlah Karakter Khusus", "Jumlah karakter selain huruf dan angka ASCII"],
  subdomain_count: ["Jumlah Subdomain", "Jumlah label sebelum domain terdaftar menurut daftar sufiks publik luring"],
  keyword_count: ["Kata Kunci Mencurigakan", "Jumlah kemunculan kata dalam daftar kata kunci mencurigakan tetap"],
  ip_address: ["Alamat IP", "Indikator nama host berupa alamat IP literal"],
  https: ["HTTPS", "Indikator skema HTTPS"],
  shortener: ["Pemendek URL", "Indikator nama host yang sama persis dengan pemendek URL yang dikenal"],
  domain_entropy: ["Entropi Domain", "Entropi Shannon dari nama host ASCII"],
  digit_ratio: ["Rasio Angka", "Jumlah angka dibagi panjang URL"],
  special_ratio: ["Rasio Karakter Khusus", "Jumlah karakter khusus dibagi panjang URL"],
  typo_similarity: ["Kemiripan Typosquatting", "Kemiripan edit ternormalisasi tertinggi terhadap referensi domain terdaftar tetap; kecocokan persis bernilai nol"],
  registered_length: ["Panjang Domain Terdaftar", "Jumlah karakter dalam domain terdaftar"],
  suffix_length: ["Panjang Sufiks", "Jumlah karakter dalam sufiks publik"],
};
export const featureLabel = (key) => features[key]?.[0] || key;
export const featureDefinition = (key, fallback) => features[key]?.[1] || displayText(fallback);
export const classLabel = (value) => displayText(value || "unavailable");
