'use client';

import { SegmentedControl } from '@mantine/core';
import { useI18n } from '@/i18n/i18n';

export const LanguageToggle = () => {
  const { locale, setLocale } = useI18n();
  return (
    <SegmentedControl
      size="xs"
      value={locale}
      onChange={(v) => setLocale(v === 'en' ? 'en' : 'ar')}
      data={[
        { value: 'ar', label: 'العربية' },
        { value: 'en', label: 'English' },
      ]}
    />
  );
};
