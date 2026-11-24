import { streamCSVRecords } from "./csv-parser.js";
import { DATASET_LIMITS } from "./dataset-config.js";

export const AUTOMATIC_MAX_ROWS = Math.min(50_000, DATASET_LIMITS.maxRows);
const SPLIT_SEED = 42;
const PARTITIONS = ["train", "validation", "test"];
const RATIOS = [0.7, 0.15, 0.15];
const ISSUE_MESSAGES = {
  blank: "Baris kosong diabaikan.",
  malformed: "Jumlah kolom berbeda dari header CSV.",
  missing_url: "URL kosong.",
  invalid_label: "Label harus berupa 0 atau 1.",
  invalid_url: "URL tidak dapat diproses sebagai HTTP atau HTTPS.",
  url_length_limit: "URL melampaui batas karakter ekstraktor fitur.",
  duplicate: "URL ternormalisasi dan label sama dengan baris yang sudah dipakai.",
  conflict: "URL ternormalisasi memiliki label yang berbeda dan dikarantina.",
};

function issue(row, code) {
  return { row, code, message: ISSUE_MESSAGES[code] };
}

export async function readAutomaticCSV(file, { onProgress, signal } = {}) {
  const rows = [], issues = [];
  let record = 0, totalRecords = 0, blankRecords = 0;
  let urlColumn = -1, labelColumn = -1, width = 0;
  const datasetHash = await streamCSVRecords(file, {
    onProgress,
    signal,
    rowsProcessed: () => totalRecords,
    onRecord(cells, malformed) {
      record++;
      if (malformed)
        throw new Error(`CSV tidak dapat dibaca pada record ${record}. Periksa penulisan tanda kutip.`);
      if (cells.length === 1 && !cells[0].trim()) {
        if (++blankRecords > AUTOMATIC_MAX_ROWS)
          throw new Error("CSV memiliki terlalu banyak baris kosong.");
        issues.push(issue(record, "blank"));
        return;
      }
      if (!width) {
        const header = cells.map((name) => name.trim().toLowerCase());
        urlColumn = header.indexOf("url");
        labelColumn = header.indexOf("label");
        if (urlColumn < 0 || labelColumn < 0 ||
            urlColumn !== header.lastIndexOf("url") || labelColumn !== header.lastIndexOf("label"))
          throw new Error("CSV harus memiliki masing-masing satu kolom url dan label.");
        width = cells.length;
        return;
      }
      if (++totalRecords > AUTOMATIC_MAX_ROWS)
        throw new Error(`Dataset melebihi batas ${AUTOMATIC_MAX_ROWS.toLocaleString("id-ID")} record penelitian.`);
      if (cells.length !== width) {
        issues.push(issue(record, "malformed"));
        return;
      }
      const url = cells[urlColumn].trim();
      const label = cells[labelColumn].trim();
      if (!url) {
        issues.push(issue(record, "missing_url"));
      } else if (label !== "0" && label !== "1") {
        issues.push(issue(record, "invalid_label"));
      } else {
        rows.push({ row: record, url, label: Number(label) });
      }
    },
  });
  if (!width || !totalRecords)
    throw new Error("CSV harus memiliki header url,label dan minimal satu record data.");
  return { rows, issues, totalRecords, blankRecords, datasetHash };
}

function makeGroups(rows) {
  const previous = new Map();
  const parents = rows.map((_, i) => i);
  function root(i) {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  }
  function link(key, i) {
    if (!previous.has(key)) {
      previous.set(key, i);
      return;
    }
    const a = root(previous.get(key));
    const b = root(i);
    parents[Math.max(a, b)] = Math.min(a, b);
  }
  rows.forEach((row, i) => {
    link(`domain:${row.domain}`, i);
    link(`related:${row.related}`, i);
  });
  const components = new Map();
  rows.forEach((row, i) => {
    const key = root(i);
    if (!components.has(key)) components.set(key, []);
    row.group = key;
    components.get(key).push(i);
  });
  return [...components.values()];
}

function maskedOrigin(normalized) {
  const authority = /^https?:\/\/[^/?#]+/u.exec(normalized)?.[0];
  return authority ? `${authority}/…` : "URL tervalidasi";
}

export function prepareAutomaticData(rawRows, extracted) {
  if (extracted.length !== rawRows.length)
    throw new Error("Jumlah hasil ekstraksi berbeda dari jumlah URL yang dikirim.");
  const issues = [], byURL = new Map();
  const summary = {
    source_rows: rawRows.length, valid_rows: 0, invalid_rows: 0, duplicate_rows: 0,
    conflicting_rows: 0, conflict_groups: 0, benign: 0, phishing: 0,
    brand_matches: 0, shorteners: {}, preview: [],
  };
  rawRows.forEach((raw, i) => {
    const result = extracted[i];
    if (result === null) {
      summary.invalid_rows++;
      issues.push(issue(raw.row, raw.url.length > DATASET_LIMITS.maxURLLength ? "url_length_limit" : "invalid_url"));
      return;
    }
    const { normalized, related, domain, features, provider, brand } = result;
    if (!normalized || !related || !domain ||
        !Array.isArray(features) || features.length !== 19 || !features.every(Number.isFinite))
      throw new Error("Hasil ekstraksi fitur tidak lengkap.");
    const row = { ...raw, normalized, related, domain, features, provider, brand };
    if (!byURL.has(normalized)) byURL.set(normalized, []);
    byURL.get(normalized).push(row);
  });

  const rows = [], providers = new Map();
  for (const matches of byURL.values()) {
    const first = matches[0];
    if (matches.some((row) => row.label !== first.label)) {
      summary.conflict_groups++;
      summary.conflicting_rows += matches.length;
      for (const row of matches) issues.push(issue(row.row, "conflict"));
      continue;
    }
    rows.push(first);
    summary[first.label === 0 ? "benign" : "phishing"]++;
    if (first.brand) summary.brand_matches++;
    if (first.provider) providers.set(first.provider, (providers.get(first.provider) || 0) + 1);
    summary.duplicate_rows += matches.length - 1;
    for (const row of matches.slice(1)) issues.push(issue(row.row, "duplicate"));
  }
  summary.shorteners = Object.fromEntries(providers);
  summary.valid_rows = rows.length;
  summary.preview = rows.slice(0, 20).map(({ row, label, normalized }) => ({
    row, label, url: maskedOrigin(normalized),
  }));
  issues.sort((a, b) => a.row - b.row);
  return { rows, issues, summary, groups: makeGroups(rows) };
}

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function shuffle(values, random) {
  const order = values.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const STAT_COUNT = 5;
const zeroStats = () => Array(STAT_COUNT).fill(0);

function groupStats(indices, rows) {
  // Track both labels and shortener counts within each label.
  const stats = zeroStats();
  stats[0] = indices.length;
  for (const i of indices) {
    const { label, provider } = rows[i];
    stats[1 + label]++;
    if (provider) stats[3 + label]++;
  }
  return stats;
}

function placeGroups(groups, targets, random, seeds = []) {
  const assignments = PARTITIONS.map(() => []);
  const counts = PARTITIONS.map(zeroStats);
  const seeded = new Set();
  function assign(group, part) {
    assignments[part].push(group);
    for (let i = 0; i < STAT_COUNT; i++) counts[part][i] += group.stats[i];
  }
  seeds.forEach((subset, part) => {
    for (const group of subset) {
      assign(group, part);
      seeded.add(group);
    }
  });
  // Limited shortener groups get placed before ordinary groups of the same size.
  const order = shuffle(groups, random).sort((a, b) =>
    b.stats[0] - a.stats[0] || (b.stats[3] + b.stats[4]) - (a.stats[3] + a.stats[4]));
  for (const group of order) {
    if (seeded.has(group)) continue;
    let bestPart, bestCost = Infinity;
    // Ties between the two 15% partitions are seeded and deterministic.
    const first = Math.floor(random() * PARTITIONS.length);
    for (let offset = 0; offset < PARTITIONS.length; offset++) {
      const part = (first + offset) % PARTITIONS.length;
      let cost = 0;
      for (let i = 0; i < STAT_COUNT; i++) {
        const value = group.stats[i];
        const target = targets[part][i];
        const residual = counts[part][i] - target;
        const weight = i < 3 ? 1 : 0.35;
        cost += weight * value * (2 * residual + value) / Math.max(1, target);
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestPart = part;
      }
    }
    assign(group, bestPart);
  }
  if (counts.some((stats) => !stats[1] || !stats[2])) return null;
  const loss = counts.reduce((score, stats, part) =>
    score + stats.reduce((sum, count, i) =>
      sum + (i < 3 ? 1 : 0.35) * (count - targets[part][i]) ** 2 / Math.max(1, targets[part][i]), 0), 0);
  return { assignments, counts, loss };
}

function classSeeds(groups) {
  // Reserve small representative groups if the greedy allocation leaves any class absent.
  const mixed = [], benign = [], phishing = [];
  for (const group of groups) {
    const [, zero, one] = group.stats;
    (zero && one ? mixed : zero ? benign : phishing).push(group);
  }
  for (const subset of [mixed, benign, phishing])
    subset.sort((a, b) => a.stats[0] - b.stats[0]);
  return PARTITIONS.map((_, i) =>
    mixed[i] ? [mixed[i]] : [benign[i - mixed.length], phishing[i - mixed.length]]);
}

function auditPartitions(rows, partitions) {
  const fields = {
    domainConflicts: "domain",
    relatedConflicts: "related",
    normalizedConflicts: "normalized",
  };
  const counts = Object.fromEntries(Object.keys(fields).map((key) => [key, 0]));
  for (const [count, field] of Object.entries(fields)) {
    const used = new Map(), conflicts = new Set();
    PARTITIONS.forEach((name, part) => {
      for (const i of partitions[name]) {
        const value = rows[i][field];
        if (!used.has(value)) used.set(value, part);
        else if (used.get(value) !== part) conflicts.add(value);
      }
    });
    counts[count] = conflicts.size;
  }
  return { passed: Object.values(counts).every((count) => count === 0), ...counts };
}

export function splitAutomaticData({ rows, groups }) {
  if (!rows.length) throw new Error("Tidak ada URL valid untuk dibagi. Periksa laporan baris yang tidak dipakai.");
  const details = groups.map((indices) => ({ indices, stats: groupStats(indices, rows) }));
  const groupCountByLabel = [1, 2].map((label) =>
    details.filter((group) => group.stats[label]).length);
  if (groupCountByLabel.some((count) => count < 3)) {
    throw new Error("Setiap label membutuhkan setidaknya tiga kelompok domain terpisah agar tersedia di ketiga split.");
  }
  const totals = groupStats(rows.map((_, i) => i), rows);
  const targets = RATIOS.map((ratio) => totals.map((count) => count * ratio));
  const random = seededRandom(SPLIT_SEED);
  let best;
  for (let i = 0; i < 12; i++) {
    const attempt = placeGroups(details, targets, random);
    if (attempt && (!best || attempt.loss < best.loss)) best = attempt;
  }
  if (!best) best = placeGroups(details, targets, random, classSeeds(details));

  const partitions = {}, summary = {}, warnings = [];
  PARTITIONS.forEach((name, i) => {
    const assigned = best.assignments[i];
    partitions[name] = assigned.flatMap((group) => group.indices).sort((a, b) => a - b);
    const [count, benign, phishing, shortBenign, shortPhishing] = best.counts[i];
    const percent = count / rows.length * 100;
    const shorteners = shortBenign + shortPhishing;
    summary[name] = { rows: count, groups: assigned.length, benign, phishing, shorteners, percent };
    if (Math.abs(percent - RATIOS[i] * 100) > 5)
      warnings.push(`Proporsi ${name} menyimpang lebih dari 5 poin persentase dari target karena kelompok dipertahankan.`);
    if (Math.abs(phishing / count - totals[2] / rows.length) > 0.1)
      warnings.push(`Proporsi label phishing pada ${name} menyimpang lebih dari 10 poin persentase dari dataset.`);
    if (totals[3] + totals[4] > 0 && !shorteners)
      warnings.push(`Split ${name} tidak memiliki URL pendek teridentifikasi.`);
  });
  const indices = Object.values(partitions).flat();
  if (indices.length !== rows.length || new Set(indices).size !== rows.length)
    throw new Error("Audit gagal karena setiap record harus termasuk tepat satu split.");
  const audit = auditPartitions(rows, partitions);
  if (!audit.passed) throw new Error("Audit gagal karena URL atau domain terkait melintasi split.");
  return { ...partitions, seed: SPLIT_SEED, summary: { ...summary, audit, warnings } };
}
