import { Group, Text } from '@mantine/core';
import { BRAND } from '@erp/shared';

/** Product mark: a diwan archway over ledger lines. */
export const LogoMark = ({ size = 30 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id="erp-mark" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="var(--mantine-color-brand-5)" />
        <stop offset="1" stopColor="var(--mantine-color-brand-9)" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="url(#erp-mark)" />
    {/* Pointed arch, as in a majlis doorway */}
    <path d="M8.5 25V15.5C8.5 11 12 7.6 16 6c4 1.6 7.5 5 7.5 9.5V25" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12.5 17.5h7M12.5 21.5h4.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

/**
 * Bilingual wordmark: both scripts are always shown, the one for the current language first,
 * so the name reads the same to Arabic and English speakers.
 */
export const Brand = ({ compact = false, inverse = false }: { name?: string; compact?: boolean; inverse?: boolean }) => (
  <Group gap={10} wrap="nowrap">
    <LogoMark />
    {!compact && (
      <Group gap={8} wrap="nowrap" align="baseline">
        <Text fw={800} size="lg" style={{ letterSpacing: '-0.01em', whiteSpace: 'nowrap' }} className="ltr">
          {BRAND.name_en}
        </Text>
        <Text fw={600} size="md" c={inverse ? undefined : 'brand'} style={{ whiteSpace: 'nowrap', fontFamily: 'var(--mantine-font-family)' }} dir="rtl">
          {BRAND.name_ar}
        </Text>
      </Group>
    )}
  </Group>
);
