/**
 * Presentation-neutral report model. The API builds it once; the web UI,
 * the PDF renderer and the Excel exporter all render from it.
 */
export type BilingualText = { ar: string; en: string };

export type ReportColumn = {
  key: string;
  label: BilingualText;
  kind: 'text' | 'bilingual' | 'amount' | 'date' | 'rate';
  /** Minor units for amount columns; defaults to the document currency. */
  minorUnits?: number;
  width?: number;
};

export type ReportCellValue = string | BilingualText | null;

export type ReportRow = {
  cells: Record<string, ReportCellValue>;
  /** Indentation level for hierarchical rows (0 = top). */
  level?: number;
  style?: 'normal' | 'header' | 'subtotal' | 'total' | 'grandTotal' | 'section';
  /** Optional drill-down target understood by the web client. */
  drill?: { kind: 'account' | 'entry' | 'costCenter'; id: string };
};

export type ReportDocument = {
  reportKey: string;
  title: BilingualText;
  company: BilingualText;
  subtitle: BilingualText[];
  currency: string;
  minorUnits: number;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Footnotes / checks, e.g. "Balanced" or warnings. */
  notes: BilingualText[];
  generatedAt: string;
};

export const pickText = (value: BilingualText | string | null | undefined, locale: 'ar' | 'en'): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return (locale === 'ar' ? value.ar || value.en : value.en || value.ar) ?? '';
};
