'use client';

import { Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { Money, sumAmounts } from '@erp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Amount, CostCenterSelect, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useAccounts, useCompanyQuery, useFiscalYears, usePeriods } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toTreeRows } from '@/lib/tree';

type Budget = { id: string; code: string; name_ar: string; name_en: string; fiscal_year_id: string; status: 'DRAFT' | 'APPROVED' };
type Line = { account_id: string; cost_center_id: string | null; period_id: string; amount: string };

const cellKey = (accountId: string, periodId: string) => `${accountId}|${periodId}`;
const isAmount = (v: string) => /^-?\d+(\.\d+)?$/.test(v.trim());

const BudgetEditorPage = () => {
  const { id } = useParams<{ id: string }>();
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const minor = company?.base_minor_units ?? 3;
  const { data: budgets = [] } = useCompanyQuery<(Budget & { fiscal_year_code: string })[]>(['budgets'], '/gl/budgets');
  const budget = budgets.find((b) => b.id === id);
  const { data: accounts = [] } = useAccounts();
  const { data: periods = [] } = usePeriods();
  const { data: years = [] } = useFiscalYears();
  const [costCenterId, setCostCenterId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<{ source_fiscal_year_id: string | null; adjust_percent: number; by_cost_center: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const linesQuery = useQuery({
    queryKey: [company?.id, 'budget-lines', id, costCenterId],
    queryFn: () => api<Line[]>(`/gl/budgets/${id}/lines`, { query: { cost_center_id: costCenterId ?? undefined } }),
    enabled: !!company,
  });
  useEffect(() => setEdits({}), [costCenterId]);

  const yearPeriods = periods.filter((p) => p.fiscal_year_id === budget?.fiscal_year_id && !p.is_adjustment);
  const plAccounts = useMemo(() => toTreeRows(accounts).filter((a) => a.is_posting && a.is_active && (a.account_type === 'REVENUE' || a.account_type === 'EXPENSE')), [accounts]);
  const saved = useMemo(() => new Map((linesQuery.data ?? []).map((l) => [cellKey(l.account_id, l.period_id), String(Number(l.amount))])), [linesQuery.data]);
  const editable = can('gl.budget.manage') && budget?.status === 'DRAFT';
  const value = (accountId: string, periodId: string) => edits[cellKey(accountId, periodId)] ?? saved.get(cellKey(accountId, periodId)) ?? '';
  const changed = Object.keys(edits).length;

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
  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === company?.id && ['budgets', 'budget-lines'].includes(String(q.queryKey[1])) });

  const save = () =>
    call(async () => {
      const invalid = Object.values(edits).some((v) => v.trim() !== '' && !isAmount(v));
      if (invalid) throw new Error('invalid');
      const lines = Object.entries(edits).map(([key, amount]) => {
        const [account_id, period_id] = key.split('|');
        return { account_id, period_id, cost_center_id: costCenterId, amount: amount.trim() || '0' };
      });
      await api(`/gl/budgets/${id}/lines`, { method: 'PUT', body: { lines } });
      notifySuccess(t('saved'));
      setEdits({});
      await refresh();
    });

  const setStatus = (status: 'DRAFT' | 'APPROVED') =>
    call(async () => {
      await api(`/gl/budgets/${id}/status`, { method: 'PATCH', body: { status } });
      await refresh();
    });

  const generate = () =>
    call(async () => {
      if (!generating) return;
      await api(`/gl/budgets/${id}/generate`, { method: 'POST', body: generating });
      notifySuccess(t('saved'));
      setGenerating(null);
      await refresh();
    });

  const rowTotal = (accountId: string) => sumAmounts(yearPeriods.map((p) => (isAmount(value(accountId, p.id)) ? value(accountId, p.id) : '0')));
  const columnTotal = (periodId: string) => plAccounts.reduce((acc, a) => acc.plus(isAmount(value(a.id, periodId)) ? value(a.id, periodId) : '0'), new Money(0));

  if (!budget) return <Text>{t('loading')}</Text>;

  return (
    <Stack>
      <PageHeader
        title={`${t('budget')}: ${budget.code} — ${name(budget)}`}
        subtitle={<Badge variant="light">{budget.status === 'APPROVED' ? t('statusAPPROVED') : t('statusDRAFT')}</Badge>}
        actions={
          <>
            <Button variant="default" component={Link} href={`/reports/budget-vs-actual?budget_id=${id}`}>
              {t('reportBudgetVsActual')}
            </Button>
            {editable && (
              <>
                <Button variant="light" onClick={() => setGenerating({ source_fiscal_year_id: years[1]?.id ?? years[0]?.id ?? null, adjust_percent: 0, by_cost_center: true })}>
                  {t('generateFromActuals')}
                </Button>
                <Button onClick={save} disabled={changed === 0} loading={busy}>
                  {t('save')} {changed > 0 && `(${changed} ${t('changedCells')})`}
                </Button>
                <Button color="teal" variant="light" onClick={() => setStatus('APPROVED')} disabled={changed > 0}>
                  {t('approveBudget')}
                </Button>
              </>
            )}
            {can('gl.budget.manage') && budget.status === 'APPROVED' && (
              <Button variant="light" onClick={() => setStatus('DRAFT')}>
                {t('reopenBudget')}
              </Button>
            )}
          </>
        }
      />
      <Paper withBorder p="sm">
        <Group mb="sm">
          <CostCenterSelect w={320} postingOnly={false} placeholder={t('companyLevel')} value={costCenterId} onChange={setCostCenterId} />
          <Text size="sm" c="dimmed">
            {costCenterId ? '' : t('companyLevel')}
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={1500}>
          <Table withColumnBorders verticalSpacing={2}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th miw={260}>{t('account')}</Table.Th>
                {yearPeriods.map((p) => (
                  <Table.Th key={p.id} className="amount-cell">
                    {p.code.slice(5)}
                  </Table.Th>
                ))}
                <Table.Th className="amount-cell">{t('total')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {plAccounts.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td>
                    <span className="ltr">{a.code}</span> — {name(a)}
                  </Table.Td>
                  {yearPeriods.map((p) => {
                    const v = value(a.id, p.id);
                    return (
                      <Table.Td key={p.id} p={2}>
                        <TextInput
                          size="xs"
                          variant={edits[cellKey(a.id, p.id)] !== undefined ? 'filled' : 'default'}
                          classNames={{ input: 'ltr' }}
                          styles={{ input: { textAlign: 'end', minWidth: 80 } }}
                          value={v}
                          error={v && !isAmount(v) ? ' ' : undefined}
                          disabled={!editable}
                          onChange={(e) => {
                            const next = e.currentTarget.value;
                            setEdits((prev) => ({ ...prev, [cellKey(a.id, p.id)]: next }));
                          }}
                        />
                      </Table.Td>
                    );
                  })}
                  <Table.Td className="amount-cell">
                    <Amount value={rowTotal(a.id).toString()} minor={minor} />
                  </Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr className="row-grandTotal">
                <Table.Td>{t('total')}</Table.Td>
                {yearPeriods.map((p) => (
                  <Table.Td key={p.id} className="amount-cell">
                    <Amount value={columnTotal(p.id).toString()} minor={minor} />
                  </Table.Td>
                ))}
                <Table.Td />
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Modal opened={!!generating} onClose={() => setGenerating(null)} title={t('generateFromActuals')}>
        {generating && (
          <Stack>
            <Select label={t('sourceYear')} data={years.map((y) => ({ value: y.id, label: y.code }))} value={generating.source_fiscal_year_id} onChange={(v) => setGenerating({ ...generating, source_fiscal_year_id: v })} />
            <NumberInput label={t('adjustPercent')} value={generating.adjust_percent} onChange={(v) => setGenerating({ ...generating, adjust_percent: Number(v) || 0 })} />
            <Checkbox label={t('byCostCenter')} checked={generating.by_cost_center} onChange={(e) => setGenerating({ ...generating, by_cost_center: e.currentTarget.checked })} />
            <Group justify="flex-end">
              <Button onClick={generate} loading={busy}>
                {t('generateFromActuals')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};

export default BudgetEditorPage;
