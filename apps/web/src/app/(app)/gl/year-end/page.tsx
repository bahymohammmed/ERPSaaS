'use client';

import { ActionIcon, Alert, Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPencil, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AccountSelect, Amount, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useAccounts, useCompanyQuery, useFiscalYears } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Rule = {
  id?: string;
  code: string;
  name_ar: string;
  name_en: string;
  sequence: number;
  stage: 'EXPENSE' | 'RESERVE';
  base: 'PROFIT' | 'AFTER_RESERVE';
  percent: string;
  cap_percent_of_capital: string | null;
  capital_account_id: string | null;
  debit_account_id: string | null;
  credit_account_id: string | null;
  is_active: boolean;
};
type Preview = {
  status: 'OPEN' | 'CLOSED';
  unposted: number;
  profit_before_contributions: string;
  contributions_total: string;
  net_profit: string;
  reserves_total: string;
  rules: (Rule & { base_amount: string; computed: string; already_posted: string; amount: string; capped: boolean })[];
};

const YearEndPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const minor = company?.base_minor_units ?? 3;
  const { data: years = [] } = useFiscalYears();
  const { data: accounts = [] } = useAccounts();
  const { data: rules = [] } = useCompanyQuery<Rule[]>(['appropriation-rules'], '/gl/year-end/rules');
  const [yearId, setYearId] = useState<string | null>(null);
  const [apply, setApply] = useState(true);
  const [rule, setRule] = useState<Rule | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!yearId && years.length) setYearId(years.find((y) => y.status === 'OPEN')?.id ?? years[0]?.id ?? null);
  }, [years, yearId]);

  const preview = useQuery({
    queryKey: [company?.id, 'year-end-preview', yearId],
    queryFn: () => api<Preview>(`/gl/year-end/${yearId}/preview`),
    enabled: !!company && !!yearId,
  });
  const accountCode = (id: string | null) => accounts.find((a) => a.id === id)?.code ?? '';

  const refresh = () =>
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === company?.id && ['year-end-preview', 'fiscal-years', 'periods', 'appropriation-rules'].includes(String(q.queryKey[1])) });

  const call = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const close = () =>
    call(async () => {
      if (!window.confirm(t('confirmClose'))) return;
      await api('/gl/year-end/close', { method: 'POST', body: { fiscal_year_id: yearId, apply_appropriations: apply } });
      notifySuccess(t('saved'));
    });
  const reopen = () =>
    call(async () => {
      if (!window.confirm(t('reopenYear'))) return;
      await api('/gl/year-end/reopen', { method: 'POST', body: { fiscal_year_id: yearId } });
      notifySuccess(t('saved'));
    });
  const saveRule = () =>
    call(async () => {
      if (!rule) return;
      const { id, ...body } = rule;
      await api(id ? `/gl/year-end/rules/${id}` : '/gl/year-end/rules', {
        method: id ? 'PUT' : 'POST',
        body: { ...body, cap_percent_of_capital: body.cap_percent_of_capital || null, capital_account_id: body.cap_percent_of_capital ? body.capital_account_id : null },
      });
      setRule(null);
    });

  const p = preview.data;
  const canClose = can('gl.close.manage');

  return (
    <Stack>
      <PageHeader title={t('navYearEnd')} />
      <Paper withBorder p="md">
        <Group align="flex-end">
          <Select label={t('fiscalYear')} data={years.map((y) => ({ value: y.id, label: `${y.code} (${t(`status${y.status === 'CLOSED' ? 'CLOSED' : 'OPEN'}`)})` }))} value={yearId} onChange={setYearId} w={240} />
          {p?.status === 'OPEN' && <Checkbox mb={8} label={t('applyAppropriations')} checked={apply} onChange={(e) => setApply(e.currentTarget.checked)} />}
          {canClose && p?.status === 'OPEN' && (
            <Button color="red" onClick={close} loading={busy} disabled={p.unposted > 0}>
              {t('closeYear')}
            </Button>
          )}
          {canClose && can('gl.period.unlock') && p?.status === 'CLOSED' && (
            <Button variant="light" onClick={reopen} loading={busy}>
              {t('reopenYear')}
            </Button>
          )}
        </Group>
        {p && p.unposted > 0 && (
          <Alert color="orange" mt="md">
            {t('unpostedWarning')} ({p.unposted})
          </Alert>
        )}
        {p && (
          <>
            <SimpleGrid cols={{ base: 1, sm: 4 }} mt="md">
              {(
                [
                  ['profitBefore', p.profit_before_contributions],
                  ['contributions', p.contributions_total],
                  ['netProfit', p.net_profit],
                  ['reservesTotal', p.reserves_total],
                ] as const
              ).map(([label, value]) => (
                <Paper key={label} withBorder p="sm">
                  <Text size="xs" c="dimmed">
                    {t(label)}
                  </Text>
                  <Title order={4}>
                    <Amount value={value} minor={minor} />
                  </Title>
                </Paper>
              ))}
            </SimpleGrid>
            <Table mt="md" striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('name')}</Table.Th>
                  <Table.Th>{t('stage')}</Table.Th>
                  <Table.Th className="amount-cell">{t('base')}</Table.Th>
                  <Table.Th className="amount-cell">%</Table.Th>
                  <Table.Th className="amount-cell">{t('computed')}</Table.Th>
                  <Table.Th className="amount-cell">{t('alreadyPosted')}</Table.Th>
                  <Table.Th className="amount-cell">{t('toPost')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {p.rules.map((r) => (
                  <Table.Tr key={r.code}>
                    <Table.Td>
                      {name(r)} {r.capped && <Badge size="xs" color="orange">{t('capped')}</Badge>}
                    </Table.Td>
                    <Table.Td>{t(`stage${r.stage}`)}</Table.Td>
                    <Table.Td className="amount-cell"><Amount value={r.base_amount} minor={minor} /></Table.Td>
                    <Table.Td className="amount-cell num">{Number(r.percent)}</Table.Td>
                    <Table.Td className="amount-cell"><Amount value={r.computed} minor={minor} /></Table.Td>
                    <Table.Td className="amount-cell"><Amount value={r.already_posted} minor={minor} /></Table.Td>
                    <Table.Td className="amount-cell"><Amount value={r.amount} minor={minor} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </>
        )}
      </Paper>

      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Title order={5}>{t('appropriationRules')}</Title>
          {canClose && (
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setRule({ code: '', name_ar: '', name_en: '', sequence: rules.length + 1, stage: 'EXPENSE', base: 'PROFIT', percent: '', cap_percent_of_capital: null, capital_account_id: null, debit_account_id: null, credit_account_id: null, is_active: true })}>
              {t('add')}
            </Button>
          )}
        </Group>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>{t('name')}</Table.Th>
              <Table.Th>{t('stage')}</Table.Th>
              <Table.Th>{t('base')}</Table.Th>
              <Table.Th>%</Table.Th>
              <Table.Th>{t('debitAccount')}</Table.Th>
              <Table.Th>{t('creditAccount')}</Table.Th>
              <Table.Th>{t('status')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rules.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td className="num">{r.sequence}</Table.Td>
                <Table.Td>{name(r)}</Table.Td>
                <Table.Td>{t(`stage${r.stage}`)}</Table.Td>
                <Table.Td>{t(`base${r.base}`)}</Table.Td>
                <Table.Td className="num">
                  {Number(r.percent)}
                  {r.cap_percent_of_capital ? ` (≤ ${Number(r.cap_percent_of_capital)}%)` : ''}
                </Table.Td>
                <Table.Td className="ltr">{accountCode(r.debit_account_id)}</Table.Td>
                <Table.Td className="ltr">{accountCode(r.credit_account_id)}</Table.Td>
                <Table.Td>{r.is_active ? t('active') : t('inactive')}</Table.Td>
                <Table.Td>
                  {canClose && (
                    <ActionIcon variant="subtle" onClick={() => setRule({ ...r, percent: String(Number(r.percent)), cap_percent_of_capital: r.cap_percent_of_capital ? String(Number(r.cap_percent_of_capital)) : null })} aria-label={t('edit')}>
                      <IconPencil size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      <Modal opened={!!rule} onClose={() => setRule(null)} title={rule?.id ? t('edit') : t('add')} size="lg">
        {rule && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('code')} value={rule.code} onChange={(e) => setRule({ ...rule, code: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
              <TextInput label={t('nameAr')} value={rule.name_ar} onChange={(e) => setRule({ ...rule, name_ar: e.currentTarget.value })} dir="rtl" />
              <TextInput label={t('nameEn')} value={rule.name_en} onChange={(e) => setRule({ ...rule, name_en: e.currentTarget.value })} dir="ltr" />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 4 }}>
              <NumberInput label="#" min={1} max={99} value={rule.sequence} onChange={(v) => setRule({ ...rule, sequence: Number(v) || 1 })} />
              <Select label={t('stage')} data={(['EXPENSE', 'RESERVE'] as const).map((v) => ({ value: v, label: t(`stage${v}`) }))} value={rule.stage} onChange={(v) => setRule({ ...rule, stage: v === 'RESERVE' ? 'RESERVE' : 'EXPENSE' })} allowDeselect={false} />
              <Select label={t('base')} data={(['PROFIT', 'AFTER_RESERVE'] as const).map((v) => ({ value: v, label: t(`base${v}`) }))} value={rule.base} onChange={(v) => setRule({ ...rule, base: v === 'AFTER_RESERVE' ? 'AFTER_RESERVE' : 'PROFIT' })} allowDeselect={false} />
              <TextInput label="%" value={rule.percent} onChange={(e) => setRule({ ...rule, percent: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <AccountSelect label={t('debitAccount')} value={rule.debit_account_id} onChange={(v) => setRule({ ...rule, debit_account_id: v })} />
              <AccountSelect label={t('creditAccount')} value={rule.credit_account_id} onChange={(v) => setRule({ ...rule, credit_account_id: v })} />
              <TextInput label={t('capPercent')} value={rule.cap_percent_of_capital ?? ''} onChange={(e) => setRule({ ...rule, cap_percent_of_capital: e.currentTarget.value || null })} classNames={{ input: 'ltr' }} />
              <AccountSelect label={t('capitalAccount')} value={rule.capital_account_id} onChange={(v) => setRule({ ...rule, capital_account_id: v })} disabled={!rule.cap_percent_of_capital} />
            </SimpleGrid>
            <Checkbox label={t('active')} checked={rule.is_active} onChange={(e) => setRule({ ...rule, is_active: e.currentTarget.checked })} />
            <Group justify="flex-end">
              <Button onClick={saveRule} loading={busy}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};

export default YearEndPage;
