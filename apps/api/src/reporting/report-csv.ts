// CSV serialization for report exports. Values are emitted exactly as the API reports
// them: decimal strings are never reparsed as numbers, so an exported figure is the
// same text the dashboard displayed. Cells that a spreadsheet would interpret as a
// formula are neutralized with a leading apostrophe.
const formulaStart = /^[=+\-@\t\r]/;
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : String(value);
  if (formulaStart.test(text)) text = "'" + text;
  const needsQuotes = /[",\r\n]/.test(text) || text !== text.trim();
  return needsQuotes ? '"' + text.replaceAll('"', '""') + '"' : text;
}
export function csvDocument(
  columns: readonly { key: string; header: string }[],
  rows: readonly Record<string, unknown>[],
): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(','));
  // CRLF line endings per RFC 4180; a trailing newline lets shells concatenate files.
  return lines.join('\r\n') + '\r\n';
}
export function csvFilename(base: string, fromDate: string, toDate: string): string {
  const safe = base.replaceAll(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `${safe}-${fromDate}-to-${toDate}.csv`;
}
