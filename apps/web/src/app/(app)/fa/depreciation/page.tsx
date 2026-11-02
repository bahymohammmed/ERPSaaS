'use client';

import { Anchor, Badge, Button, Group, Paper, Select, Stack, Table, Text, Title } from '@mantine/core';
import { IconArrowBackUp, IconEye, IconPlayerPlay } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Amount, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { EmptyRow, EmptyState, TableSkeletonRows } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCompanyQuery, usePeriods } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Run = { id: string; period_code: string; period_name_ar: string; period_name_en: string; status: 'POSTED' | 'REVERSED'; total: string; entry_no: string | null; entry_id: string | null; created_by_name: string | null; asset_count: number; created_at: string };
type Result = { total: string; period_code: string; lines: { asset_id: string; code: string; name_ar: string; name_en: string; category_code: string; from_date: string; to_date: string; amount: string }[] };

const DepreciationPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const minor = company?.base_minor_units ?? 3;
  const { data: periods = [] } = usePeriods();
  const runs = useCompanyQuery<Run[]>(['fa-runs'], '/fa/depreciation/runs');
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can('fa.manage');

  const options = useMemo(() => periods.filter((p) => !p.is_adjustment).map((p) => ({ value: p.id, label: `${p.code} — ${name(p)}` })), [periods, name]);
  const latestPosted = runs.data?.find((r) => r.status === 'POSTED');

  const call = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === company?.id && String(q.queryKey[1]).startsWith('fa-') });

  const doPreview = () => call(async () => setPreview(await api<Result>('/fa/depreciation/preview', { method: 'POST', body: { period_id: periodId } })));
  const post = () =>
    call(async () => {
      const result = await api<Result>('/fa/depreciation/run', { method: 'POST', body: { period_id: periodId } });
      notifySuccess(`${t('saved')}: ${result.period_code}`);
      setPreview(null);
      await refresh();
    });
  const reverse = (run: Run) =>
    call(async () => {
      if (!window.confirm(t('reverseRunConfirm'))) return;
      await api(`/fa/depreciation/runs/${run.id}/reverse`, { method: 'POST' });
      notifySuccess(t('saved'));
      await refresh();
    });

  return (
    <Stack>
      <PageHeader title={t('navDepreciation')} />
      {canManage && (
        <Paper withBorder p="md">
          <Group align="flex-end" wrap="wrap">
            <Select label={t('period')} searchable data={options} value={periodId} onChange={(v) => { setPeriodId(v); setPreview(null); }} w={{ base: '100%', sm: 280 }} />
            <Button variant="light" leftSection={<IconEye size={16} />} disabled={!periodId} loading={busy} onClick={doPreview}>
              {t('preview')}
            </Button>
            <Button leftSection={<IconPlayerPlay size={16} />} disabled={!preview} loading={busy} onClick={post}>
              {t('runDepreciation')}
            </Button>
          </Group>
          {preview && (
            <div className="page-enter">
              <Group justify="space-between" mt="md" mb="xs">
                <Text fw={600}>{preview.period_code}</Text>
                <Text fw={700} className="num">
                  {t('total')}: <Amount value={preview.total} minor={minor} />
                </Text>
              </Group>
              <Table.ScrollContainer minWidth={640}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('code')}</Table.Th>
                      <Table.Th>{t('asset')}</Table.Th>
                      <Table.Th>{t('assetCategory')}</Table.Th>
                      <Table.Th>{t('from')}</Table.Th>
                      <Table.Th>{t('to')}</Table.Th>
                      <Table.Th style={{ textAlign: 'end' }}>{t('amount')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {preview.lines.map((l) => (
                      <Table.Tr key={l.asset_id}>
                        <Table.Td className="ltr">
                          <Anchor component={Link} href={`/fa/assets/${l.asset_id}`} size="sm">
                            {l.code}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>{name(l)}</Table.Td>
                        <Table.Td className="ltr">{l.category_code}</Table.Td>
                        <Table.Td className="num">{l.from_date}</Table.Td>
                        <Table.Td className="num">{l.to_date}</Table.Td>
                        <Table.Td className="amount-cell">
                          <Amount value={l.amount} minor={minor} />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </div>
          )}
        </Paper>
      )}

      <Paper withBorder p="md">
        <Title order={5} mb="sm">
          {t('depreciationRuns')}
        </Title>
        <Table.ScrollContainer minWidth={700}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('period')}</Table.Th>
                <Table.Th>{t('assets')}</Table.Th>
                <Table.Th style={{ textAlign: 'end' }}>{t('total')}</Table.Th>
                <Table.Th>{t('entryNo')}</Table.Th>
                <Table.Th>{t('createdBy')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {runs.isLoading && <TableSkeletonRows cols={7} rows={3} />}
              {runs.data?.length === 0 && <EmptyRow cols={7} />}
              {runs.data?.map((r) => (
                <Table.Tr key={r.id} style={{ opacity: r.status === 'REVERSED' ? 0.55 : 1 }}>
                  <Table.Td>
                    <Text size="sm" className="ltr">
                      {r.period_code}
                    </Text>
                  </Table.Td>
                  <Table.Td className="num">{r.asset_count}</Table.Td>
                  <Table.Td className="amount-cell">
                    <Amount value={r.total} minor={minor} />
                  </Table.Td>
                  <Table.Td>
                    {r.entry_id ? (
                      <Anchor component={Link} href={`/gl/journals/${r.entry_id}`} size="sm" className="ltr">
                        {r.entry_no}
                      </Anchor>
                    ) : (
                      '—'
                    )}
                  </Table.Td>
                  <Table.Td>{r.created_by_name}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={r.status === 'POSTED' ? 'teal' : 'gray'}>
                      {r.status === 'POSTED' ? t('statusPOSTED') : t('statusREVERSED')}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {canManage && r.id === latestPosted?.id && (
                      <Button size="xs" variant="subtle" color="orange" leftSection={<IconArrowBackUp size={14} />} onClick={() => reverse(r)} loading={busy}>
                        {t('reverse')}
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {runs.data === undefined && !runs.isLoading && <EmptyState />}
      </Paper>
    </Stack>
  );
};

export default DepreciationPage;
