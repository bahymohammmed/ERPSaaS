import Decimal from 'decimal.js';

/**
 * Money is never represented as a JS number. Amounts travel as decimal strings
 * (exactly as PostgreSQL NUMERIC returns them) and are computed with Decimal.
 */
export const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type MoneyValue = InstanceType<typeof Money>;

export type AmountInput = string | MoneyValue;

/** Storage scale of every amount column (NUMERIC(19,4)). */
export const STORAGE_SCALE = 4;
/** Storage scale of exchange rates (NUMERIC(18,8)). */
export const RATE_SCALE = 8;

export const toMoney = (value: AmountInput | null | undefined): MoneyValue =>
  value === null || value === undefined || value === '' ? new Money(0) : new Money(value);

export const roundToMinor = (value: AmountInput, minorUnits: number): MoneyValue =>
  toMoney(value).toDecimalPlaces(minorUnits, Money.ROUND_HALF_UP);

/** Converts a transaction-currency amount to base currency, rounded to base minor units. */
export const convertToBase = (amount: AmountInput, rate: AmountInput, baseMinorUnits: number): MoneyValue =>
  roundToMinor(toMoney(amount).times(toMoney(rate)), baseMinorUnits);

/** Serialises an amount for the database / API at storage scale. */
export const toStorage = (value: AmountInput): string => toMoney(value).toFixed(STORAGE_SCALE);

export const sumAmounts = (values: readonly AmountInput[]): MoneyValue =>
  values.reduce<MoneyValue>((acc, v) => acc.plus(toMoney(v)), new Money(0));

/** True when the value has no more decimals than the currency allows. */
export const fitsMinorUnits = (value: AmountInput, minorUnits: number): boolean =>
  toMoney(value).decimalPlaces() <= minorUnits;

export type FormatAmountOptions = {
  minorUnits: number;
  locale?: 'ar' | 'en';
  digits?: 'latn' | 'arab';
  /** Show negatives in parentheses (accounting style). Default true. */
  parentheses?: boolean;
  /** Render zero as an empty string. */
  blankZero?: boolean;
};

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export const formatAmount = (value: AmountInput | null | undefined, options: FormatAmountOptions): string => {
  const amount = roundToMinor(toMoney(value), options.minorUnits);
  if (amount.isZero() && options.blankZero) return '';
  const [intPart = '0', fracPart] = amount.abs().toFixed(options.minorUnits).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let text = fracPart ? `${grouped}.${fracPart}` : grouped;
  if (options.digits === 'arab') {
    text = text.replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)] ?? d).replace(/,/g, '٬').replace(/\./g, '٫');
  }
  if (amount.isNegative()) return options.parentheses === false ? `-${text}` : `(${text})`;
  return text;
};
