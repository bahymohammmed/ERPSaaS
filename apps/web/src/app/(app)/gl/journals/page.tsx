'use client';

import { Button, Group, Pagination, Paper, Select, Table, Text, TextInput } from '@mantine/core';
import { JOURNAL_STATUSES } from '@erp/shared';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Amount, PageHeader, StatusBadge } from '@/components/common';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useJournalTypes } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { JournalEntry } from '@/lib/types';

type ListRow = Pick<JournalEntry, 'id' | 'entry_no' | 'entry_date' | 'status' | 'description' | 'reference' | 'total_debit' | 'journal_type_code' | 'journal_type_name_ar' | 'journal_type_name_en' | 'period_code' | 'source_module' | 'created_by_name'>;

const JournalList = () => {
  const { t, locale } = useI18n();
  const { company, can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const { data: types = [] } = useJournalTypes();
  const [filters, setFilters] = useState({
    status: params.get('status') ?? '',
    journal_type_id: '',
    from: '',
    to: '',
    search: '',
  });
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { data, isLoading } = useQuery({
    queryKey: [company?.id, 'journals', filters, page],
    queryFn: () => api<{ total: number; rows: ListRow[] }>('/gl/journals', { query: { ...filters, page, page_size: pageSize } }),
    enabled: !!company,
  });
  const update = (key: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title={t('navJournals')}
        actions={
          can('gl.journal.create') && (
            <Button component={Link} href="/gl/journals/new" leftSection={<IconPlus size={16} />}>
              {t('newEntry')}
            </Button>
          )
        }
      />
      <Paper withBorder p="sm">
        <Group mb="sm" gap="xs" wrap="wrap">
          <TextInput leftSection={<IconSearch size={16} />} placeholder={t('search')} value={filters.search} onChange={(e) => update('search', e.currentTarget.value)} w={220} />
          <Select
            placeholder={t('status')}
            clearable
            data={JOURNAL_STATUSES.map((s) => ({ value: s, label: t(`status${s}`) }))}
            value={filters.status || null}
            onChange={(v) => update('status', v ?? '')}
            w={170}
          />
          <Select
            placeholder={t('journalType')}
            clearable
            data={types.map((jt) => ({ value: jt.id, label: `${jt.code} — ${locale === 'ar' ? jt.name_ar : jt.name_en}` }))}
            value={filters.journal_type_id || null}
            onChange={(v) => update('journal_type_id', v ?? '')}
            w={220}
          />
          <TextInput type="date" aria-label={t('from')} value={filters.from} onChange={(e) => update('from', e.currentTarget.value)} />
          <TextInput type="date" aria-label={t('to')} value={filters.to} onChange={(e) => update('to', e.currentTarget.value)} />
        </Group>
        <Table.ScrollContainer minWidth={900}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('entryNo')}</Table.Th>
                <Table.Th>{t('date')}</Table.Th>
                <Table.Th>{t('journalType')}</Table.Th>
                <Table.Th>{t('description')}</Table.Th>
                <Table.Th>{t('reference')}</Table.Th>
                <Table.Th className="amount-cell">{t('amount')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
                <Table.Th>{t('createdBy')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={8}>{t('loading')}</Table.Td>
                </Table.Tr>
              )}
              {data?.rows.map((row) => (
                <Table.Tr key={row.id} className="clickable" onClick={() => router.push(`/gl/journals/${row.id}`)}>
                  <Table.Td className="ltr">{row.entry_no ?? '—'}</Table.Td>
                  <Table.Td className="num">{row.entry_date}</Table.Td>
                  <Table.Td>{locale === 'ar' ? row.journal_type_name_ar : row.journal_type_name_en}</Table.Td>
                  <Table.Td maw={320} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.description}
                  </Table.Td>
                  <Table.Td>{row.reference}</Table.Td>
                  <Table.Td className="amount-cell">
                    <Amount value={row.total_debit} minor={company?.base_minor_units ?? 3} />
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge status={row.status} />
                  </Table.Td>
                  <Table.Td>{row.created_by_name}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {data && data.rows.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
        {data && data.total > pageSize && <Pagination mt="sm" total={Math.ceil(data.total / pageSize)} value={page} onChange={setPage} />}
      </Paper>
    </>
  );
};

const JournalsPage = () => (
  <Suspense>
    <JournalList />
  </Suspense>
);

export default JournalsPage;
