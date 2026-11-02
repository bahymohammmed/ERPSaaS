'use client';

import { Badge, Button, Group, Paper, Select, Table, Text, TextInput } from '@mantine/core';
import type { LedgerSide } from '@erp/shared';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Amount, PageHeader } from '@/components/common';
import { EmptyRow, TableSkeletonRows } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { useCompanyQuery } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { DOC_STATUS_COLORS, type Party, type PartyDocument, SIDE_UI } from './config';

export const DocumentsPage = ({ side }: { side: LedgerSide }) => {
  const ui = SIDE_UI[side];
  const { t, name } = useI18n();
  const { can, company } = useSession();
  const router = useRouter();
  const [party, setParty] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { data: parties = [] } = useCompanyQuery<Party[]>(['sl-parties', side], `/sl/${side}/parties`);
  const { data = [], isLoading } = useCompanyQuery<PartyDocument[]>(['sl-documents', side, party, status], `/sl/${side}/documents`, {
    party_id: party ?? undefined,
    status: status ?? undefined,
  });
  const minor = company?.base_minor_units ?? 3;
  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? data.filter((d) => [d.doc_no ?? '', d.reference ?? '', d.party_code, d.party_name_ar, d.party_name_en].some((v) => v.toLowerCase().includes(q))) : data;
  }, [data, search]);

  return (
    <>
      <PageHeader
        title={t(ui.documentsTitle)}
        actions={
          can(ui.manage) && (
            <>
              <Button variant="default" component={Link} href={`${ui.documents}/new?type=${ui.note}`} leftSection={<IconPlus size={16} />}>
                {t(ui.newNote)}
              </Button>
              <Button component={Link} href={`${ui.documents}/new`} leftSection={<IconPlus size={16} />}>
                {t('newInvoice')}
              </Button>
            </>
          )
        }
      />
      <Paper withBorder p="sm">
        <Group mb="sm" gap="sm" wrap="wrap">
          <TextInput leftSection={<IconSearch size={16} />} placeholder={t('search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={{ base: '100%', sm: 240 }} />
          <Select placeholder={t(ui.party)} clearable searchable data={parties.map((p) => ({ value: p.id, label: `${p.code} — ${name(p)}` }))} value={party} onChange={setParty} w={{ base: '100%', sm: 260 }} />
          <Select
            placeholder={t('status')}
            clearable
            data={(['DRAFT', 'POSTED', 'VOID'] as const).map((s) => ({ value: s, label: t(`docStatus${s}`) }))}
            value={status}
            onChange={setStatus}
            w={{ base: '100%', sm: 160 }}
          />
        </Group>
        <Table.ScrollContainer minWidth={900}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('documentNo')}</Table.Th>
                <Table.Th>{t('type')}</Table.Th>
                <Table.Th>{t(ui.party)}</Table.Th>
                <Table.Th>{t('date')}</Table.Th>
                <Table.Th>{t('dueDate')}</Table.Th>
                <Table.Th style={{ textAlign: 'end' }}>{t('total')}</Table.Th>
                <Table.Th style={{ textAlign: 'end' }}>{t('openAmount')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && <TableSkeletonRows cols={8} />}
              {!isLoading && rows.length === 0 && <EmptyRow cols={8} />}
              {rows.map((d) => {
                const overdue = d.status === 'POSTED' && d.doc_type === 'INVOICE' && Number(d.open_amount) > 0 && d.due_date < today;
                return (
                  <Table.Tr key={d.id} className="clickable" onClick={() => router.push(`${ui.documents}/${d.id}`)}>
                    <Table.Td className="ltr" fw={500}>
                      {d.doc_no ?? '—'}
                    </Table.Td>
                    <Table.Td>{t(`doc${d.doc_type}`)}</Table.Td>
                    <Table.Td>
                      <Text size="sm">{name({ name_ar: d.party_name_ar, name_en: d.party_name_en })}</Text>
                      {d.reference && (
                        <Text size="xs" c="dimmed" className="ltr">
                          {d.reference}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td className="num">{d.doc_date}</Table.Td>
                    <Table.Td className="num" c={overdue ? 'red' : undefined} fw={overdue ? 600 : undefined}>
                      {d.due_date}
                    </Table.Td>
                    <Table.Td className="amount-cell">
                      <Amount value={d.total} minor={minor} /> {d.currency_code !== company?.base_currency && <Text span size="xs" c="dimmed">{d.currency_code}</Text>}
                    </Table.Td>
                    <Table.Td className="amount-cell" fw={600}>
                      <Amount value={d.open_amount} minor={minor} />
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={DOC_STATUS_COLORS[d.status]}>
                        {t(`docStatus${d.status}`)}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </>
  );
};
