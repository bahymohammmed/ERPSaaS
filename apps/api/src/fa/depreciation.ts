import { Money, type MoneyValue, roundToMinor, toMoney } from '@erp/shared';
import { addDays, addMonths } from '../common/dates';

const toUtc = (date: string) => new Date(`${date}T00:00:00Z`);
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * Months covered by [from, to] (both inclusive), each calendar month counted by its share of
 * days: 1 Jan–31 Mar = 3, 16–30 Apr = 0.5.
 */
export const monthsBetween = (from: string, to: string): number => {
  if (to < from) return 0;
  let months = 0;
  let cursor = toUtc(from);
  const end = toUtc(to);
  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const monthEnd = new Date(Date.UTC(year, month + 1, 0));
    const stop = monthEnd < end ? monthEnd : end;
    const days = (stop.getTime() - cursor.getTime()) / 86_400_000 + 1;
    months += days / daysInMonth(year, month);
    cursor = new Date(Date.UTC(year, month + 1, 1));
  }
  return months;
};

export type DepreciableAsset = {
  cost: string;
  residual_value: string;
  method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'NONE';
  useful_life_months: number | null;
  declining_rate: string | null;
  in_service_date: string;
  /** Accumulated depreciation before this charge. */
  accumulated: MoneyValue;
};

/** Last day of the useful life for straight-line assets. */
export const lifeEnd = (asset: Pick<DepreciableAsset, 'in_service_date' | 'useful_life_months'>): string | null =>
  asset.useful_life_months ? addDays(addMonths(asset.in_service_date, asset.useful_life_months), -1) : null;

/**
 * Depreciation for [from, to], rounded to the currency and never taking accumulated
 * depreciation past cost less residual value.
 * - Straight line: (cost − residual) / useful life per month; the month the life ends takes the remainder.
 * - Declining balance: net book value × annual rate / 12 per month.
 */
export const depreciationFor = (asset: DepreciableAsset, from: string, to: string, minorUnits: number): MoneyValue => {
  if (asset.method === 'NONE' || to < from) return new Money(0);
  const depreciable = toMoney(asset.cost).minus(asset.residual_value);
  const remaining = depreciable.minus(asset.accumulated);
  if (remaining.lte(0)) return new Money(0);
  const months = String(monthsBetween(from, to));
  let amount: MoneyValue;
  if (asset.method === 'STRAIGHT_LINE') {
    const end = lifeEnd(asset);
    if (end && to >= end) return remaining;
    amount = depreciable.div(asset.useful_life_months ?? 1).times(months);
  } else {
    const nbv = toMoney(asset.cost).minus(asset.accumulated);
    amount = nbv.times(asset.declining_rate ?? '0').div(100).div(12).times(months);
  }
  const rounded = roundToMinor(amount, minorUnits);
  return rounded.gt(remaining) ? remaining : rounded;
};
