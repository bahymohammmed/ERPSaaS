'use client';

import { DirectionProvider, useDirection } from '@mantine/core';
import { type AmountInput, type DigitStyle, formatAmount, type Locale, translateError } from '@erp/shared';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { MESSAGES, type MessageKey } from './messages';

type I18n = {
  locale: Locale;
  digits: DigitStyle;
  setLocale: (locale: Locale) => void;
  setDigits: (digits: DigitStyle) => void;
  t: (key: MessageKey) => string;
  /** Picks the localized name with fallback to the other language. */
  name: (row: { name_ar?: string | null; name_en?: string | null } | null | undefined) => string;
  amount: (value: AmountInput | null | undefined, minorUnits: number, options?: { blankZero?: boolean }) => string;
  errorText: (error: unknown) => string;
};

const I18nContext = createContext<I18n | null>(null);
export const LOCALE_COOKIE = 'erp_locale';

const DirectionSync = ({ locale }: { locale: Locale }) => {
  const { setDirection } = useDirection();
  useEffect(() => {
    const dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.dir = dir;
    document.documentElement.lang = locale;
    setDirection(dir);
  }, [locale, setDirection]);
  return null;
};

export const I18nProvider = ({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) => {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [digits, setDigitsState] = useState<DigitStyle>('latn');

  const setLocale = useCallback((next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setLocaleState(next);
  }, []);

  const setDigits = useCallback((next: DigitStyle) => setDigitsState(next), []);

  const value = useMemo<I18n>(() => {
    const messages = MESSAGES[locale];
    return {
      locale,
      digits,
      setLocale,
      setDigits,
      t: (key) => messages[key] ?? key,
      name: (row) => (locale === 'ar' ? row?.name_ar || row?.name_en : row?.name_en || row?.name_ar) ?? '',
      amount: (value, minorUnits, options) =>
        formatAmount(value, { minorUnits, digits: locale === 'ar' ? digits : 'latn', blankZero: options?.blankZero }),
      errorText: (error) => {
        if (error instanceof ApiError) {
          const base = translateError(error.code, locale, error.params);
          return error.issues.length ? `${base}: ${error.issues.map((i) => `${i.path} — ${i.message}`).join('; ')}` : base;
        }
        return translateError('INTERNAL', locale);
      },
    };
  }, [locale, digits, setLocale, setDigits]);

  return (
    <DirectionProvider initialDirection={initialLocale === 'ar' ? 'rtl' : 'ltr'} detectDirection={false}>
      <DirectionSync locale={locale} />
      <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
    </DirectionProvider>
  );
};

export const useI18n = (): I18n => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
};
