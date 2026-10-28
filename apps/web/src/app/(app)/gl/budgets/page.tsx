'use client';

import { ActionIcon, Button, Group, Modal, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { notifyError } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCompanyQuery, useFiscalYears } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Budget = { id: string; code: string; name_ar: string; name_en: string; fiscal_year_code: string; status: 'DRAFT' | 'APPROVED'; line_count: number };

const BudgetsPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data = [] } = useCompanyQuery<Budget[]>(['budgets'], '/gl/budgets');
  const { data: years = [] } = useFiscalYears();
  const [form, setForm] = useState<{ code: string; name_ar: string; name_en: string; fiscal_year_id: string | null } | null>(null);
  const canManage = can('gl.budget.manage');

  const create = async () => {
    if (!form) return;
    try {
      const created = await api<{ id: string }>('/gl/budgets', { method: 'POST', body: form });
      await queryClient.invalidateQueries({ queryKey: [company?.id, 'budgets'] });
      router.push(`/gl/budgets/${created.id}`);
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const remove = async (b: Budget) => {
    if (!window.confirm(`${t('confirmDelete')}\n${b.code}`)) return;
    try {
      await api(`/gl/budgets/${b.id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: [company?.id, 'budgets'] });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title={t('navBudgets')}
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setForm({ code: '', name_ar: '', name_en: '', fiscal_year_id: years[0]?.id ?? null })}>
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
              <Table.Th>{t('fiscalYear')}</Table.Th>
              <Table.Th>{t('lines')}</Table.Th>
              <Table.Th>{t('status')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.map((b) => (
              <Table.Tr key={b.id} className="clickable" onClick={() => router.push(`/gl/budgets/${b.id}`)}>
                <Table.Td className="ltr">{b.code}</Table.Td>
                <Table.Td>{name(b)}</Table.Td>
                <Table.Td>{b.fiscal_year_code}</Table.Td>
                <Table.Td className="num">{b.line_count}</Table.Td>
                <Table.Td>{b.status === 'APPROVED' ? t('statusAPPROVED') : t('statusDRAFT')}</Table.Td>
                <Table.Td onClick={(e) => e.stopPropagation()}>
                  {canManage && b.status === 'DRAFT' && (
                    <ActionIcon variant="subtle" color="red" onClick={() => remove(b)} aria-label={t('delete')}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {data.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
      </Paper>
      <Modal opened={!!form} onClose={() => setForm(null)} title={t('add')}>
        {form && (
          <Stack>
            <SimpleGrid cols={2}>
              <TextInput label={t('code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
              <Select label={t('fiscalYear')} data={years.map((y) => ({ value: y.id, label: y.code }))} value={form.fiscal_year_id} onChange={(v) => setForm({ ...form, fiscal_year_id: v })} allowDeselect={false} />
              <TextInput label={t('nameAr')} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.currentTarget.value })} dir="rtl" />
              <TextInput label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.currentTarget.value })} dir="ltr" />
            </SimpleGrid>
            <Group justify="flex-end">
              <Button onClick={create}>{t('save')}</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
};

export default BudgetsPage;
