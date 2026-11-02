'use client';

import { ActionIcon, Badge, Button, Checkbox, Group, Modal, Paper, SimpleGrid, Stack, Table, TextInput } from '@mantine/core';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AccountSelect, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { EmptyRow, TableSkeletonRows } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCompanyQuery } from '@/lib/queries';
import { useSession } from '@/lib/session';

type TaxCode = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  rate: string;
  sales_account_id: string | null;
  purchase_account_id: string | null;
  sales_account_code: string | null;
  purchase_account_code: string | null;
  is_active: boolean;
  in_use: boolean;
};
type Form = { id?: string; code: string; name_ar: string; name_en: string; rate: string; sales_account_id: string | null; purchase_account_id: string | null; is_active: boolean };

const blank = (): Form => ({ code: '', name_ar: '', name_en: '', rate: '', sales_account_id: null, purchase_account_id: null, is_active: true });

const TaxCodesPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useCompanyQuery<TaxCode[]>(['tax-codes'], '/tax/codes');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can('gl.master.manage');
  const refresh = () => queryClient.invalidateQueries({ queryKey: [company?.id, 'tax-codes'] });

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const { id, ...body } = form;
      await api(id ? `/tax/codes/${id}` : '/tax/codes', { method: id ? 'PUT' : 'POST', body });
      notifySuccess(t('saved'));
      setForm(null);
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: TaxCode) => {
    if (!window.confirm(`${t('confirmDelete')}\n${c.code} — ${name(c)}`)) return;
    try {
      await api(`/tax/codes/${c.id}`, { method: 'DELETE' });
      notifySuccess(t('deleted'));
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title={t('navTaxCodes')}
        subtitle={t('taxCodesSubtitle')}
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setForm(blank())}>
              {t('add')}
            </Button>
          )
        }
      />
      <Paper withBorder p="sm">
        <Table.ScrollContainer minWidth={720}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('code')}</Table.Th>
                <Table.Th>{t('name')}</Table.Th>
                <Table.Th style={{ textAlign: 'end' }}>{t('taxRate')}</Table.Th>
                <Table.Th>{t('salesTaxAccount')}</Table.Th>
                <Table.Th>{t('purchaseTaxAccount')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
                {canManage && <Table.Th>{t('actions')}</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && <TableSkeletonRows cols={7} />}
              {!isLoading && data.length === 0 && <EmptyRow cols={7} />}
              {data.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td className="ltr" fw={500}>{c.code}</Table.Td>
                  <Table.Td>{name(c)}</Table.Td>
                  <Table.Td className="amount-cell">{Number(c.rate)}%</Table.Td>
                  <Table.Td className="ltr">{c.sales_account_code ?? '—'}</Table.Td>
                  <Table.Td className="ltr">{c.purchase_account_code ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={c.is_active ? 'teal' : 'gray'}>{c.is_active ? t('active') : t('inactive')}</Badge>
                  </Table.Td>
                  {canManage && (
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon variant="subtle" aria-label={t('edit')} onClick={() => setForm({ id: c.id, code: c.code, name_ar: c.name_ar, name_en: c.name_en, rate: String(Number(c.rate)), sales_account_id: c.sales_account_id, purchase_account_id: c.purchase_account_id, is_active: c.is_active })}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        {!c.in_use && (
                          <ActionIcon variant="subtle" color="red" aria-label={t('delete')} onClick={() => remove(c)}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        )}
                      </Group>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? t('edit') : t('add')} size="lg">
        {form && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label={t('code')} required value={form.code} onChange={(e) => setForm({ ...form, code: e.currentTarget.value })} />
              <TextInput label={`${t('taxRate')} %`} required value={form.rate} onChange={(e) => setForm({ ...form, rate: e.currentTarget.value })} classNames={{ input: 'num' }} inputMode="decimal" />
              <TextInput label={t('nameAr')} dir="rtl" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.currentTarget.value })} />
              <TextInput label={t('nameEn')} dir="ltr" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.currentTarget.value })} />
              <AccountSelect label={t('salesTaxAccount')} description={t('salesTaxAccountHint')} clearable value={form.sales_account_id} onChange={(v) => setForm({ ...form, sales_account_id: v })} />
              <AccountSelect label={t('purchaseTaxAccount')} description={t('purchaseTaxAccountHint')} clearable value={form.purchase_account_id} onChange={(v) => setForm({ ...form, purchase_account_id: v })} />
            </SimpleGrid>
            <Checkbox label={t('active')} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })} />
            <Group justify="flex-end">
              <Button onClick={save} loading={busy} disabled={!form.code || form.rate === ''}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
};

export default TaxCodesPage;
