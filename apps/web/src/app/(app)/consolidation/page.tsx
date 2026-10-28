'use client';

import { ActionIcon, Badge, Button, Checkbox, Group, Modal, MultiSelect, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { sumAmounts } from '@erp/shared';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

type GroupRow = { id?: string; code: string; name_ar: string; name_en: string; parent_company_id: string | null; presentation_currency: string; member_company_ids: string[]; is_active: boolean };
type Adjustment = { id: string; adjustment_date: string; description: string; lines: { account_code: string; debit: string; credit: string }[] };
type AdjLine = { account_code: string; debit: string; credit: string };

const ConsolidationPage = () => {
  const { t, name, errorText } = useI18n();
  const { me, can } = useSession();
  const queryClient = useQueryClient();
  const companies = me?.companies ?? [];
  const { data: groups = [] } = useQuery({ queryKey: ['consolidation-groups-all'], queryFn: () => api<GroupRow[]>('/consolidation/groups') });
  const [form, setForm] = useState<GroupRow | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const adjustments = useQuery({ queryKey: ['consolidation-adjustments', selected], queryFn: () => api<Adjustment[]>(`/consolidation/groups/${selected}/adjustments`), enabled: !!selected });
  const [adj, setAdj] = useState<{ adjustment_date: string; description: string; lines: AdjLine[] } | null>(null);
  const canManage = can('gl.consolidation.manage');
  const companyLabel = (id: string) => {
    const c = companies.find((x) => x.id === id);
    return c ? `${c.code} — ${name(c)}` : id;
  };

  const saveGroup = async () => {
    if (!form) return;
    try {
      const { id, ...body } = form;
      await api(id ? `/consolidation/groups/${id}` : '/consolidation/groups', { method: 'POST', body });
      notifySuccess(t('saved'));
      setForm(null);
      await queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('consolidation') || q.queryKey[1] === 'consolidation-groups' });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const saveAdjustment = async () => {
    if (!adj || !selected) return;
    try {
      await api(`/consolidation/groups/${selected}/adjustments`, { method: 'POST', body: { ...adj, lines: adj.lines.filter((l) => l.account_code) } });
      notifySuccess(t('saved'));
      setAdj(null);
      await adjustments.refetch();
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const removeAdjustment = async (a: Adjustment) => {
    if (!window.confirm(t('confirmDelete'))) return;
    await api(`/consolidation/groups/${selected}/adjustments/${a.id}`, { method: 'DELETE' }).catch((e: unknown) => notifyError(errorText(e)));
    await adjustments.refetch();
  };

  const adjTotal = (lines: AdjLine[], key: 'debit' | 'credit') => sumAmounts(lines.map((l) => (/^\d+(\.\d+)?$/.test(l[key]) ? l[key] : '0'))).toString();

  return (
    <Stack>
      <PageHeader
        title={t('navConsolidation')}
        actions={
          canManage && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => setForm({ code: '', name_ar: '', name_en: '', parent_company_id: companies[0]?.id ?? null, presentation_currency: companies[0]?.base_currency ?? 'KWD', member_company_ids: [], is_active: true })}
            >
              {t('add')}
            </Button>
          )
        }
      />
      <Paper withBorder p="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('code')}</Table.Th>
              <Table.Th>{t('name')}</Table.Th>
              <Table.Th>{t('parentCompany')}</Table.Th>
              <Table.Th>{t('members')}</Table.Th>
              <Table.Th>{t('presentationCurrency')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.map((g) => (
              <Table.Tr key={g.id} className="clickable" onClick={() => setSelected(g.id ?? null)} bg={selected === g.id ? 'var(--mantine-color-indigo-0)' : undefined}>
                <Table.Td className="ltr">{g.code}</Table.Td>
                <Table.Td>{name(g)}</Table.Td>
                <Table.Td>{g.parent_company_id ? companyLabel(g.parent_company_id) : ''}</Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {g.member_company_ids.map((id) => (
                      <Badge key={id} variant="light" className="ltr">
                        {companies.find((c) => c.id === id)?.code ?? '?'}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td>{g.presentation_currency}</Table.Td>
                <Table.Td onClick={(e) => e.stopPropagation()}>
                  <Group gap={4} wrap="nowrap">
                    <Button size="xs" variant="light" component={Link} href={`/reports/consolidated-balance-sheet?group_id=${g.id}`}>
                      {t('reportConsolidatedBs')}
                    </Button>
                    <Button size="xs" variant="light" component={Link} href={`/reports/consolidation-worksheet?group_id=${g.id}`}>
                      {t('reportConsolidationWorksheet')}
                    </Button>
                    {canManage && (
                      <ActionIcon variant="subtle" onClick={() => setForm({ ...g })} aria-label={t('edit')}>
                        <IconPencil size={16} />
                      </ActionIcon>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {groups.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
      </Paper>

      {selected && (
        <Paper withBorder p="md">
          <Group justify="space-between" mb="sm">
            <Title order={5}>{t('adjustments')}</Title>
            {canManage && (
              <Button
                size="xs"
                leftSection={<IconPlus size={14} />}
                onClick={() => setAdj({ adjustment_date: new Date().toISOString().slice(0, 10), description: '', lines: [{ account_code: '', debit: '', credit: '' }, { account_code: '', debit: '', credit: '' }] })}
              >
                {t('add')}
              </Button>
            )}
          </Group>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('date')}</Table.Th>
                <Table.Th>{t('description')}</Table.Th>
                <Table.Th>{t('lines')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(adjustments.data ?? []).map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td className="num">{a.adjustment_date}</Table.Td>
                  <Table.Td>{a.description}</Table.Td>
                  <Table.Td className="ltr">{a.lines.map((l) => `${l.account_code} ${Number(l.debit) ? `Dr ${l.debit}` : `Cr ${l.credit}`}`).join(' · ')}</Table.Td>
                  <Table.Td>
                    {canManage && (
                      <ActionIcon variant="subtle" color="red" onClick={() => removeAdjustment(a)} aria-label={t('delete')}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {(adjustments.data ?? []).length === 0 && <Text c="dimmed">{t('noData')}</Text>}
        </Paper>
      )}

      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? t('edit') : t('add')} size="lg">
        {form && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
              <TextInput label={t('nameAr')} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.currentTarget.value })} dir="rtl" />
              <TextInput label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.currentTarget.value })} dir="ltr" />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select
                label={t('parentCompany')}
                data={companies.map((c) => ({ value: c.id, label: `${c.code} — ${name(c)}` }))}
                value={form.parent_company_id}
                onChange={(v) => setForm({ ...form, parent_company_id: v, presentation_currency: companies.find((c) => c.id === v)?.base_currency ?? form.presentation_currency })}
                allowDeselect={false}
              />
              <TextInput label={t('presentationCurrency')} value={form.presentation_currency} readOnly />
            </SimpleGrid>
            <MultiSelect label={t('members')} data={companies.filter((c) => c.id !== form.parent_company_id).map((c) => ({ value: c.id, label: `${c.code} — ${name(c)}` }))} value={form.member_company_ids.filter((id) => id !== form.parent_company_id)} onChange={(v) => setForm({ ...form, member_company_ids: v })} />
            <Checkbox label={t('active')} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })} />
            <Group justify="flex-end">
              <Button onClick={saveGroup}>{t('save')}</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!adj} onClose={() => setAdj(null)} title={t('adjustments')} size="lg">
        {adj && (
          <Stack>
            <SimpleGrid cols={2}>
              <TextInput type="date" label={t('date')} value={adj.adjustment_date} onChange={(e) => setAdj({ ...adj, adjustment_date: e.currentTarget.value })} />
              <TextInput label={t('description')} value={adj.description} onChange={(e) => setAdj({ ...adj, description: e.currentTarget.value })} />
            </SimpleGrid>
            {adj.lines.map((l, i) => (
              <Group key={i} wrap="nowrap">
                <TextInput placeholder={t('accountCode')} classNames={{ input: 'ltr' }} value={l.account_code} onChange={(e) => { const v = e.currentTarget.value; setAdj({ ...adj, lines: adj.lines.map((x, j) => (j === i ? { ...x, account_code: v } : x)) }); }} />
                <TextInput placeholder={t('debit')} classNames={{ input: 'ltr' }} value={l.debit} onChange={(e) => { const v = e.currentTarget.value; setAdj({ ...adj, lines: adj.lines.map((x, j) => (j === i ? { ...x, debit: v, credit: v ? '' : x.credit } : x)) }); }} />
                <TextInput placeholder={t('credit')} classNames={{ input: 'ltr' }} value={l.credit} onChange={(e) => { const v = e.currentTarget.value; setAdj({ ...adj, lines: adj.lines.map((x, j) => (j === i ? { ...x, credit: v, debit: v ? '' : x.debit } : x)) }); }} />
                <ActionIcon variant="subtle" color="red" onClick={() => setAdj({ ...adj, lines: adj.lines.filter((_, j) => j !== i) })} aria-label={t('removeLine')}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            ))}
            <Group justify="space-between">
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setAdj({ ...adj, lines: [...adj.lines, { account_code: '', debit: '', credit: '' }] })}>
                {t('addLine')}
              </Button>
              <Text size="sm" className="num">
                {adjTotal(adj.lines, 'debit')} / {adjTotal(adj.lines, 'credit')}
              </Text>
            </Group>
            <Group justify="flex-end">
              <Button onClick={saveAdjustment} disabled={adjTotal(adj.lines, 'debit') !== adjTotal(adj.lines, 'credit')}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};

export default ConsolidationPage;
