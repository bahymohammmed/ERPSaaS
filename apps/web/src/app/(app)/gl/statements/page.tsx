'use client';

import { ActionIcon, Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { STATEMENT_ROW_TYPES } from '@erp/shared';
import { IconArrowDown, IconArrowUp, IconEye, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCompanyQuery } from '@/lib/queries';
import { useSession } from '@/lib/session';

type RowType = (typeof STATEMENT_ROW_TYPES)[number];
type StatementRow = {
  row_key: string | null;
  label_ar: string;
  label_en: string;
  row_type: RowType;
  accounts: string | null;
  sign: 'DEBIT' | 'CREDIT';
  formula: string | null;
  show_detail: boolean;
  bold: boolean;
  indent: number;
};
type Statement = { id?: string; code: string; name_ar: string; name_en: string; basis: 'PERIOD' | 'POSITION'; is_active: boolean; rows: StatementRow[] };

const blankRow = (): StatementRow => ({ row_key: '', label_ar: '', label_en: '', row_type: 'ACCOUNTS', accounts: '', sign: 'CREDIT', formula: '', show_detail: false, bold: false, indent: 0 });

const StatementsPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const { data = [] } = useCompanyQuery<Statement[]>(['statements'], '/gl/statements');
  const [form, setForm] = useState<Statement | null>(null);
  const canManage = can('gl.master.manage');

  const updateRow = (index: number, patch: Partial<StatementRow>) =>
    setForm((f) => (f ? { ...f, rows: f.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) } : f));
  const move = (index: number, delta: number) =>
    setForm((f) => {
      if (!f) return f;
      const rows = [...f.rows];
      const target = index + delta;
      if (target < 0 || target >= rows.length) return f;
      [rows[index], rows[target]] = [rows[target] as StatementRow, rows[index] as StatementRow];
      return { ...f, rows };
    });

  const save = async () => {
    if (!form) return;
    try {
      const { id, ...body } = form;
      await api(id ? `/gl/statements/${id}` : '/gl/statements', {
        method: id ? 'PUT' : 'POST',
        body: { ...body, rows: body.rows.map((r) => ({ ...r, row_key: r.row_key || null, accounts: r.accounts || null, formula: r.formula || null })) },
      });
      notifySuccess(t('saved'));
      setForm(null);
      await queryClient.invalidateQueries({ queryKey: [company?.id, 'statements'] });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const remove = async (s: Statement) => {
    if (!window.confirm(`${t('confirmDelete')}\n${s.code}`)) return;
    try {
      await api(`/gl/statements/${s.id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: [company?.id, 'statements'] });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title={t('navStatements')}
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setForm({ code: '', name_ar: '', name_en: '', basis: 'PERIOD', is_active: true, rows: [blankRow()] })}>
              {t('add')}
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
              <Table.Th>{t('basis')}</Table.Th>
              <Table.Th>{t('lines')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td className="ltr">{s.code}</Table.Td>
                <Table.Td>{name(s)}</Table.Td>
                <Table.Td>{t(`basis${s.basis}`)}</Table.Td>
                <Table.Td className="num">{s.rows.length}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon variant="subtle" component={Link} href={`/reports/statement?statement_id=${s.id}`} aria-label={t('view')}>
                      <IconEye size={16} />
                    </ActionIcon>
                    {canManage && (
                      <>
                        <ActionIcon variant="subtle" onClick={() => setForm({ ...s, rows: s.rows.map((r) => ({ ...r })) })} aria-label={t('edit')}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="red" onClick={() => remove(s)} aria-label={t('delete')}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {data.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
      </Paper>

      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? t('edit') : t('add')} size="100%">
        {form && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 4 }}>
              <TextInput label={t('code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
              <TextInput label={t('nameAr')} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.currentTarget.value })} dir="rtl" />
              <TextInput label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.currentTarget.value })} dir="ltr" />
              <Select
                label={t('basis')}
                data={(['PERIOD', 'POSITION'] as const).map((b) => ({ value: b, label: t(`basis${b}`) }))}
                value={form.basis}
                onChange={(v) => setForm({ ...form, basis: v === 'POSITION' ? 'POSITION' : 'PERIOD' })}
                allowDeselect={false}
              />
            </SimpleGrid>
            <Table.ScrollContainer minWidth={1300}>
              <Table verticalSpacing={2}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={70} />
                    <Table.Th w={100}>{t('rowKey')}</Table.Th>
                    <Table.Th w={120}>{t('rowType')}</Table.Th>
                    <Table.Th>{t('nameAr')}</Table.Th>
                    <Table.Th>{t('nameEn')}</Table.Th>
                    <Table.Th w={220}>{t('accountsSpec')} / {t('formula')}</Table.Th>
                    <Table.Th w={100}>{t('sign')}</Table.Th>
                    <Table.Th w={60}>{t('showDetail')}</Table.Th>
                    <Table.Th w={60}>{t('bold')}</Table.Th>
                    <Table.Th w={80}>{t('indent')}</Table.Th>
                    <Table.Th w={40} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {form.rows.map((r, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>
                        <Group gap={0} wrap="nowrap">
                          <ActionIcon size="sm" variant="subtle" onClick={() => move(i, -1)} aria-label={t('moveUp')}>
                            <IconArrowUp size={14} />
                          </ActionIcon>
                          <ActionIcon size="sm" variant="subtle" onClick={() => move(i, 1)} aria-label={t('moveDown')}>
                            <IconArrowDown size={14} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <TextInput size="xs" classNames={{ input: 'ltr' }} value={r.row_key ?? ''} onChange={(e) => updateRow(i, { row_key: e.currentTarget.value })} />
                      </Table.Td>
                      <Table.Td>
                        <Select size="xs" data={STATEMENT_ROW_TYPES.map(String)} value={r.row_type} onChange={(v) => updateRow(i, { row_type: (v ?? 'ACCOUNTS') as RowType })} allowDeselect={false} />
                      </Table.Td>
                      <Table.Td>
                        <TextInput size="xs" dir="rtl" value={r.label_ar} onChange={(e) => updateRow(i, { label_ar: e.currentTarget.value })} />
                      </Table.Td>
                      <Table.Td>
                        <TextInput size="xs" dir="ltr" value={r.label_en} onChange={(e) => updateRow(i, { label_en: e.currentTarget.value })} />
                      </Table.Td>
                      <Table.Td>
                        {r.row_type === 'ACCOUNTS' && <TextInput size="xs" classNames={{ input: 'ltr' }} value={r.accounts ?? ''} onChange={(e) => updateRow(i, { accounts: e.currentTarget.value })} />}
                        {r.row_type === 'FORMULA' && <TextInput size="xs" classNames={{ input: 'ltr' }} value={r.formula ?? ''} onChange={(e) => updateRow(i, { formula: e.currentTarget.value })} />}
                        {r.row_type === 'RESULT' && <Badge variant="light">{t('netProfit')}</Badge>}
                      </Table.Td>
                      <Table.Td>
                        {(r.row_type === 'ACCOUNTS' || r.row_type === 'RESULT') && (
                          <Select size="xs" data={(['DEBIT', 'CREDIT'] as const).map((v) => ({ value: v, label: t(`balance${v}`) }))} value={r.sign} onChange={(v) => updateRow(i, { sign: v === 'DEBIT' ? 'DEBIT' : 'CREDIT' })} allowDeselect={false} />
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Checkbox size="xs" checked={r.show_detail} disabled={r.row_type !== 'ACCOUNTS'} onChange={(e) => updateRow(i, { show_detail: e.currentTarget.checked })} />
                      </Table.Td>
                      <Table.Td>
                        <Checkbox size="xs" checked={r.bold} onChange={(e) => updateRow(i, { bold: e.currentTarget.checked })} />
                      </Table.Td>
                      <Table.Td>
                        <NumberInput size="xs" min={0} max={5} value={r.indent} onChange={(v) => updateRow(i, { indent: Number(v) || 0 })} />
                      </Table.Td>
                      <Table.Td>
                        <ActionIcon size="sm" color="red" variant="subtle" onClick={() => setForm({ ...form, rows: form.rows.filter((_, j) => j !== i) })} aria-label={t('removeLine')}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Group justify="space-between">
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setForm({ ...form, rows: [...form.rows, blankRow()] })}>
                {t('addLine')}
              </Button>
              <Button onClick={save}>{t('save')}</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
};

export default StatementsPage;
