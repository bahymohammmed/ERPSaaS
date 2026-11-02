'use client';

import { ActionIcon, Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput } from '@mantine/core';
import type { LedgerSide } from '@erp/shared';
import { IconFileText, IconPencil, IconPlus, IconSearch } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AccountSelect, Amount, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { EmptyRow, TableSkeletonRows } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCompanyQuery, useCurrencies } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { type Party, SIDE_UI } from './config';

type Form = Omit<Party, 'id' | 'balance' | 'control_account_code' | 'control_account_id' | 'payment_terms_days'> & { id?: string; payment_terms_days: number | '' };

const blank = (currency: string): Form => ({
  code: '',
  name_ar: '',
  name_en: '',
  currency_code: currency,
  default_account_id: null,
  payment_terms_days: 30,
  credit_limit: null,
  contact_name: null,
  email: null,
  phone: null,
  address: null,
  tax_no: null,
  commercial_reg_no: null,
  notes: null,
  is_active: true,
});

export const PartiesPage = ({ side }: { side: LedgerSide }) => {
  const ui = SIDE_UI[side];
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useCompanyQuery<Party[]>(['sl-parties', side], `/sl/${side}/parties`);
  const { data: currencies = [] } = useCurrencies();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can(ui.manage);
  const minor = company?.base_minor_units ?? 3;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? data.filter((p) => [p.code, p.name_ar, p.name_en, p.phone ?? '', p.email ?? ''].some((v) => v.toLowerCase().includes(q))) : data;
  }, [data, search]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const { id, ...body } = form;
      await api(id ? `/sl/${side}/parties/${id}` : `/sl/${side}/parties`, {
        method: id ? 'PUT' : 'POST',
        body: { ...body, payment_terms_days: body.payment_terms_days === '' ? 0 : body.payment_terms_days, credit_limit: body.credit_limit || null },
      });
      notifySuccess(t('saved'));
      setForm(null);
      await queryClient.invalidateQueries({ queryKey: [company?.id, 'sl-parties', side] });
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t(ui.partiesTitle)}
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setForm(blank(company?.base_currency ?? 'KWD'))}>
              {t(ui.newParty)}
            </Button>
          )
        }
      />
      <Paper withBorder p="sm">
        <TextInput leftSection={<IconSearch size={16} />} placeholder={t('search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} mb="sm" maw={320} />
        <Table.ScrollContainer minWidth={760}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('code')}</Table.Th>
                <Table.Th>{t('name')}</Table.Th>
                <Table.Th>{t('phone')}</Table.Th>
                <Table.Th>{t('currency')}</Table.Th>
                <Table.Th style={{ textAlign: 'end' }}>{t('balanceDue')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && <TableSkeletonRows cols={7} />}
              {!isLoading && rows.length === 0 && <EmptyRow cols={7} />}
              {rows.map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td className="ltr" fw={500}>
                    {p.code}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{name(p)}</Text>
                    {p.contact_name && (
                      <Text size="xs" c="dimmed">
                        {p.contact_name}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td className="ltr">{p.phone}</Table.Td>
                  <Table.Td className="ltr">{p.currency_code}</Table.Td>
                  <Table.Td className="amount-cell" fw={600}>
                    <Amount value={p.balance} minor={minor} />
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={p.is_active ? 'teal' : 'gray'}>
                      {p.is_active ? t('active') : t('inactive')}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        component={Link}
                        href={`/reports/${side === 'AR' ? 'customer-statement' : 'supplier-statement'}?party_id=${p.id}`}
                        aria-label={t(side === 'AR' ? 'reportCustomerStatement' : 'reportSupplierStatement')}
                      >
                        <IconFileText size={16} />
                      </ActionIcon>
                      {canManage && (
                        <ActionIcon variant="subtle" aria-label={t('edit')} onClick={() => setForm({ ...p, payment_terms_days: p.payment_terms_days })}>
                          <IconPencil size={16} />
                        </ActionIcon>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? t('edit') : t(ui.newParty)} size="xl">
        {form && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('code')} required value={form.code} onChange={(e) => set('code', e.currentTarget.value)} classNames={{ input: 'ltr' }} />
              <TextInput label={t('nameAr')} value={form.name_ar} onChange={(e) => set('name_ar', e.currentTarget.value)} dir="rtl" />
              <TextInput label={t('nameEn')} value={form.name_en} onChange={(e) => set('name_en', e.currentTarget.value)} dir="ltr" />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Select label={t('currency')} data={currencies.map((c) => c.code)} value={form.currency_code} onChange={(v) => set('currency_code', v ?? form.currency_code)} allowDeselect={false} searchable />
              <NumberInput label={t('paymentTerms')} min={0} max={3650} value={form.payment_terms_days} onChange={(v) => set('payment_terms_days', v === '' ? '' : Number(v))} />
              <TextInput label={t('creditLimit')} value={form.credit_limit ?? ''} onChange={(e) => set('credit_limit', e.currentTarget.value || null)} classNames={{ input: 'num' }} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('contactName')} value={form.contact_name ?? ''} onChange={(e) => set('contact_name', e.currentTarget.value || null)} />
              <TextInput label={t('phone')} value={form.phone ?? ''} onChange={(e) => set('phone', e.currentTarget.value || null)} classNames={{ input: 'ltr' }} />
              <TextInput label={t('email')} value={form.email ?? ''} onChange={(e) => set('email', e.currentTarget.value || null)} classNames={{ input: 'ltr' }} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label={t('taxNo')} value={form.tax_no ?? ''} onChange={(e) => set('tax_no', e.currentTarget.value || null)} />
              <TextInput label={t('commercialReg')} value={form.commercial_reg_no ?? ''} onChange={(e) => set('commercial_reg_no', e.currentTarget.value || null)} />
            </SimpleGrid>
            <Textarea label={t('address')} autosize minRows={2} value={form.address ?? ''} onChange={(e) => set('address', e.currentTarget.value || null)} />
            <AccountSelect label={t('defaultLineAccount')} value={form.default_account_id} onChange={(v) => set('default_account_id', v)} />
            <Checkbox label={t('active')} checked={form.is_active} onChange={(e) => set('is_active', e.currentTarget.checked)} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setForm(null)}>
                {t('cancel')}
              </Button>
              <Button onClick={save} loading={busy}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
};
