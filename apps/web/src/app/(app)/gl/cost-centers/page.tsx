'use client';

import { ActionIcon, Badge, Button, Checkbox, Group, Modal, Paper, Select, SimpleGrid, Stack, Table, TextInput } from '@mantine/core';
import { COST_CENTER_TYPES, type CostCenterType } from '@erp/shared';
import { IconPencil, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CostCenterSelect, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCostCenters } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toTreeRows } from '@/lib/tree';
import type { CostCenter } from '@/lib/types';

type Form = {
  id?: string;
  code: string;
  name_ar: string;
  name_en: string;
  parent_id: string | null;
  is_posting: boolean;
  cc_type: CostCenterType;
  manager_user_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
};

const emptyForm = (parent?: CostCenter): Form => ({
  code: parent ? parent.code : '',
  name_ar: '',
  name_en: '',
  parent_id: parent?.id ?? null,
  is_posting: true,
  cc_type: parent?.cc_type ?? 'OTHER',
  manager_user_id: null,
  valid_from: null,
  valid_to: null,
  is_active: true,
});

const CostCentersPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useCostCenters();
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => api<{ user_id: string; full_name: string }[]>('/admin/users'),
    enabled: can('admin.users'),
  });
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const canManage = can('gl.master.manage');

  const rows = useMemo(() => {
    const tree = toTreeRows(data);
    const q = search.trim().toLowerCase();
    return q ? tree.filter((c) => c.code.toLowerCase().includes(q) || c.name_ar.includes(search.trim()) || c.name_en.toLowerCase().includes(q)) : tree;
  }, [data, search]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const refresh = () => queryClient.invalidateQueries({ queryKey: [company?.id, 'cost-centers'] });

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const { id, ...body } = form;
      await api(id ? `/gl/cost-centers/${id}` : '/gl/cost-centers', {
        method: id ? 'PUT' : 'POST',
        body: { ...body, valid_from: body.valid_from || null, valid_to: body.valid_to || null },
      });
      notifySuccess(t('saved'));
      setForm(null);
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (cc: CostCenter) => {
    if (!window.confirm(`${t('confirmDelete')}\n${cc.code} — ${name(cc)}`)) return;
    try {
      await api(`/gl/cost-centers/${cc.id}`, { method: 'DELETE' });
      notifySuccess(t('deleted'));
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title={t('navCostCenters')}
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
        <Table.ScrollContainer minWidth={700}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('code')}</Table.Th>
                <Table.Th>{t('name')}</Table.Th>
                <Table.Th>{t('ccType')}</Table.Th>
                <Table.Th>{t('posting')}</Table.Th>
                <Table.Th>{t('validFrom')}</Table.Th>
                <Table.Th>{t('validTo')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
                {canManage && <Table.Th>{t('actions')}</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={8}>{t('loading')}</Table.Td>
                </Table.Tr>
              )}
              {rows.map((c) => (
                <Table.Tr key={c.id} className={c.is_posting ? undefined : 'row-header'}>
                  <Table.Td className="ltr">{c.code}</Table.Td>
                  <Table.Td style={{ paddingInlineStart: 12 + c.depth * 18 }}>{name(c)}</Table.Td>
                  <Table.Td>{t(`cc${c.cc_type}`)}</Table.Td>
                  <Table.Td>{c.is_posting ? t('posting') : t('header')}</Table.Td>
                  <Table.Td className="num">{c.valid_from ?? ''}</Table.Td>
                  <Table.Td className="num">{c.valid_to ?? ''}</Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={c.is_active ? 'teal' : 'gray'}>
                      {c.is_active ? t('active') : t('inactive')}
                    </Badge>
                  </Table.Td>
                  {canManage && (
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        {!c.is_posting && (
                          <ActionIcon variant="subtle" aria-label={t('add')} onClick={() => setForm(emptyForm(c))}>
                            <IconPlus size={16} />
                          </ActionIcon>
                        )}
                        <ActionIcon variant="subtle" aria-label={t('edit')} onClick={() => setForm({ ...c })}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        {!c.has_transactions && (
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
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('code')} required value={form.code} onChange={(e) => set('code', e.currentTarget.value)} classNames={{ input: 'ltr' }} />
              <TextInput label={t('nameAr')} value={form.name_ar} onChange={(e) => set('name_ar', e.currentTarget.value)} dir="rtl" />
              <TextInput label={t('nameEn')} value={form.name_en} onChange={(e) => set('name_en', e.currentTarget.value)} dir="ltr" />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <CostCenterSelect label={t('parent')} postingOnly={false} activeOnly={false} value={form.parent_id} onChange={(v) => set('parent_id', v)} />
              <Select
                label={t('ccType')}
                data={COST_CENTER_TYPES.map((v) => ({ value: v, label: t(`cc${v}`) }))}
                value={form.cc_type}
                onChange={(v) => set('cc_type', (v ?? 'OTHER') as CostCenterType)}
                allowDeselect={false}
              />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput type="date" label={t('validFrom')} value={form.valid_from ?? ''} onChange={(e) => set('valid_from', e.currentTarget.value || null)} />
              <TextInput type="date" label={t('validTo')} value={form.valid_to ?? ''} onChange={(e) => set('valid_to', e.currentTarget.value || null)} />
              <Select
                label={t('manager')}
                clearable
                data={(members.data ?? []).map((m) => ({ value: m.user_id, label: m.full_name }))}
                value={form.manager_user_id}
                onChange={(v) => set('manager_user_id', v)}
              />
            </SimpleGrid>
            <Group>
              <Checkbox label={t('isPostingCc')} checked={form.is_posting} onChange={(e) => set('is_posting', e.currentTarget.checked)} />
              <Checkbox label={t('active')} checked={form.is_active} onChange={(e) => set('is_active', e.currentTarget.checked)} />
            </Group>
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

export default CostCentersPage;
