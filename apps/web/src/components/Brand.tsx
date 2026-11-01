import { Group, Text } from '@mantine/core';

/** Product mark: a ledger page with a balance tick. */
export const LogoMark = ({ size = 30 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id="erp-mark" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="var(--mantine-color-brand-5)" />
        <stop offset="1" stopColor="var(--mantine-color-brand-9)" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="url(#erp-mark)" />
    <path d="M9 10.5h14M9 15.5h9M9 20.5h6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M18.5 21l2.3 2.3 4.2-5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Brand = ({ name, compact = false }: { name: string; compact?: boolean }) => (
  <Group gap={10} wrap="nowrap">
    <LogoMark />
    {!compact && (
      <Text fw={700} size="md" style={{ letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
        {name}
      </Text>
    )}
  </Group>
);
