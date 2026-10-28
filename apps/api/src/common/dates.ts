/** Calendar-date helpers on 'YYYY-MM-DD' strings (no timezone involvement). */

const toUtc = (date: string): Date => new Date(`${date}T00:00:00Z`);
const fromUtc = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (date: string, days: number): string => {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
};

export const addMonths = (date: string, months: number): string => {
  const d = toUtc(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return fromUtc(d);
};

export const monthIndex = (date: string): number => toUtc(date).getUTCMonth();
export const yearOf = (date: string): number => toUtc(date).getUTCFullYear();
export const today = (): string => new Date().toISOString().slice(0, 10);

export const MONTH_NAMES_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
