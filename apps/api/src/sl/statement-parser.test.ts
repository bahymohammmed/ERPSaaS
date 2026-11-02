import { describe, expect, it } from 'vitest';
import { parseAmount, parseCsv, parseDate, parseStatement } from './statement-parser';

describe('statement parser', () => {
  it('reads amounts in the formats banks export', () => {
    expect(parseAmount('1,234.500')).toBe('1234.500');
    expect(parseAmount('(12.5)')).toBe('-12.5');
    expect(parseAmount('12.5-')).toBe('-12.5');
    expect(parseAmount('-0012')).toBe('-12');
    expect(parseAmount('١٢٣٫٥')).toBe('123.5');
    expect(parseAmount('  ')).toBeNull();
    expect(() => parseAmount('abc')).toThrow();
  });

  it('reads day-first and ISO dates', () => {
    expect(parseDate('2026-03-05')).toBe('2026-03-05');
    expect(parseDate('05/03/2026')).toBe('2026-03-05');
    expect(parseDate('5.3.26')).toBe('2026-03-05');
    expect(() => parseDate('31/02/2026')).toThrow();
  });

  it('splits quoted CSV with the delimiter the header uses', () => {
    expect(parseCsv('a;b\n"x;y";"say ""hi"""\n')).toEqual([['a', 'b'], ['x;y', 'say "hi"']]);
  });

  it('accepts a signed amount column or Arabic headers', async () => {
    const lines = await parseStatement(Buffer.from('﻿التاريخ,البيان,سحب,إيداع\n01/04/2026,رسوم,1.000,\n02/04/2026,إيداع نقدي,,50\n'));
    expect(lines.map((l) => [l.date, l.amount])).toEqual([['2026-04-01', '-1.000'], ['2026-04-02', '50']]);
    const signed = await parseStatement(Buffer.from('date,amount,details\n2026-04-03,-7.25,ATM\n'));
    expect(signed[0]).toMatchObject({ amount: '-7.25', description: 'ATM' });
  });
});
