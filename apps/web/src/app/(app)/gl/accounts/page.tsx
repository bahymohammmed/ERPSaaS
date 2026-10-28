'use client';

import { ActionIcon, Badge, Button, Checkbox, Group, Modal, MultiSelect, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import {
  ACCOUNT_TYPES,
  type AccountType,
  CASH_FLOW_CATEGORIES,
  DEFAULT_NORMAL_BALANCE,
  DIMENSION_RULES,
  type DimensionRule,
  MODULES,
  type ModuleCode,
} from '@erp/shared';
import { IconPencil, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { AccountSelect, CostCenterSelect, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useAccounts, useCostCenters, useCurrencies, useDimensions } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toTreeRows } from '@/lib/tree';
import type { Account } from '@/lib/types';

type Form = {
  id?: string;
  code: string;
  name_ar: string;
  name_en: string;
  parent_id: string | null;
  is_posting: boolean;
  account_type: AccountType;
  normal_balance: 'DEBIT' | 'CREDIT';
  cost_center_rule: DimensionRule;
  default_cost_center_id: string | null;
  allowed_cost_center_ids: string[];
  is_control: boolean;
  control_module: ModuleCode | null;
  allowed_currencies: string[];
  cash_flow_category: string | null;
  is_reconcilable: boolean;
  revalue: boolean;
  is_active: boolean;
  dimension_rules: { dimension_type_id: string; rule: DimensionRule }[];
};

const emptyForm = (parent?: Account): Form => ({
  code: parent ? parent.code : '',
  name_ar: '',
  name_en: '',
  parent_id: parent?.id ?? null,
  is_posting: true,
  account_type: parent?.account_type ?? 'ASSET',
  normal_balance: parent?.normal_balance ?? 'DEBIT',
  cost_center_rule: parent?.account_type === 'EXPENSE' ? 'REQUIRED' : 'OPTIONAL',
  default_cost_center_id: null,
  allowed_cost_center_ids: [],
  is_control: false,
  control_module: null,
  allowed_currencies: [],
  cash_flow_category: null,
  is_reconcilable: false,
  revalue: false,
  is_active: true,
  dimension_rules: [],
});

const AccountsPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useAccounts();
  const { data: costCenters = [] } = useCostCenters();
  const { data: currencies = [] } = useCurrencies();
  const { data: dimensions = [] } = useDimensions();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const canManage = can('gl.master.manage');

  const rows = useMemo(() => {
    const tree = toTreeRows(data);
    const q = search.trim().toLowerCase();
    if (!q) return tree;
    return tree.filter((a) => a.code.toLowerCase().includes(q) || a.name_ar.includes(search.trim()) || a.name_en.toLowerCase().includes(q));
  }, [data, search]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: [company?.id, 'accounts'] });

  const openEdit = async (account: Account) => {
    try {
      const full = await api<Account & { allowed_cost_center_ids: string[]; dimension_rules: Form['dimension_rules'] }>(`/gl/accounts/${account.id}`);
      setForm({
        ...emptyForm(),
        ...full,
        allowed_currencies: full.allowed_currencies ?? [],
        control_module: full.control_module,
        allowed_cost_center_ids: full.allowed_cost_center_ids,
        dimension_rules: full.dimension_rules,
      });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const { id, ...body } = form;
      await api(id ? `/gl/accounts/${id}` : '/gl/accounts', { method: id ? 'PUT' : 'POST', body });
      notifySuccess(t('saved'));
      setForm(null);
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (account: Account) => {
    if (!window.confirm(`${t('confirmDelete')}\n${account.code} — ${name(account)}`)) return;
    try {
      await api(`/gl/accounts/${account.id}`, { method: 'DELETE' });
      notifySuccess(t('deleted'));
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  return (
    <>
      <PageHeader
        title={t('navAccounts')}
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setForm(emptyForm())}>
              {t('add')}
            </Button>
          )
        }
      />
      <Paper withBorder p="sm">
        <TextInput leftSection={<IconSearch size={16} />} placeholder={t('search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} mb="sm" maw={360} />
        <Table.ScrollContainer minWidth={760}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('code')}</Table.Th>
                <Table.Th>{t('name')}</Table.Th>
                <Table.Th>{t('accountType')}</Table.Th>
                <Table.Th>{t('posting')}</Table.Th>
                <Table.Th>{t('costCenterRule')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
                {canManage && <Table.Th>{t('actions')}</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={7}>{t('loading')}</Table.Td>
                </Table.Tr>
              )}
              {rows.map((a) => (
                <Table.Tr key={a.id} className={a.is_posting ? undefined : 'row-header'}>
                  <Table.Td className="ltr">{a.code}</Table.Td>
                  <Table.Td style={{ paddingInlineStart: 12 + a.depth * 18 }}>
                    {name(a)}
                    {a.is_control && (
                      <Badge size="xs" ms={6} variant="outline">
                        {a.control_module}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{t(`type${a.account_type}`)}</Table.Td>
                  <Table.Td>{a.is_posting ? t('posting') : t('header')}</Table.Td>
                  <Table.Td>{a.is_posting ? t(`rule${a.cost_center_rule}`) : ''}</Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={a.is_active ? 'teal' : 'gray'}>
                      {a.is_active ? t('active') : t('inactive')}
                    </Badge>
                  </Table.Td>
                  {canManage && (
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        {!a.is_posting && (
                          <ActionIcon variant="subtle" aria-label={t('add')} onClick={() => setForm(emptyForm(a))}>
                            <IconPlus size={16} />
                          </ActionIcon>
                        )}
                        <ActionIcon variant="subtle" aria-label={t('edit')} onClick={() => openEdit(a)}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        {!a.has_transactions && (
                          <ActionIcon variant="subtle" color="red" aria-label={t('delete')} onClick={() => remove(a)}>
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
              <AccountSelect label={t('parent')} postingOnly={false} activeOnly={false} value={form.parent_id} onChange={(v) => set('parent_id', v)} />
              <Select
                label={t('accountType')}
                data={ACCOUNT_TYPES.map((v) => ({ value: v, label: t(`type${v}`) }))}
                value={form.account_type}
                onChange={(v) => {
                  const type = (v ?? 'ASSET') as AccountType;
                  setForm((f) => (f ? { ...f, account_type: type, normal_balance: DEFAULT_NORMAL_BALANCE[type] } : f));
                }}
                allowDeselect={false}
              />
              <Select
                label={t('normalBalance')}
                data={(['DEBIT', 'CREDIT'] as const).map((v) => ({ value: v, label: t(`balance${v}`) }))}
                value={form.normal_balance}
                onChange={(v) => set('normal_balance', v === 'CREDIT' ? 'CREDIT' : 'DEBIT')}
                allowDeselect={false}
              />
            </SimpleGrid>
            <Group>
              <Checkbox label={t('isPosting')} checked={form.is_posting} onChange={(e) => set('is_posting', e.currentTarget.checked)} />
              <Checkbox label={t('active')} checked={form.is_active} onChange={(e) => set('is_active', e.currentTarget.checked)} />
              <Checkbox label={t('reconcilable')} checked={form.is_reconcilable} onChange={(e) => set('is_reconcilable', e.currentTarget.checked)} />
              {form.is_posting && <Checkbox label={t('revalue')} checked={form.revalue} onChange={(e) => set('revalue', e.currentTarget.checked)} />}
            </Group>
            {form.is_posting && (
              <>
                <SimpleGrid cols={{ base: 1, sm: 3 }}>
                  <Select
                    label={t('costCenterRule')}
                    data={DIMENSION_RULES.map((v) => ({ value: v, label: t(`rule${v}`) }))}
                    value={form.cost_center_rule}
                    onChange={(v) => set('cost_center_rule', (v ?? 'OPTIONAL') as DimensionRule)}
                    allowDeselect={false}
                  />
                  <CostCenterSelect label={t('defaultCostCenter')} value={form.default_cost_center_id} onChange={(v) => set('default_cost_center_id', v)} disabled={form.cost_center_rule === 'NOT_ALLOWED'} />
                  <Select
                    label={t('cashFlowCategory')}
                    clearable
                    data={CASH_FLOW_CATEGORIES.map((v) => ({ value: v, label: t(`cf${v}`) }))}
                    value={form.cash_flow_category}
                    onChange={(v) => set('cash_flow_category', v)}
                  />
                </SimpleGrid>
                <MultiSelect
                  label={t('allowedCostCenters')}
                  searchable
                  clearable
                  disabled={form.cost_center_rule === 'NOT_ALLOWED'}
                  data={costCenters.map((c) => ({ value: c.id, label: `${c.code} — ${name(c)}` }))}
                  value={form.allowed_cost_center_ids}
                  onChange={(v) => set('allowed_cost_center_ids', v)}
                />
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <MultiSelect
                    label={t('allowedCurrencies')}
                    searchable
                    clearable
                    data={currencies.map((c) => c.code)}
                    value={form.allowed_currencies}
                    onChange={(v) => set('allowed_currencies', v)}
                  />
                  <Group align="flex-end" grow>
                    <Checkbox label={t('controlAccount')} checked={form.is_control} onChange={(e) => set('is_control', e.currentTarget.checked)} />
                    {form.is_control && (
                      <Select
                        label={t('controlModule')}
                        data={MODULES.filter((m) => m !== 'GL').map(String)}
                        value={form.control_module}
                        onChange={(v) => set('control_module', v as ModuleCode | null)}
                      />
                    )}
                  </Group>
                </SimpleGrid>
                {dimensions.length > 0 && (
                  <Stack gap={4}>
                    <Text fw={600} size="sm">
                      {t('dimensionRules')}
                    </Text>
                    {dimensions.map((d) => {
                      const rule = form.dimension_rules.find((r) => r.dimension_type_id === d.id)?.rule ?? 'OPTIONAL';
                      return (
                        <Group key={d.id} grow>
                          <Text size="sm">{name(d)}</Text>
                          <Select
                            size="xs"
                            data={DIMENSION_RULES.map((v) => ({ value: v, label: t(`rule${v}`) }))}
                            value={rule}
                            allowDeselect={false}
                            onChange={(v) =>
                              set('dimension_rules', [
                                ...form.dimension_rules.filter((r) => r.dimension_type_id !== d.id),
                                ...(v && v !== 'OPTIONAL' ? [{ dimension_type_id: d.id, rule: v as DimensionRule }] : []),
                              ])
                            }
                          />
                        </Group>
                      );
                    })}
                  </Stack>
                )}
              </>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setForm(null)}>
                {t('cancel')}
              </Button>
              <Button onClick={save} loading={saving}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
};

export default AccountsPage;
