import { Money } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { depreciationFor, lifeEnd, monthsBetween } from './depreciation';

const asset = (over: Partial<Parameters<typeof depreciationFor>[0]> = {}) => ({
  cost: '12000',
  residual_value: '0',
  method: 'STRAIGHT_LINE' as const,
  useful_life_months: 60,
  declining_rate: null,
  in_service_date: '2026-01-01',
  accumulated: new Money(0),
  ...over,
});

describe('depreciation maths', () => {
  it('counts months by days in each calendar month', () => {
    expect(monthsBetween('2026-01-01', '2026-03-31')).toBeCloseTo(3, 10);
    expect(monthsBetween('2026-04-16', '2026-04-30')).toBeCloseTo(0.5, 10);
    expect(monthsBetween('2026-01-16', '2026-01-31')).toBeCloseTo(16 / 31, 10);
    expect(monthsBetween('2026-02-01', '2026-01-31')).toBe(0);
  });

  it('straight line: equal monthly charges, part months pro rata, remainder in the last month', () => {
    expect(depreciationFor(asset(), '2026-01-01', '2026-01-31', 3).toFixed(3)).toBe('200.000');
    expect(depreciationFor(asset(), '2026-01-16', '2026-01-31', 3).toFixed(3)).toBe('103.226');
    expect(lifeEnd(asset())).toBe('2030-12-31');
    expect(depreciationFor(asset({ accumulated: new Money('11800.001') }), '2030-12-01', '2030-12-31', 3).toFixed(3)).toBe('199.999');
    expect(depreciationFor(asset({ accumulated: new Money('12000') }), '2031-01-01', '2031-01-31', 3).toFixed(3)).toBe('0.000');
  });

  it('respects residual value and declining balance', () => {
    expect(depreciationFor(asset({ residual_value: '2000' }), '2026-01-01', '2026-01-31', 3).toFixed(3)).toBe('166.667');
    const db = asset({ method: 'DECLINING_BALANCE', useful_life_months: null, declining_rate: '20', cost: '10000' });
    expect(depreciationFor(db, '2026-01-01', '2026-01-31', 3).toFixed(3)).toBe('166.667');
    expect(depreciationFor({ ...db, accumulated: new Money('5000') }, '2026-01-01', '2026-01-31', 3).toFixed(3)).toBe('83.333');
    expect(depreciationFor(asset({ method: 'NONE' }), '2026-01-01', '2026-12-31', 3).toFixed(3)).toBe('0.000');
  });
});
