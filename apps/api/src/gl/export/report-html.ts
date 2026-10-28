import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type DigitStyle,
  formatAmount,
  pickText,
  type ReportCellValue,
  type ReportColumn,
  type ReportDocument,
  type ReportLanguage,
} from '@erp/shared';

const FONT_DIR = join(dirname(require.resolve('@fontsource/ibm-plex-sans-arabic/package.json')), 'files');

let fontCss: string | null = null;
/** Fonts are embedded so PDF rendering never depends on network or system fonts. */
const embeddedFonts = (): string => {
  if (fontCss) return fontCss;
  const faces: string[] = [];
  for (const subset of ['arabic', 'latin'] as const) {
    for (const weight of [400, 600]) {
      const data = readFileSync(join(FONT_DIR, `ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`)).toString('base64');
      faces.push(`@font-face{font-family:'Plex Arabic';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${data}) format('woff2');}`);
    }
  }
  fontCss = faces.join('\n');
  return fontCss;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

type RenderedColumn = { column: ReportColumn; locale?: 'ar' | 'en'; label: string };

/** Expands bilingual columns into separate Arabic and English columns in "both" mode. */
export const layoutColumns = (doc: ReportDocument, lang: ReportLanguage): RenderedColumn[] => {
  const label = (c: ReportColumn) => (lang === 'both' ? `${c.label.ar} / ${c.label.en}` : pickText(c.label, lang));
  return doc.columns.flatMap((column): RenderedColumn[] => {
    if (column.kind === 'bilingual' && lang === 'both') {
      return [
        { column, locale: 'ar', label: column.label.ar },
        { column, locale: 'en', label: column.label.en },
      ];
    }
    return [{ column, locale: lang === 'both' ? undefined : lang, label: label(column) }];
  });
};

export const cellText = (value: ReportCellValue | undefined, rc: RenderedColumn, doc: ReportDocument, lang: ReportLanguage, digits: DigitStyle): string => {
  if (value === null || value === undefined) return '';
  if (rc.column.kind === 'amount') {
    if (typeof value !== 'string') return '';
    return formatAmount(value, { minorUnits: rc.column.minorUnits ?? doc.minorUnits, digits: lang === 'en' ? 'latn' : digits });
  }
  if (typeof value === 'string') return value;
  if (rc.locale) return pickText(value, rc.locale);
  return lang === 'both' ? `${value.ar} / ${value.en}` : pickText(value, lang);
};

export const renderReportHtml = (doc: ReportDocument, lang: ReportLanguage, digits: DigitStyle = 'latn'): string => {
  const rtl = lang !== 'en';
  // English inside an RTL page is isolated so trailing punctuation stays where it belongs.
  const text = (v: { ar: string; en: string }) =>
    lang === 'both'
      ? `${escapeHtml(v.ar)}<br><span class="en" dir="ltr">${escapeHtml(v.en)}</span>`
      : `<span dir="${lang === 'en' ? 'ltr' : 'rtl'}">${escapeHtml(pickText(v, lang))}</span>`;
  const columns = layoutColumns(doc, lang);

  const head = columns
    .map((rc) => `<th class="${rc.column.kind}${rc.locale === 'en' && lang === 'both' ? ' en-col' : ''}">${escapeHtml(rc.label)}</th>`)
    .join('');
  const body = doc.rows
    .map((row) => {
      const cells = columns
        .map((rc) => {
          const raw = row.cells[rc.column.key];
          const content = escapeHtml(cellText(raw, rc, doc, lang, digits));
          const indent = rc.column.kind === 'bilingual' && row.level ? ` style="padding-inline-start:${6 + row.level * 14}px"` : '';
          // Numbers, codes and English are isolated LTR runs; the cell keeps the page direction for alignment.
          const isolated = rc.column.kind === 'amount' || rc.column.kind === 'date' || rc.column.key === 'code' || rc.locale === 'en';
          const classes = rc.locale === 'en' && lang === 'both' ? `${rc.column.kind} en-col` : rc.column.kind;
          return `<td class="${classes}"${indent}><bdi dir="${isolated ? 'ltr' : 'auto'}">${content}</bdi></td>`;
        })
        .join('');
      return `<tr class="${row.style ?? 'normal'}">${cells}</tr>`;
    })
    .join('\n');

  const subtitle = doc.subtitle.map((s) => `<div>${text(s)}</div>`).join('');
  const notes = doc.notes.map((n) => `<li>${text(n)}</li>`).join('');
  const generated = new Date(doc.generatedAt).toISOString().replace('T', ' ').slice(0, 16);

  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'ar'}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(pickText(doc.title, lang === 'en' ? 'en' : 'ar'))}</title>
<style>
${embeddedFonts()}
@page { size: A4 ${columns.length > 7 ? 'landscape' : 'portrait'}; margin: 14mm 10mm 16mm; }
* { box-sizing: border-box; }
body { font-family: 'Plex Arabic', sans-serif; font-size: 9pt; color: #1b1f24; margin: 0; }
header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1f4e79; padding-bottom: 6px; margin-bottom: 8px; }
.company { font-size: 13pt; font-weight: 600; }
.title { font-size: 12pt; font-weight: 600; color: #1f4e79; }
.subtitle { color: #4a5560; font-size: 8.5pt; }
.en { color: #4a5560; font-size: 0.92em; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { background: #eef3f8; border-bottom: 1px solid #9fb3c8; font-weight: 600; padding: 4px 6px; text-align: start; vertical-align: bottom; }
th.amount { text-align: end; }
td { padding: 3px 6px; border-bottom: 1px solid #e3e7eb; vertical-align: top; }
td.amount { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.date { white-space: nowrap; }
.en-col { text-align: left; }
tr { page-break-inside: avoid; }
tr.header td { font-weight: 600; }
tr.section td { font-weight: 600; background: #f6f8fa; border-top: 1px solid #c9d3dd; }
tr.subtotal td { font-weight: 600; border-top: 1px solid #9fb3c8; }
tr.total td, tr.grandTotal td { font-weight: 600; border-top: 1.5px solid #1f4e79; border-bottom: 3px double #1f4e79; background: #eef3f8; }
ul.notes { margin: 10px 0 0; padding-inline-start: 16px; color: #4a5560; font-size: 8pt; }
footer { margin-top: 8px; color: #8792a0; font-size: 7.5pt; }
</style>
</head>
<body>
<header>
  <div><div class="company">${text(doc.company)}</div><div class="subtitle">${subtitle}</div></div>
  <div class="title">${text(doc.title)}</div>
</header>
<table>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table>
<ul class="notes">${notes}</ul>
<footer dir="ltr">${escapeHtml(generated)} UTC</footer>
</body>
</html>`;
};
