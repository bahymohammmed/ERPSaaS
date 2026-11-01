'use client';

import { Center, Skeleton, Stack, Table, Text, ThemeIcon } from '@mantine/core';
import { IconInbox } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/i18n/i18n';

/** Friendly placeholder for an empty list, with an optional call to action. */
export const EmptyState = ({ title, hint, action }: { title?: string; hint?: string; action?: ReactNode }) => {
  const { t } = useI18n();
  return (
    <Center py="xl" style={{ animation: 'fade-in 300ms var(--ease-out)' }}>
      <Stack align="center" gap={6}>
        <ThemeIcon variant="light" size={48} radius="xl">
          <IconInbox size={24} />
        </ThemeIcon>
        <Text fw={600}>{title ?? t('emptyTitle')}</Text>
        <Text size="sm" c="dimmed" ta="center" maw={360}>
          {hint ?? t('emptyHint')}
        </Text>
        {action}
      </Stack>
    </Center>
  );
};

/** Shimmering placeholder rows while a table loads. */
export const TableSkeletonRows = ({ cols, rows = 6 }: { cols: number; rows?: number }) => (
  <>
    {Array.from({ length: rows }, (_, r) => (
      <Table.Tr key={r}>
        {Array.from({ length: cols }, (_, c) => (
          <Table.Td key={c}>
            <Skeleton height={12} radius="sm" width={c === 0 ? '60%' : `${55 + ((r * 7 + c * 13) % 40)}%`} />
          </Table.Td>
        ))}
      </Table.Tr>
    ))}
  </>
);

/** Empty-state row spanning a whole table. */
export const EmptyRow = ({ cols, action }: { cols: number; action?: ReactNode }) => (
  <Table.Tr>
    <Table.Td colSpan={cols}>
      <EmptyState action={action} />
    </Table.Td>
  </Table.Tr>
);
