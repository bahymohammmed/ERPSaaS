'use client';

import { Button, Checkbox, Group, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { RATE_TYPES, toMoney } from '@erp/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Amount, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

type Preview = {
  lines: {
    account_code: string;
    account_name_ar: string;
    account_name_en: string;
    cost_center_code: string | null;
    currency_code: string;
    foreign_balance: string;
    base_balance: string;
    rate: string;
    revalued_balance: string;
    difference: string;
  }[];
  net_difference: string;
};

const lastDayOfPreviousMonth = () => {
  const d = new Date();
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};

const FxRevaluationPage = () => {
  const { t, locale, errorText } = useI18n();
  const { company } = useSession();
  const router = useRouter();
  const minor = company?.base_minor_units ?? 3;
  const [form, setForm] = useState({ revaluation_date: lastDayOfPreviousMonth(), rate_type: 'CLOSING', auto_reverse: true });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      setPreview(await api<Preview>('/gl/fx-revaluation/preview', { method: 'POST', body: form }));
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    setBusy(true);
    try {
      const result = await api<{ entry_id: string }>('/gl/fx-revaluation', { method: 'POST', body: form });
      notifySuccess(t('saved'));
      router.push(`/gl/journals/${result.entry_id}`);
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack>
      <PageHeader title={t('navFxRevaluation')} />
      <Paper withBorder p="md">
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput type="date" label={t('revaluationDate')} value={form.revaluation_date} onChange={(e) => { setForm({ ...form, revaluation_date: e.currentTarget.value }); setPreview(null); }} />
          <Select label={t('rateType')} data={RATE_TYPES.map(String)} value={form.rate_type} onChange={(v) => { setForm({ ...form, rate_type: v ?? 'CLOSING' }); setPreview(null); }} allowDeselect={false} />
          <Checkbox mt="xl" label={t('autoReverseNextDay')} checked={form.auto_reverse} onChange={(e) => setForm({ ...form, auto_reverse: e.currentTarget.checked })} />
        </SimpleGrid>
        <Group mt="md">
          <Button variant="light" onClick={load} loading={busy}>
            {t('preview')}
          </Button>
          <Button onClick={post} loading={busy} disabled={!preview || preview.lines.length === 0}>
            {t('postEntry')}
          </Button>
        </Group>
      </Paper>
      {preview && (
        <Paper withBorder p="md">
          <Table.ScrollContainer minWidth={900}>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('account')}</Table.Th>
                  <Table.Th>{t('costCenter')}</Table.Th>
                  <Table.Th>{t('currency')}</Table.Th>
                  <Table.Th className="amount-cell">{t('foreignBalance')}</Table.Th>
                  <Table.Th className="amount-cell">{t('carryingAmount')}</Table.Th>
                  <Table.Th className="amount-cell">{t('rate')}</Table.Th>
                  <Table.Th className="amount-cell">{t('revaluedAmount')}</Table.Th>
                  <Table.Th className="amount-cell">{t('difference')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {preview.lines.map((l, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <span className="ltr">{l.account_code}</span> — {locale === 'ar' ? l.account_name_ar : l.account_name_en}
                    </Table.Td>
                    <Table.Td className="ltr">{l.cost_center_code ?? ''}</Table.Td>
                    <Table.Td>{l.currency_code}</Table.Td>
                    <Table.Td className="amount-cell num">{toMoney(l.foreign_balance).toFixed(2)}</Table.Td>
                    <Table.Td className="amount-cell"><Amount value={l.base_balance} minor={minor} /></Table.Td>
                    <Table.Td className="amount-cell num">{l.rate}</Table.Td>
                    <Table.Td className="amount-cell"><Amount value={l.revalued_balance} minor={minor} /></Table.Td>
                    <Table.Td className="amount-cell"><Amount value={l.difference} minor={minor} /></Table.Td>
                  </Table.Tr>
                ))}
                <Table.Tr className="row-grandTotal">
                  <Table.Td colSpan={7}>{t('netDifference')}</Table.Td>
                  <Table.Td className="amount-cell"><Amount value={preview.net_difference} minor={minor} /></Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {preview.lines.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
        </Paper>
      )}
    </Stack>
  );
};

export default FxRevaluationPage;
