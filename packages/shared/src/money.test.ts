import { describe, expect, it } from 'vitest';
import { convertToBase, fitsMinorUnits, formatAmount, roundToMinor, sumAmounts, toStorage } from './money';

describe('money', () => {
  it('rounds KWD to 3 decimals half-up', () => {
    expect(roundToMinor('1.2345', 3).toFixed(3)).toBe('1.235');
    expect(roundToMinor('1.2344', 3).toFixed(3)).toBe('1.234');
  });

  it('converts USD to KWD at a fils precision', () => {
    expect(convertToBase('1000.00', '0.30715', 3).toFixed(3)).toBe('307.150');
    expect(convertToBase('33.33', '0.307155', 3).toFixed(3)).toBe('10.237');
  });

  it('sums without floating point drift', () => {
    expect(sumAmounts(['0.1', '0.2']).toString()).toBe('0.3');
    expect(toStorage(sumAmounts(['0.001', '0.002']))).toBe('0.0030');
  });

  it('validates minor units', () => {
    expect(fitsMinorUnits('1.123', 3)).toBe(true);
    expect(fitsMinorUnits('1.1234', 3)).toBe(false);
    expect(fitsMinorUnits('1.10', 2)).toBe(true);
  });

  it('formats accounting style in latin and arabic digits', () => {
    expect(formatAmount('-1234567.5', { minorUnits: 3 })).toBe('(1,234,567.500)');
    expect(formatAmount('1500', { minorUnits: 3, digits: 'arab' })).toBe('١٬٥٠٠٫٠٠٠');
    expect(formatAmount('0', { minorUnits: 3, blankZero: true })).toBe('');
  });
});
