'use client';

import { ActionIcon, Button, Group, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { RATE_TYPES } from '@erp/shared';
import { IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCompanyQuery, useCurrencies } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Rate = { id: string; currency_code: string; rate_date: string; rate_type: string; rate: string };

const CurrenciesPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const { data: currencies = [] } = useCurrencies();
  const [filter, setFilter] = useState<string | null>(null);
  const { data: rates = [] } = useCompanyQuery<Rate[]>(['rates'], '/gl/exchange-rates', { currency: filter ?? undefined });
  const [form, setForm] = useState({ currency_code: 'USD', rate_date: new Date().toISOString().slice(0, 10), rate_type: 'SPOT', rate: '' });
  const foreign = currencies.filter((c) => c.code !== company?.base_currency);

  const save = async () => {
    try {
      await api('/gl/exchange-rates', { method: 'POST', body: form });
      notifySuccess(t('saved'));
      setForm({ ...form, rate: '' });
      await queryClient.invalidateQueries({ queryKey: [company?.id, 'rates'] });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('confirmDelete'))) return;
    try {
      await api(`/gl/exchange-rates/${id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: [company?.id, 'rates'] });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  return (
    <Stack>
      <PageHeader title={t('navCurrencies')} subtitle={`${t('baseCurrency')}: ${company?.base_currency ?? ''}`} />
      {can('gl.rates.manage') && (
        <Paper withBorder p="md">
          <SimpleGrid cols={{ base: 1, sm: 5 }}>
            <Select label={t('currency')} searchable data={foreign.map((c) => ({ value: c.code, label: `${c.code} — ${name(c)}` }))} value={form.currency_code} onChange={(v) => setForm({ ...form, currency_code: v ?? 'USD' })} allowDeselect={false} />
            <TextInput type="date" label={t('date')} value={form.rate_date} onChange={(e) => setForm({ ...form, rate_date: e.currentTarget.value })} />
            <Select label={t('rateType')} data={RATE_TYPES.map(String)} value={form.rate_type} onChange={(v) => setForm({ ...form, rate_type: v ?? 'SPOT' })} allowDeselect={false} />
            <TextInput label={`${t('rate')} (${company?.base_currency} / 1)`} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
            <Group align="flex-end">
              <Button onClick={save} disabled={!form.rate}>
                {t('save')}
              </Button>
            </Group>
          </SimpleGrid>
        </Paper>
      )}
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Title order={5}>{t('rate')}</Title>
          <Select size="xs" clearable placeholder={t('all')} data={foreign.map((c) => c.code)} value={filter} onChange={setFilter} w={140} />
        </Group>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('date')}</Table.Th>
              <Table.Th>{t('currency')}</Table.Th>
              <Table.Th>{t('rateType')}</Table.Th>
              <Table.Th>{t('rate')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rates.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td className="num">{r.rate_date}</Table.Td>
                <Table.Td>{r.currency_code}</Table.Td>
                <Table.Td>{r.rate_type}</Table.Td>
                <Table.Td className="num">{r.rate}</Table.Td>
                <Table.Td>
                  {can('gl.rates.manage') && (
                    <ActionIcon variant="subtle" color="red" aria-label={t('delete')} onClick={() => remove(r.id)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {rates.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
      </Paper>
    </Stack>
  );
};

export default CurrenciesPage;
