'use client';

import { Button, Group, Table, Text, TextInput } from '@mantine/core';
import type { LedgerSide } from '@erp/shared';
import { useI18n } from '@/i18n/i18n';
import { useCompanyQuery } from '@/lib/queries';
import { Amount } from '@/components/common';
import { EmptyState } from '@/components/states';
import type { PartyDocument } from './config';

export type AllocationMap = Record<string, string>;

/** Open invoices of a party with an amount to apply to each; "apply oldest first" fills them in order. */
export const AllocationTable = ({ side, partyId, total, value, onChange, minor }: { side: LedgerSide; partyId: string | null; total: number; value: AllocationMap; onChange: (v: AllocationMap) => void; minor: number }) => {
  const { t } = useI18n();
  const { data = [] } = useCompanyQuery<PartyDocument[]>(['sl-open', side, partyId], `/sl/${side}/documents`, { party_id: partyId ?? undefined, open: 'true' });
  const invoices = partyId ? [...data].sort((a, b) => a.due_date.localeCompare(b.due_date)) : [];
  const applied = Object.values(value).reduce((acc, v) => acc + (Number(v) || 0), 0);

  const auto = () => {
    let rest = total;
    const next: AllocationMap = {};
    for (const inv of invoices) {
      if (rest <= 0) break;
      const amount = Math.min(rest, Number(inv.open_amount));
      next[inv.id] = amount.toFixed(minor);
      rest = Number((rest - amount).toFixed(minor));
    }
    onChange(next);
  };

  if (!partyId) return null;
  if (invoices.length === 0) return <EmptyState hint={t('applyTo')} />;
  return (
    <div>
      <Group justify="space-between" mb="xs">
        <Text fw={600} size="sm">
          {t('applyTo')}
        </Text>
        <Group gap="md">
          <Text size="sm" c={applied > total + 1e-9 ? 'red' : 'dimmed'} className="num">
            {t('applied')}: {applied.toFixed(minor)} · {t('unallocated')}: {(total - applied).toFixed(minor)}
          </Text>
          <Button size="xs" variant="light" onClick={auto} disabled={total <= 0}>
            {t('autoAllocate')}
          </Button>
        </Group>
      </Group>
      <Table.ScrollContainer minWidth={560}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('documentNo')}</Table.Th>
              <Table.Th>{t('date')}</Table.Th>
              <Table.Th>{t('dueDate')}</Table.Th>
              <Table.Th style={{ textAlign: 'end' }}>{t('openAmount')}</Table.Th>
              <Table.Th style={{ width: 160 }}>{t('applied')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {invoices.map((inv) => (
              <Table.Tr key={inv.id}>
                <Table.Td className="ltr">{inv.doc_no}</Table.Td>
                <Table.Td className="num">{inv.doc_date}</Table.Td>
                <Table.Td className="num">{inv.due_date}</Table.Td>
                <Table.Td className="amount-cell">
                  <Amount value={inv.open_amount} minor={minor} />
                </Table.Td>
                <Table.Td>
                  <TextInput
                    size="xs"
                    classNames={{ input: 'num' }}
                    inputMode="decimal"
                    value={value[inv.id] ?? ''}
                    onChange={(e) => onChange({ ...value, [inv.id]: e.currentTarget.value })}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  );
};

export const toAllocations = (value: AllocationMap) =>
  Object.entries(value)
    .filter(([, v]) => Number(v) > 0)
    .map(([document_id, amount]) => ({ document_id, amount }));
