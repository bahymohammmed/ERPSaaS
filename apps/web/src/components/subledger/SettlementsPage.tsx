'use client';

import { Badge, Button, Paper, Table, Text } from '@mantine/core';
import type { LedgerSide } from '@erp/shared';
import { IconPlus } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Amount, PageHeader } from '@/components/common';
import { EmptyRow, TableSkeletonRows } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { useCompanyQuery } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { SIDE_UI } from './config';

type Settlement = {
  id: string;
  doc_no: string;
  party_name_ar: string;
  party_name_en: string;
  bank_code: string;
  settle_date: string;
  currency_code: string;
  amount: string;
  unallocated: string;
  reference: string | null;
  status: 'POSTED' | 'VOID';
};

export const SettlementsPage = ({ side }: { side: LedgerSide }) => {
  const ui = SIDE_UI[side];
  const { t, name } = useI18n();
  const { can, company } = useSession();
  const router = useRouter();
  const minor = company?.base_minor_units ?? 3;
  const { data = [], isLoading } = useCompanyQuery<Settlement[]>(['sl-settlements', side], `/sl/${side}/settlements`);
  return (
    <>
      <PageHeader
        title={t(ui.settlementsTitle)}
        actions={
          can(ui.manage) && (
            <Button component={Link} href={`${ui.settlements}/new`} leftSection={<IconPlus size={16} />}>
              {t(ui.newSettlement)}
            </Button>
          )
        }
      />
      <Paper withBorder p="sm">
        <Table.ScrollContainer minWidth={820}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('documentNo')}</Table.Th>
                <Table.Th>{t('date')}</Table.Th>
                <Table.Th>{t(ui.party)}</Table.Th>
                <Table.Th>{t('bankAccount')}</Table.Th>
                <Table.Th style={{ textAlign: 'end' }}>{t('amount')}</Table.Th>
                <Table.Th style={{ textAlign: 'end' }}>{t('unallocated')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && <TableSkeletonRows cols={7} />}
              {!isLoading && data.length === 0 && <EmptyRow cols={7} />}
              {data.map((s) => (
                <Table.Tr key={s.id} className="clickable" onClick={() => router.push(`${ui.settlements}/${s.id}`)} style={{ opacity: s.status === 'VOID' ? 0.55 : 1 }}>
                  <Table.Td className="ltr" fw={500}>
                    {s.doc_no}
                  </Table.Td>
                  <Table.Td className="num">{s.settle_date}</Table.Td>
                  <Table.Td>
                    <Text size="sm">{name({ name_ar: s.party_name_ar, name_en: s.party_name_en })}</Text>
                    {s.reference && (
                      <Text size="xs" c="dimmed" className="ltr">
                        {s.reference}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td className="ltr">{s.bank_code}</Table.Td>
                  <Table.Td className="amount-cell" fw={600}>
                    <Amount value={s.amount} minor={minor} /> {s.currency_code !== company?.base_currency && <Text span size="xs" c="dimmed">{s.currency_code}</Text>}
                  </Table.Td>
                  <Table.Td className="amount-cell">
                    <Amount value={s.status === 'VOID' ? '0' : s.unallocated} minor={minor} />
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={s.status === 'POSTED' ? 'teal' : 'red'}>
                      {t(`docStatus${s.status}`)}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </>
  );
};
