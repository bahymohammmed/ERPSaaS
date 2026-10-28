import { type AmountInput, roundToMinor } from './money';

/** Amount in words (تفقيط) for vouchers and cheques. */

const AR_UNITS = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const AR_TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

/** Scale words: [singular, dual, plural (3–10), accusative singular (11+)]. */
const AR_SCALES: [string, string, string, string][] = [
  ['', '', '', ''],
  ['ألف', 'ألفان', 'آلاف', 'ألف'],
  ['مليون', 'مليونان', 'ملايين', 'مليون'],
  ['مليار', 'ملياران', 'مليارات', 'مليار'],
];

const arBelowThousand = (n: number): string => {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(AR_HUNDREDS[hundreds] ?? '');
  if (rest >= 10 && rest < 20) parts.push(AR_TEENS[rest - 10] ?? '');
  else if (rest > 0) {
    const units = rest % 10;
    const tens = Math.floor(rest / 10);
    if (units && tens) parts.push(`${AR_UNITS[units]} و${AR_TENS[tens]}`);
    else if (tens) parts.push(AR_TENS[tens] ?? '');
    else parts.push(AR_UNITS[units] ?? '');
  }
  return parts.join(' و');
};

export const arabicNumberWords = (value: number): string => {
  if (value === 0) return 'صفر';
  const groups: string[] = [];
  let remaining = value;
  let scale = 0;
  while (remaining > 0) {
    const group = remaining % 1000;
    remaining = Math.floor(remaining / 1000);
    if (group > 0) {
      const words = AR_SCALES[scale];
      if (scale === 0 || !words) groups.unshift(arBelowThousand(group));
      else if (group === 1) groups.unshift(words[0]);
      else if (group === 2) groups.unshift(words[1]);
      else if (group <= 10) groups.unshift(`${arBelowThousand(group)} ${words[2]}`);
      else groups.unshift(`${arBelowThousand(group)} ${words[3]}`);
    }
    scale++;
  }
  return groups.join(' و');
};

const EN_SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion'];

const enBelowThousand = (n: number): string => {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${EN_SMALL[hundreds]} hundred`);
  if (rest > 0) {
    if (rest < 20) parts.push(EN_SMALL[rest] ?? '');
    else parts.push(rest % 10 ? `${EN_TENS[Math.floor(rest / 10)]}-${EN_SMALL[rest % 10]}` : (EN_TENS[rest / 10] ?? ''));
  }
  return parts.join(' and ');
};

export const englishNumberWords = (value: number): string => {
  if (value === 0) return 'zero';
  const groups: string[] = [];
  let remaining = value;
  let scale = 0;
  while (remaining > 0) {
    const group = remaining % 1000;
    remaining = Math.floor(remaining / 1000);
    if (group > 0) groups.unshift(`${enBelowThousand(group)}${EN_SCALES[scale] ? ` ${EN_SCALES[scale]}` : ''}`);
    scale++;
  }
  return groups.join(' ');
};

export type WordsCurrency = {
  minor_units: number;
  name_ar: string;
  name_en: string;
  minor_name_ar: string | null;
  minor_name_en: string | null;
};

/**
 * "فقط ألف وخمسمائة دينار كويتي ومائتان وخمسون فلس لا غير" /
 * "Only one thousand five hundred Kuwaiti Dinar and two hundred and fifty fils".
 */
export const amountInWords = (amount: AmountInput, currency: WordsCurrency, locale: 'ar' | 'en'): string => {
  const rounded = roundToMinor(amount, currency.minor_units).abs();
  const [intText = '0', fracText = ''] = rounded.toFixed(currency.minor_units).split('.');
  const major = Number(intText);
  const minor = fracText ? Number(fracText) : 0;
  if (!Number.isSafeInteger(major)) throw new Error('Amount too large for words');

  if (locale === 'ar') {
    let text = `فقط ${arabicNumberWords(major)} ${currency.name_ar}`;
    if (minor > 0 && currency.minor_name_ar) text += ` و${arabicNumberWords(minor)} ${currency.minor_name_ar}`;
    return `${text} لا غير`;
  }
  let text = `Only ${englishNumberWords(major)} ${currency.name_en}`;
  if (minor > 0 && currency.minor_name_en) text += ` and ${englishNumberWords(minor)} ${currency.minor_name_en}`;
  return text;
};
