'use client';

import { ActionIcon, Button, Card, Checkbox, Group, Modal, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { sumAmounts } from '@erp/shared';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CostCenterSelect, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCostCenters, useTemplates } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Form = { id?: string; code: string; name_ar: string; name_en: string; is_active: boolean; lines: { cost_center_id: string | null; percent: string }[] };

const safeSum = (values: string[]) => {
  try {
    return sumAmounts(values.map((v) => v || '0')).toString();
  } catch {
    return '—';
  }
};

const TemplatesPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const { data = [] } = useTemplates();
  const { data: costCenters = [] } = useCostCenters();
  const [form, setForm] = useState<Form | null>(null);
  const ccName = (id: string) => {
    const cc = costCenters.find((c) => c.id === id);
    return cc ? `${cc.code} — ${name(cc)}` : id;
  };

  const save = async () => {
    if (!form) return;
    try {
      const { id, ...body } = form;
      await api(id ? `/gl/distribution-templates/${id}` : '/gl/distribution-templates', { method: id ? 'PUT' : 'POST', body });
      notifySuccess(t('saved'));
      setForm(null);
      await queryClient.invalidateQueries({ queryKey: [company?.id, 'templates'] });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const total = form ? safeSum(form.lines.map((l) => l.percent)) : '0';

  return (
    <>
      <PageHeader
        title={t('navTemplates')}
        actions={
          can('gl.master.manage') && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setForm({ code: '', name_ar: '', name_en: '', is_active: true, lines: [{ cost_center_id: null, percent: '100' }] })}>
              {t('add')}
            </Button>
          )
        }
      />
      {data.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {data.map((tpl) => (
          <Card key={tpl.id} withBorder>
            <Group justify="space-between" mb="xs">
              <Text fw={700}>
                <span className="ltr">{tpl.code}</span> — {name(tpl)}
              </Text>
              {can('gl.master.manage') && (
                <ActionIcon variant="subtle" aria-label={t('edit')} onClick={() => setForm({ ...tpl })}>
                  <IconPencil size={16} />
                </ActionIcon>
              )}
            </Group>
            <Table>
              <Table.Tbody>
                {tpl.lines.map((l) => (
                  <Table.Tr key={l.cost_center_id}>
                    <Table.Td>{ccName(l.cost_center_id)}</Table.Td>
                    <Table.Td className="num amount-cell">{Number(l.percent)}%</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        ))}
      </SimpleGrid>
      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? t('edit') : t('add')} size="lg">
        {form && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('code')} required value={form.code} onChange={(e) => setForm({ ...form, code: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
              <TextInput label={t('nameAr')} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.currentTarget.value })} dir="rtl" />
              <TextInput label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.currentTarget.value })} dir="ltr" />
            </SimpleGrid>
            <Text fw={600} size="sm">
              {t('templateLines')}
            </Text>
            {form.lines.map((line, index) => (
              <Group key={index} wrap="nowrap" align="flex-end">
                <CostCenterSelect
                  style={{ flex: 1 }}
                  value={line.cost_center_id}
                  onChange={(v) => setForm({ ...form, lines: form.lines.map((l, i) => (i === index ? { ...l, cost_center_id: v } : l)) })}
                />
                <TextInput
                  w={110}
                  rightSection="%"
                  value={line.percent}
                  classNames={{ input: 'ltr' }}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setForm({ ...form, lines: form.lines.map((l, i) => (i === index ? { ...l, percent: value } : l)) });
                  }}
                />
                <ActionIcon color="red" variant="subtle" aria-label={t('removeLine')} onClick={() => setForm({ ...form, lines: form.lines.filter((_, i) => i !== index) })}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            <Group justify="space-between">
              <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setForm({ ...form, lines: [...form.lines, { cost_center_id: null, percent: '' }] })}>
                {t('addLine')}
              </Button>
              <Text size="sm" c={total === '100' ? 'teal' : 'red'}>
                {t('percentTotal')}: <span className="num">{total}%</span>
              </Text>
            </Group>
            <Checkbox label={t('active')} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })} />
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

export default TemplatesPage;
