'use client';

import { Badge, Group, Select, type SelectProps, Text, Title } from '@mantine/core';
import type { JournalStatus, PeriodStatus } from '@erp/shared';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useI18n } from '@/i18n/i18n';
import { useAccounts, useCostCenters } from '@/lib/queries';
import { toTreeRows } from '@/lib/tree';

export const PageHeader = ({ title, actions, subtitle }: { title: string; actions?: ReactNode; subtitle?: ReactNode }) => (
  <Group justify="space-between" mb="md" align="flex-end" wrap="wrap">
    <div>
      <Title order={3}>{title}</Title>
      {subtitle && (
        <Text c="dimmed" size="sm">
          {subtitle}
        </Text>
      )}
    </div>
    {actions && <Group gap="xs">{actions}</Group>}
  </Group>
);

const STATUS_COLORS: Record<JournalStatus | PeriodStatus, string> = {
  DRAFT: 'gray',
  SUBMITTED: 'yellow',
  APPROVED: 'blue',
  POSTED: 'teal',
  REVERSED: 'red',
  OPEN: 'teal',
  CLOSED: 'orange',
  LOCKED: 'red',
};

export const StatusBadge = ({ status }: { status: JournalStatus | PeriodStatus }) => {
  const { t } = useI18n();
  return (
    <Badge color={STATUS_COLORS[status]} variant="light">
      {t(`status${status}`)}
    </Badge>
  );
};

type PickerProps = Omit<SelectProps, 'data'> & { postingOnly?: boolean; activeOnly?: boolean };

/** Account picker: searchable by code or name in both languages. */
export const AccountSelect = ({ postingOnly = true, activeOnly = true, ...props }: PickerProps) => {
  const { name } = useI18n();
  const { data = [] } = useAccounts();
  const options = useMemo(
    () =>
      toTreeRows(data)
        .filter((a) => (!postingOnly || a.is_posting) && (!activeOnly || a.is_active))
        .map((a) => ({ value: a.id, label: `${a.code} — ${name(a)}` })),
    [data, postingOnly, activeOnly, name],
  );
  return <Select searchable clearable limit={80} data={options} nothingFoundMessage="—" {...props} />;
};

export const CostCenterSelect = ({ postingOnly = true, activeOnly = true, ...props }: PickerProps) => {
  const { name } = useI18n();
  const { data = [] } = useCostCenters();
  const options = useMemo(
    () =>
      toTreeRows(data)
        .filter((c) => (!postingOnly || c.is_posting) && (!activeOnly || c.is_active))
        .map((c) => ({ value: c.id, label: `${'  '.repeat(c.depth)}${c.code} — ${name(c)}` })),
    [data, postingOnly, activeOnly, name],
  );
  return <Select searchable clearable limit={80} data={options} nothingFoundMessage="—" {...props} />;
};

export const Amount = ({ value, minor }: { value: string | null | undefined; minor: number }) => {
  const { amount } = useI18n();
  return <span className="num">{amount(value, minor, { blankZero: true })}</span>;
};
