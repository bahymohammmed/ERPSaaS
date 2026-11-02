'use client';

import { Button, Card, Group, Paper, Select, SimpleGrid, Table, Text, TextInput } from '@mantine/core';
import { ASSET_STATUSES } from '@erp/shared';
import { IconFileImport, IconPlus, IconSearch } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Amount, PageHeader } from '@/components/common';
import { AssetStatusBadge, useFaCategories } from '@/components/fixed-assets';
import { EmptyRow, TableSkeletonRows } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { useCompanyQuery } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { FaAsset } from '@/lib/types';

const AssetRegisterPage = () => {
  const { t, name, amount } = useI18n();
  const { can, company } = useSession();
  const router = useRouter();
  const minor = company?.base_minor_units ?? 3;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const { data: categories = [] } = useFaCategories();
  const { data = [], isLoading } = useCompanyQuery<FaAsset[]>(['fa-assets', status, category], '/fa/assets', {
    status: status ?? undefined,
    category_id: category ?? undefined,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? data.filter((a) => [a.code, a.name_ar, a.name_en, a.serial_no ?? '', a.location ?? '', a.custodian ?? ''].some((v) => v.toLowerCase().includes(q))) : data;
  }, [data, search]);

  const totals = useMemo(() => {
    const live = rows.filter((a) => a.status !== 'DRAFT' && a.status !== 'DISPOSED');
    const sum = (key: 'cost' | 'accumulated' | 'net_book_value') => live.reduce((acc, a) => acc + Number(a[key]), 0).toFixed(minor);
    return { count: live.length, cost: sum('cost'), accumulated: sum('accumulated'), nbv: sum('net_book_value') };
  }, [rows, minor]);

  return (
    <>
      <PageHeader
        title={t('navAssetRegister')}
        actions={
          can('fa.manage') && (
            <>
              <Button variant="default" component={Link} href="/gl/import" leftSection={<IconFileImport size={16} />}>
                {t('navImport')}
              </Button>
              <Button component={Link} href="/fa/assets/new" leftSection={<IconPlus size={16} />}>
                {t('newAsset')}
              </Button>
            </>
          )
        }
      />
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} mb="md" className="stagger">
        {[
          { label: t('assetStatusACTIVE'), value: String(totals.count) },
          { label: t('totalCost'), value: amount(totals.cost, minor) },
          { label: t('accumulatedDep'), value: amount(totals.accumulated, minor) },
          { label: t('netBookValue'), value: amount(totals.nbv, minor) },
        ].map((k) => (
          <Card key={k.label} padding="md">
            <Text size="sm" c="dimmed">
              {k.label}
            </Text>
            <Text fz={22} fw={700} className="num">
              {k.value}
            </Text>
          </Card>
        ))}
      </SimpleGrid>
      <Paper withBorder p="sm">
        <Group mb="sm" gap="sm" wrap="wrap">
          <TextInput leftSection={<IconSearch size={16} />} placeholder={t('search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={{ base: '100%', sm: 260 }} />
          <Select placeholder={t('assetCategory')} clearable data={categories.map((c) => ({ value: c.id, label: `${c.code} — ${name(c)}` }))} value={category} onChange={setCategory} w={{ base: '100%', sm: 220 }} />
          <Select placeholder={t('status')} clearable data={ASSET_STATUSES.map((s) => ({ value: s, label: t(`assetStatus${s}`) }))} value={status} onChange={setStatus} w={{ base: '100%', sm: 180 }} />
        </Group>
        <Table.ScrollContainer minWidth={980}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('code')}</Table.Th>
                <Table.Th>{t('asset')}</Table.Th>
                <Table.Th>{t('assetCategory')}</Table.Th>
                <Table.Th>{t('costCenter')}</Table.Th>
                <Table.Th>{t('inServiceDate')}</Table.Th>
                <Table.Th style={{ textAlign: 'end' }}>{t('cost')}</Table.Th>
                <Table.Th style={{ textAlign: 'end' }}>{t('accumulatedDep')}</Table.Th>
                <Table.Th style={{ textAlign: 'end' }}>{t('netBookValue')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && <TableSkeletonRows cols={9} />}
              {!isLoading && rows.length === 0 && (
                <EmptyRow
                  cols={9}
                  action={
                    can('fa.manage') && (
                      <Button mt="xs" size="xs" component={Link} href="/fa/assets/new" leftSection={<IconPlus size={14} />}>
                        {t('newAsset')}
                      </Button>
                    )
                  }
                />
              )}
              {rows.map((a) => (
                <Table.Tr key={a.id} className="clickable" onClick={() => router.push(`/fa/assets/${a.id}`)}>
                  <Table.Td className="ltr" fw={500}>
                    {a.code}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{name(a)}</Text>
                    {(a.location || a.custodian) && (
                      <Text size="xs" c="dimmed">
                        {[a.location, a.custodian].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{locale(a, name)}</Table.Td>
                  <Table.Td className="ltr">{a.cost_center_code}</Table.Td>
                  <Table.Td className="num">{a.in_service_date}</Table.Td>
                  <Table.Td className="amount-cell">
                    <Amount value={a.cost} minor={minor} />
                  </Table.Td>
                  <Table.Td className="amount-cell">
                    <Amount value={a.accumulated} minor={minor} />
                  </Table.Td>
                  <Table.Td className="amount-cell" fw={600}>
                    <Amount value={a.net_book_value} minor={minor} />
                  </Table.Td>
                  <Table.Td>
                    <AssetStatusBadge status={a.status} />
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

const locale = (a: FaAsset, name: (row: { name_ar?: string | null; name_en?: string | null }) => string) => name({ name_ar: a.category_name_ar, name_en: a.category_name_en });

export default AssetRegisterPage;
