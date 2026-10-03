// Turning the Client Database's rows into a downloadable file: CSV, HTML table or JSON, in UTF-8 or UTF-16LE.
// Pure functions only (no React, no i18n - the caller hands in translated headers), so they can be checked on their own.

export type ExportFormat = 'csv' | 'html' | 'json';
/** utf8-bom is what Excel needs to read umlauts correctly; utf8 is for everything else (scripts choke on a BOM). */
export type ExportEncoding = 'utf8-bom' | 'utf8' | 'utf16le';
export type CsvDelimiter = ',' | ';' | '\t';
export type ExportDateFormat = 'iso-local' | 'iso-utc' | 'locale' | 'unix';

/**
 * number: a count or id; date: unix seconds; flag: a yes/no; text: server-made text (ids, addresses);
 * userText: text chosen by clients (nicknames, descriptions), the one kind a spreadsheet must not run as a formula.
 */
export type ExportCellKind = 'number' | 'date' | 'flag' | 'text' | 'userText';

export interface ExportColumn<T> {
  /** Stable property name in JSON. */
  key: string;
  /** Column header for CSV and HTML, already in the viewer's language. */
  header: string;
  kind: ExportCellKind;
  value: (row: T) => string | number | boolean;
}

export interface ExportOptions {
  format: ExportFormat;
  encoding: ExportEncoding;
  delimiter: CsvDelimiter;
  dateFormat: ExportDateFormat;
  /** The viewer's language (BCP 47), for the "locale" date format. */
  locale: string;
}

export interface ExportMeta {
  title: string;
  subtitle: string;
  /** Language of the HTML document. */
  lang: string;
}

export interface ExportFile {
  blob: Blob;
  extension: ExportFormat;
}

/** Spreadsheet programs that expect a semicolon between CSV fields because their decimal separator is a comma. */
const SEMICOLON_LANGUAGES = ['de', 'fr'];

export function defaultDelimiter(language: string): CsvDelimiter {
  return SEMICOLON_LANGUAGES.includes(language.toLowerCase().split('-')[0]) ? ';' : ',';
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A unix timestamp in the chosen format; an empty string when the server has no timestamp (0). */
export function formatExportDate(seconds: number, mode: ExportDateFormat, locale: string): string | number {
  if (!seconds) return '';
  const d = new Date(seconds * 1000);
  switch (mode) {
    case 'unix':
      return seconds;
    case 'iso-utc':
      return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    case 'iso-local':
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    case 'locale':
      return d.toLocaleString(locale);
  }
}

/** One cell as plain text (what CSV carries, and what HTML shows apart from flags). */
function cellText<T>(column: ExportColumn<T>, row: T, options: ExportOptions): string {
  const value = column.value(row);
  switch (column.kind) {
    case 'date': return String(formatExportDate(Number(value), options.dateFormat, options.locale));
    case 'flag': return value ? '1' : '0';
    default: return String(value);
  }
}

/** A cell that starts with one of these is read as a formula by spreadsheet programs. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(text: string, delimiter: CsvDelimiter, guardFormulas: boolean): string {
  // The usual defence: an apostrophe in front makes spreadsheets show the cell as plain text.
  let out = guardFormulas && FORMULA_START.test(text) ? `'${text}` : text;
  if (out.includes(delimiter) || /["\r\n]/.test(out)) out = `"${out.replace(/"/g, '""')}"`;
  return out;
}

export function buildCsv<T>(rows: T[], columns: ExportColumn<T>[], options: ExportOptions): string {
  const d = options.delimiter;
  // Headers are guarded too: a group's name, which an admin chose, is a header.
  const lines = [columns.map((c) => csvField(c.header, d, true)).join(d)];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(cellText(c, row, options), d, c.kind === 'userText')).join(d));
  }
  return lines.join('\r\n') + '\r\n';
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

const HTML_STYLE = [
  'body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;margin:24px;color:#1b1f24}',
  'h1{font-size:20px;margin:0 0 4px}',
  'p.meta{color:#5b6570;margin:0 0 16px}',
  'table{border-collapse:collapse;width:100%}',
  'th,td{border:1px solid #d0d7de;padding:5px 8px;text-align:left;vertical-align:top;word-break:break-word}',
  'th{background:#f3f5f7}',
  'tbody tr:nth-child(even) td{background:#fafbfc}',
  'td.num{text-align:right;font-variant-numeric:tabular-nums}',
  'td.flag{text-align:center}',
].join('');

export function buildHtml<T>(rows: T[], columns: ExportColumn<T>[], options: ExportOptions, meta: ExportMeta): string {
  const charset = options.encoding === 'utf16le' ? 'utf-16le' : 'utf-8';
  const head = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('');
  const body = rows.map((row) => {
    const cells = columns.map((c) => {
      if (c.kind === 'flag') return `<td class="flag">${c.value(row) ? '&#10003;' : ''}</td>`;
      const cls = c.kind === 'number' || c.kind === 'date' ? ' class="num"' : '';
      return `<td${cls}>${escapeHtml(cellText(c, row, options))}</td>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  });
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(meta.lang)}">`,
    '<head>',
    `<meta charset="${charset}">`,
    `<title>${escapeHtml(meta.title)}</title>`,
    `<style>${HTML_STYLE}</style>`,
    '</head>',
    '<body>',
    `<h1>${escapeHtml(meta.title)}</h1>`,
    `<p class="meta">${escapeHtml(meta.subtitle)}</p>`,
    `<table><thead><tr>${head}</tr></thead>`,
    `<tbody>${body.join('\n')}</tbody></table>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function buildJson<T>(rows: T[], columns: ExportColumn<T>[], options: ExportOptions): string {
  const items = rows.map((row) => {
    const item: Record<string, string | number | boolean> = {};
    for (const c of columns) {
      const value = c.value(row);
      item[c.key] = c.kind === 'date' ? formatExportDate(Number(value), options.dateFormat, options.locale) : value;
    }
    return item;
  });
  return JSON.stringify(items, null, 2) + '\n';
}

export function encodeText(text: string, encoding: ExportEncoding): Uint8Array<ArrayBuffer> {
  if (encoding === 'utf16le') {
    // BOM FF FE, then each UTF-16 code unit little-endian (surrogate pairs come out right because charCodeAt works in code units).
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), true);
    return bytes;
  }
  const utf8 = new TextEncoder().encode(text);
  if (encoding === 'utf8') return utf8;
  const bytes = new Uint8Array(3 + utf8.length);
  bytes.set([0xef, 0xbb, 0xbf], 0);
  bytes.set(utf8, 3);
  return bytes;
}

const MIME: Record<ExportFormat, string> = { csv: 'text/csv', html: 'text/html', json: 'application/json' };

export function buildExportFile<T>(rows: T[], columns: ExportColumn<T>[], options: ExportOptions, meta: ExportMeta): ExportFile {
  // JSON is always UTF-8 without a BOM: the spec forbids one and parsers do choke on it.
  const encoding: ExportEncoding = options.format === 'json' ? 'utf8' : options.encoding;
  const effective: ExportOptions = { ...options, encoding };
  const text =
    options.format === 'csv' ? buildCsv(rows, columns, effective)
    : options.format === 'html' ? buildHtml(rows, columns, effective, meta)
    : buildJson(rows, columns, effective);
  const charset = encoding === 'utf16le' ? 'utf-16le' : 'utf-8';
  return {
    blob: new Blob([encodeText(text, encoding)], { type: `${MIME[options.format]};charset=${charset}` }),
    extension: options.format,
  };
}

export function exportFilename(sid: number, extension: ExportFormat, now = new Date()): string {
  return `client-database-server-${sid}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${extension}`;
}

export function downloadExport(file: ExportFile, filename: string): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
