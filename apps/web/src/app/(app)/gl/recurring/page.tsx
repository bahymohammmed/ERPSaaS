'use client';

import { ActionIcon, Anchor, Badge, Button, Checkbox, Group, Modal, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { RECURRENCE_FREQUENCIES, type RecurrenceFrequency } from '@erp/shared';
import { IconPencil, IconPlayerPlay, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCompanyQuery } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Recurring = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  journal_type_code: string;
  frequency: RecurrenceFrequency;
  day_of_month: number;
  start_date: string;
  end_date: string | null;
  next_run_date: string;
  last_run_date: string | null;
  last_entry_id: string | null;
  last_entry_no: string | null;
  last_error: string | null;
  auto_post: boolean;
  is_active: boolean;
};

const RecurringPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const { data = [] } = useCompanyQuery<Recurring[]>(['recurring'], '/gl/recurring');
  const [form, setForm] = useState<Recurring | null>(null);
  const canEdit = can('gl.journal.create');
  const refresh = () => queryClient.invalidateQueries({ queryKey: [company?.id, 'recurring'] });

  const save = async () => {
    if (!form) return;
    try {
      await api(`/gl/recurring/${form.id}`, {
        method: 'PUT',
        body: {
          code: form.code,
          name_ar: form.name_ar,
          name_en: form.name_en,
          frequency: form.frequency,
          day_of_month: form.day_of_month,
          start_date: form.start_date,
          end_date: form.end_date || null,
          auto_post: form.auto_post,
          is_active: form.is_active,
        },
      });
      notifySuccess(t('saved'));
      setForm(null);
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const runNow = async (r: Recurring) => {
    try {
      const result = await api<{ generated: unknown[] }>(`/gl/recurring/${r.id}/run`, { method: 'POST' });
      notifySuccess(`${t('generated')}: ${result.generated.length}`);
    } catch (error) {
      notifyError(errorText(error));
    }
    await refresh();
  };

  const remove = async (r: Recurring) => {
    if (!window.confirm(`${t('confirmDelete')}\n${r.code}`)) return;
    try {
      await api(`/gl/recurring/${r.id}`, { method: 'DELETE' });
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  return (
    <>
      <PageHeader title={t('navRecurring')} />
      <Paper withBorder p="sm">
        <Table.ScrollContainer minWidth={900}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('code')}</Table.Th>
                <Table.Th>{t('name')}</Table.Th>
                <Table.Th>{t('frequency')}</Table.Th>
                <Table.Th>{t('nextRun')}</Table.Th>
                <Table.Th>{t('lastRun')}</Table.Th>
                <Table.Th>{t('autoPost')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td className="ltr">{r.code}</Table.Td>
                  <Table.Td>{name(r)}</Table.Td>
                  <Table.Td>
                    {t(`freq${r.frequency}`)} · {r.day_of_month}
                  </Table.Td>
                  <Table.Td className="num">{r.next_run_date}</Table.Td>
                  <Table.Td>
                    {r.last_entry_id ? (
                      <Anchor component={Link} href={`/gl/journals/${r.last_entry_id}`} className="ltr">
                        {r.last_entry_no ?? r.last_run_date}
                      </Anchor>
                    ) : (
                      '—'
                    )}
                    {r.last_error && (
                      <Tooltip label={r.last_error} multiline w={320}>
                        <Badge color="red" variant="light" ms={6}>
                          {t('lastError')}
                        </Badge>
                      </Tooltip>
                    )}
                  </Table.Td>
                  <Table.Td>{r.auto_post ? t('yes') : t('no')}</Table.Td>
                  <Table.Td>{r.is_active ? t('active') : t('inactive')}</Table.Td>
                  <Table.Td>
                    {canEdit && (
                      <Group gap={4} wrap="nowrap">
                        <Tooltip label={t('runNow')}>
                          <ActionIcon variant="subtle" color="teal" onClick={() => runNow(r)} aria-label={t('runNow')}>
                            <IconPlayerPlay size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <ActionIcon variant="subtle" onClick={() => setForm({ ...r })} aria-label={t('edit')}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="red" onClick={() => remove(r)} aria-label={t('delete')}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {data.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
      </Paper>
      <Modal opened={!!form} onClose={() => setForm(null)} title={t('edit')}>
        {form && (
          <Stack>
            <SimpleGrid cols={2}>
              <TextInput label={t('code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
              <Select
                label={t('frequency')}
                data={RECURRENCE_FREQUENCIES.map((f) => ({ value: f, label: t(`freq${f}`) }))}
                value={form.frequency}
                onChange={(v) => setForm({ ...form, frequency: (v ?? 'MONTHLY') as RecurrenceFrequency })}
                allowDeselect={false}
              />
              <TextInput label={t('nameAr')} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.currentTarget.value })} dir="rtl" />
              <TextInput label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.currentTarget.value })} dir="ltr" />
              <TextInput type="number" min={1} max={31} label={t('dayOfMonth')} value={form.day_of_month} onChange={(e) => setForm({ ...form, day_of_month: Number(e.currentTarget.value) })} />
              <TextInput type="date" label={t('startDate')} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.currentTarget.value })} />
              <TextInput type="date" label={t('endDate')} value={form.end_date ?? ''} onChange={(e) => setForm({ ...form, end_date: e.currentTarget.value || null })} />
            </SimpleGrid>
            <Group>
              <Checkbox label={t('autoPost')} checked={form.auto_post} onChange={(e) => setForm({ ...form, auto_post: e.currentTarget.checked })} />
              <Checkbox label={t('active')} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })} />
            </Group>
            <Group justify="flex-end">
              <Button onClick={save}>{t('save')}</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
};

export default RecurringPage;
