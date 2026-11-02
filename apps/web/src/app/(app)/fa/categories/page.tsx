'use client';

import { ActionIcon, Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import type { DepreciationMethod } from '@erp/shared';
import { IconLock, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AccountSelect, PageHeader } from '@/components/common';
import { useFaCategories, useMethodOptions } from '@/components/fixed-assets';
import { notifyError, notifySuccess } from '@/components/notify';
import { EmptyRow, TableSkeletonRows } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { FaCategory } from '@/lib/types';

type Form = {
  id?: string;
  code: string;
  name_ar: string;
  name_en: string;
  asset_account_id: string | null;
  accum_dep_account_id: string | null;
  dep_expense_account_id: string | null;
  disposal_account_id: string | null;
  method: DepreciationMethod;
  useful_life_months: number | '';
  declining_rate: string;
  residual_percent: string;
  is_active: boolean;
  lock_accounts: boolean;
};

const blank = (): Form => ({
  code: '',
  name_ar: '',
  name_en: '',
  asset_account_id: null,
  accum_dep_account_id: null,
  dep_expense_account_id: null,
  disposal_account_id: null,
  method: 'STRAIGHT_LINE',
  useful_life_months: 60,
  declining_rate: '',
  residual_percent: '0',
  is_active: true,
  lock_accounts: false,
});

const fromCategory = (c: FaCategory): Form => ({
  id: c.id,
  code: c.code,
  name_ar: c.name_ar,
  name_en: c.name_en,
  asset_account_id: c.asset_account_id,
  accum_dep_account_id: c.accum_dep_account_id,
  dep_expense_account_id: c.dep_expense_account_id,
  disposal_account_id: c.disposal_account_id,
  method: c.method,
  useful_life_months: c.useful_life_months ?? '',
  declining_rate: c.declining_rate ?? '',
  residual_percent: String(Number(c.residual_percent)),
  is_active: c.is_active,
  lock_accounts: c.accounts_locked,
});

const CategoriesPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useFaCategories();
  const methods = useMethodOptions();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can('fa.manage');
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const refresh = () => queryClient.invalidateQueries({ queryKey: [company?.id, 'fa-categories'] });

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const { id, ...body } = form;
      await api(id ? `/fa/categories/${id}` : '/fa/categories', {
        method: id ? 'PUT' : 'POST',
        body: {
          ...body,
          useful_life_months: body.method === 'STRAIGHT_LINE' && body.useful_life_months !== '' ? body.useful_life_months : null,
          declining_rate: body.method === 'DECLINING_BALANCE' ? body.declining_rate || null : null,
          residual_percent: body.residual_percent || '0',
        },
      });
      notifySuccess(t('saved'));
      setForm(null);
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: FaCategory) => {
    if (!window.confirm(`${t('confirmDelete')}\n${c.code} — ${name(c)}`)) return;
    try {
      await api(`/fa/categories/${c.id}`, { method: 'DELETE' });
      notifySuccess(t('deleted'));
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const describe = (c: FaCategory) =>
    c.method === 'STRAIGHT_LINE' ? `${t('methodSTRAIGHT_LINE')} · ${c.useful_life_months}` : c.method === 'DECLINING_BALANCE' ? `${t('methodDECLINING_BALANCE')} · ${Number(c.declining_rate)}%` : t('methodNONE');

  return (
    <>
      <PageHeader
        title={t('navAssetCategories')}
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setForm(blank())}>
              {t('add')}
            </Button>
          )
        }
      />
      <Paper withBorder p="sm">
        <Table.ScrollContainer minWidth={760}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('code')}</Table.Th>
                <Table.Th>{t('name')}</Table.Th>
                <Table.Th>{t('depMethod')}</Table.Th>
                <Table.Th>{t('assets')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
                {canManage && <Table.Th>{t('actions')}</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && <TableSkeletonRows cols={6} />}
              {!isLoading && data.length === 0 && <EmptyRow cols={6} />}
              {data.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td className="ltr" fw={500}>
                    {c.code}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6}>
                      <Text size="sm">{name(c)}</Text>
                      {c.accounts_locked && (
                        <Badge size="xs" variant="light" leftSection={<IconLock size={10} />}>
                          {t('accountsLocked')}
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>{describe(c)}</Table.Td>
                  <Table.Td className="num">{c.asset_count}</Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={c.is_active ? 'teal' : 'gray'}>
                      {c.is_active ? t('active') : t('inactive')}
                    </Badge>
                  </Table.Td>
                  {canManage && (
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon variant="subtle" aria-label={t('edit')} onClick={() => setForm(fromCategory(c))}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        {c.asset_count === 0 && (
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

      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? t('edit') : t('add')} size="xl">
        {form && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('code')} required value={form.code} onChange={(e) => set('code', e.currentTarget.value)} classNames={{ input: 'ltr' }} />
              <TextInput label={t('nameAr')} value={form.name_ar} onChange={(e) => set('name_ar', e.currentTarget.value)} dir="rtl" />
              <TextInput label={t('nameEn')} value={form.name_en} onChange={(e) => set('name_en', e.currentTarget.value)} dir="ltr" />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Select label={t('depMethod')} data={methods} value={form.method} onChange={(v) => set('method', (v as DepreciationMethod) ?? 'STRAIGHT_LINE')} allowDeselect={false} />
              {form.method === 'STRAIGHT_LINE' && (
                <NumberInput label={t('usefulLife')} min={1} max={1200} value={form.useful_life_months} onChange={(v) => set('useful_life_months', v === '' ? '' : Number(v))} />
              )}
              {form.method === 'DECLINING_BALANCE' && (
                <TextInput label={t('decliningRate')} value={form.declining_rate} onChange={(e) => set('declining_rate', e.currentTarget.value)} classNames={{ input: 'num' }} />
              )}
              {form.method !== 'NONE' && (
                <TextInput label={t('residualPercent')} value={form.residual_percent} onChange={(e) => set('residual_percent', e.currentTarget.value)} classNames={{ input: 'num' }} />
              )}
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <AccountSelect label={t('assetAccount')} required value={form.asset_account_id} onChange={(v) => set('asset_account_id', v)} />
              {form.method !== 'NONE' && <AccountSelect label={t('accumDepAccount')} required value={form.accum_dep_account_id} onChange={(v) => set('accum_dep_account_id', v)} />}
              {form.method !== 'NONE' && <AccountSelect label={t('depExpenseAccount')} required value={form.dep_expense_account_id} onChange={(v) => set('dep_expense_account_id', v)} />}
              <AccountSelect label={t('disposalAccount')} required value={form.disposal_account_id} onChange={(v) => set('disposal_account_id', v)} />
            </SimpleGrid>
            <Checkbox label={t('lockAccounts')} checked={form.lock_accounts} onChange={(e) => set('lock_accounts', e.currentTarget.checked)} />
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

export default CategoriesPage;
