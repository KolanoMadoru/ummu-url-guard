// Synthetic fixtures test upload/validation plumbing; they are not research evidence.
export function csvOfSize(
  bytes,
  rows = Math.max(100, Math.floor(bytes / 512)),
) {
  const header = "url,label,note\n";
  const prefixes = Array.from(
    { length: rows },
    (_, i) =>
      `https://group${i}.com/path?token=private,${i % 2 ? "phishing" : "benign"},`,
  );
  const minimum =
    header.length + prefixes.reduce((sum, p) => sum + p.length + 1, 0);
  if (bytes < minimum)
    throw new Error("Requested fixture is too small for these rows.");
  const padding = bytes - minimum,
    perRow = Math.floor(padding / rows),
    extra = padding % rows;
  return [
    header,
    ...prefixes.map(
      (p, i) => `${p}${"x".repeat(perRow + (i < extra ? 1 : 0))}\n`,
    ),
  ];
}
