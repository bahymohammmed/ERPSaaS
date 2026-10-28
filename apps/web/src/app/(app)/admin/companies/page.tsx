'use client';

import { ActionIcon, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, TextInput } from '@mantine/core';
import { IconPencil, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AccountSelect, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCurrencies } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Company = {
  id?: string;
  code: string;
  name_ar: string;
  name_en: string;
  base_currency: string;
  commercial_reg_no: string | null;
  tax_no: string | null;
  fiscal_year_start_month: number;
  require_approval: boolean;
  rounding_account_id: string | null;
  retained_earnings_account_id: string | null;
  is_active: boolean;
  first_fiscal_year?: number;
  seed_chart_of_accounts?: boolean;
};

const CompaniesPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company: current } = useSession();
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['companies'], queryFn: () => api<Company[]>('/admin/companies') });
  const { data: currencies = [] } = useCurrencies();
  const [form, setForm] = useState<Company | null>(null);
  const set = <K extends keyof Company>(key: K, value: Company[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const canManage = can('admin.tenant');

  const save = async () => {
    if (!form) return;
    try {
      const { id, ...body } = form;
      await api(id ? `/admin/companies/${id}` : '/admin/companies', { method: id ? 'PUT' : 'POST', body });
      notifySuccess(t('saved'));
      setForm(null);
      await queryClient.invalidateQueries();
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title={t('navCompanies')}
        actions={
          canManage && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() =>
                setForm({
                  code: '',
                  name_ar: '',
                  name_en: '',
                  base_currency: 'KWD',
                  commercial_reg_no: null,
                  tax_no: null,
                  fiscal_year_start_month: 1,
                  require_approval: false,
                  rounding_account_id: null,
                  retained_earnings_account_id: null,
                  is_active: true,
                  first_fiscal_year: new Date().getFullYear(),
                  seed_chart_of_accounts: true,
                })
              }
            >
              {t('newCompany')}
            </Button>
          )
        }
      />
      <Paper withBorder p="sm">
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('code')}</Table.Th>
              <Table.Th>{t('name')}</Table.Th>
              <Table.Th>{t('baseCurrency')}</Table.Th>
              <Table.Th>{t('requireApproval')}</Table.Th>
              <Table.Th>{t('status')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td className="ltr">{c.code}</Table.Td>
                <Table.Td>{name(c)}</Table.Td>
                <Table.Td>{c.base_currency}</Table.Td>
                <Table.Td>{c.require_approval ? t('yes') : t('no')}</Table.Td>
                <Table.Td>{c.is_active ? t('active') : t('inactive')}</Table.Td>
                <Table.Td>
                  {canManage && (
                    <ActionIcon variant="subtle" aria-label={t('edit')} onClick={() => setForm({ ...c })}>
                      <IconPencil size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? t('edit') : t('newCompany')} size="lg">
        {form && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('code')} required value={form.code} onChange={(e) => set('code', e.currentTarget.value)} classNames={{ input: 'ltr' }} />
              <TextInput label={t('nameAr')} value={form.name_ar} onChange={(e) => set('name_ar', e.currentTarget.value)} dir="rtl" />
              <TextInput label={t('nameEn')} value={form.name_en} onChange={(e) => set('name_en', e.currentTarget.value)} dir="ltr" />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Select label={t('baseCurrency')} searchable data={currencies.length ? currencies.map((c) => c.code) : [form.base_currency]} value={form.base_currency} onChange={(v) => set('base_currency', v ?? 'KWD')} allowDeselect={false} />
              <TextInput label={t('commercialReg')} value={form.commercial_reg_no ?? ''} onChange={(e) => set('commercial_reg_no', e.currentTarget.value || null)} />
              <TextInput label={t('taxNo')} value={form.tax_no ?? ''} onChange={(e) => set('tax_no', e.currentTarget.value || null)} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <NumberInput label={t('fiscalYearStartMonth')} min={1} max={12} value={form.fiscal_year_start_month} onChange={(v) => set('fiscal_year_start_month', Number(v))} />
              {!form.id && <NumberInput label={t('firstFiscalYear')} min={2000} max={2100} value={form.first_fiscal_year} onChange={(v) => set('first_fiscal_year', Number(v))} />}
            </SimpleGrid>
            {form.id && form.id === current?.id && (
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <AccountSelect label={t('roundingAccount')} value={form.rounding_account_id} onChange={(v) => set('rounding_account_id', v)} />
                <AccountSelect label={t('retainedEarningsAccount')} value={form.retained_earnings_account_id} onChange={(v) => set('retained_earnings_account_id', v)} />
              </SimpleGrid>
            )}
            <Checkbox label={t('requireApproval')} checked={form.require_approval} onChange={(e) => set('require_approval', e.currentTarget.checked)} />
            {!form.id && <Checkbox label={t('seedCoa')} checked={!!form.seed_chart_of_accounts} onChange={(e) => set('seed_chart_of_accounts', e.currentTarget.checked)} />}
            {form.id && <Checkbox label={t('active')} checked={form.is_active} onChange={(e) => set('is_active', e.currentTarget.checked)} />}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setForm(null)}>
                {t('cancel')}
              </Button>
              <Button onClick={save}>{t('save')}</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
};

export default CompaniesPage;
