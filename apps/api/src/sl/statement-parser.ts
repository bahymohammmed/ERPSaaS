import ExcelJS from 'exceljs';
import { AppError } from '../common/app-error';

/** One bank statement line; amount is in the account's currency, positive = money in. */
export type StatementLine = { line_no: number; date: string; description: string; reference: string | null; amount: string };

const ALIASES: Record<string, string[]> = {
  date: ['date', 'transaction date', 'value date', 'posting date', 'التاريخ', 'تاريخ', 'تاريخ العملية', 'تاريخ القيد'],
  description: ['description', 'details', 'narrative', 'particulars', 'memo', 'البيان', 'الوصف', 'التفاصيل'],
  reference: ['reference', 'ref', 'ref.', 'cheque', 'cheque no', 'check no', 'المرجع', 'رقم الشيك'],
  amount: ['amount', 'المبلغ'],
  out: ['debit', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'مدين', 'سحب', 'مسحوبات'],
  in: ['credit', 'deposit', 'deposits', 'money in', 'paid in', 'دائن', 'إيداع', 'ايداع', 'إيداعات'],
};

const ARABIC_DIGITS = /[٠-٩]/g;
const normalizeDigits = (v: string) => v.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.').replace(/٬/g, ',');

/** "1,234.50", "(1,234.50)", "-1234.5", "1234.50-" → signed decimal string, or null when blank. */
export const parseAmount = (raw: string): string | null => {
  let v = normalizeDigits(raw).trim().replace(/[\s,]/g, '').replace(/(\d)[A-Za-z]{3}$/, '$1');
  if (!v) return null;
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  if (v.endsWith('-')) {
    negative = true;
    v = v.slice(0, -1);
  }
  if (v.startsWith('-')) {
    negative = !negative;
    v = v.slice(1);
  }
  if (v.startsWith('+')) v = v.slice(1);
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`invalid amount "${raw}"`);
  const [whole = '0', frac = ''] = v.split('.');
  const fixed = `${whole.replace(/^0+(?=\d)/, '')}${frac ? `.${frac.slice(0, 4)}` : ''}`;
  return negative && Number(fixed) !== 0 ? `-${fixed}` : fixed;
};

/** YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (day first, as Kuwaiti banks print them). */
export const parseDate = (raw: string): string => {
  const v = normalizeDigits(raw).trim();
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(v);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(v);
    if (!match) throw new Error(`invalid date "${raw}"`);
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new Error(`invalid date "${raw}"`);
  return date.toISOString().slice(0, 10);
};

/** Splits CSV text, honouring quotes; the delimiter is whichever of , ; or tab the header uses most. */
export const parseCsv = (text: string): string[][] => {
  const body = text.replace(/^﻿/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].map((c) => ({ c, n: firstLine.split(c).length })).sort((a, b) => b.n - a.n)[0]?.c ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
};

const readXlsx = async (file: Buffer): Promise<string[][]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      const cell = row.getCell(c);
      cells.push(cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : typeof cell.value === 'number' ? String(cell.value) : cell.text);
    }
    rows.push(cells);
  });
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
};

/**
 * Reads a bank statement export (CSV or Excel). The header row may sit below a few title rows;
 * amounts come either from one signed column or from separate withdrawal / deposit columns.
 */
export const parseStatement = async (file: Buffer): Promise<StatementLine[]> => {
  let grid: string[][];
  try {
    grid = file.subarray(0, 2).toString('latin1') === 'PK' ? await readXlsx(file) : parseCsv(file.toString('utf8'));
  } catch (error) {
    throw new AppError('IMPORT_FILE_INVALID', { reason: (error as Error).message });
  }
  const find = (header: string[], key: string) => header.findIndex((h) => ALIASES[key]?.includes(h));
  const headerIndex = grid.slice(0, 20).findIndex((r) => {
    const h = r.map((c) => c.trim().toLowerCase());
    return find(h, 'date') >= 0 && (find(h, 'amount') >= 0 || (find(h, 'in') >= 0 && find(h, 'out') >= 0));
  });
  if (headerIndex < 0) throw new AppError('IMPORT_FILE_INVALID', { reason: 'no header row with date and amount (or debit / credit) columns' });
  const header = (grid[headerIndex] ?? []).map((c) => c.trim().toLowerCase());
  const col = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, find(header, k)])) as Record<keyof typeof ALIASES, number>;
  const lines: StatementLine[] = [];
  for (const [i, r] of grid.slice(headerIndex + 1).entries()) {
    const cell = (k: string) => (col[k] !== undefined && col[k] >= 0 ? (r[col[k]] ?? '').trim() : '');
    if (!cell('date')) continue;
    const rowNo = headerIndex + i + 2;
    try {
      let amount: string | null;
      if (col.amount !== undefined && col.amount >= 0) amount = parseAmount(cell('amount'));
      else {
        const inAmt = parseAmount(cell('in'));
        const outAmt = parseAmount(cell('out'));
        amount = inAmt && Number(inAmt) !== 0 ? inAmt : outAmt && Number(outAmt) !== 0 ? (outAmt.startsWith('-') ? outAmt.slice(1) : `-${outAmt}`) : null;
      }
      if (!amount || Number(amount) === 0) continue;
      lines.push({ line_no: lines.length + 1, date: parseDate(cell('date')), description: cell('description').slice(0, 500), reference: cell('reference').slice(0, 100) || null, amount });
    } catch (error) {
      throw new AppError('IMPORT_FILE_INVALID', { reason: `row ${rowNo}: ${(error as Error).message}` });
    }
  }
  if (!lines.length) throw new AppError('IMPORT_FILE_INVALID', { reason: 'no statement lines' });
  if (lines.length > 5000) throw new AppError('IMPORT_FILE_INVALID', { reason: 'more than 5000 rows' });
  return lines;
};
