'use client';

import { Accordion, Button, Checkbox, Group, Modal, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { MODULES, type ModuleCode, PERIOD_STATUSES, type PeriodStatus, translateError } from '@erp/shared';
import { IconPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useFiscalYears, usePeriods } from '@/lib/queries';
import { useSession } from '@/lib/session';

const COLORS: Record<PeriodStatus, string> = { OPEN: 'teal', CLOSED: 'orange', LOCKED: 'red' };

const PeriodsPage = () => {
  const { t, name, errorText, locale } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const { data: years = [] } = useFiscalYears();
  const { data: periods = [] } = usePeriods();
  const [creating, setCreating] = useState<{ code: string; start_date: string; with_adjustment_period: boolean } | null>(null);
  const canManage = can('gl.period.manage');

  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === company?.id && ['periods', 'fiscal-years'].includes(String(q.queryKey[1])) });

  const setStatus = async (periodId: string, module: ModuleCode, status: PeriodStatus) => {
    try {
      const result = await api<{ warnings: { code: 'PERIOD_HAS_UNPOSTED'; params: Record<string, string | number> }[] }>(`/gl/periods/${periodId}/status`, {
        method: 'PATCH',
        body: { module, status },
      });
      notifySuccess(t('saved'));
      for (const w of result.warnings) notifyError(translateError(w.code, locale, w.params));
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const createYear = async () => {
    if (!creating) return;
    try {
      await api('/gl/fiscal-years', { method: 'POST', body: creating });
      notifySuccess(t('saved'));
      setCreating(null);
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const nextStart = () => {
    const latest = years[0];
    if (!latest) return `${new Date().getFullYear()}-01-01`;
    const d = new Date(`${latest.end_date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  return (
    <>
      <PageHeader
        title={t('navPeriods')}
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => {
              const start = nextStart();
              setCreating({ code: start.slice(5) === '01-01' ? start.slice(0, 4) : `${start.slice(0, 4)}/${Number(start.slice(0, 4)) + 1}`, start_date: start, with_adjustment_period: true });
            }}>
              {t('newFiscalYear')}
            </Button>
          )
        }
      />
      <Accordion variant="separated" defaultValue={years[0]?.id}>
        {years.map((y) => (
          <Accordion.Item key={y.id} value={y.id}>
            <Accordion.Control>
              <Group gap="sm">
                <Text fw={700}>{y.code}</Text>
                <Text size="sm" c="dimmed" className="num">
                  {y.start_date} → {y.end_date}
                </Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Paper>
                <Table.ScrollContainer minWidth={760}>
                  <Table striped>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t('period')}</Table.Th>
                        <Table.Th>{t('from')}</Table.Th>
                        <Table.Th>{t('to')}</Table.Th>
                        {MODULES.map((m) => (
                          <Table.Th key={m}>{m}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {periods
                        .filter((p) => p.fiscal_year_id === y.id)
                        .map((p) => (
                          <Table.Tr key={p.id}>
                            <Table.Td fw={p.is_adjustment ? 700 : undefined}>{name(p)}</Table.Td>
                            <Table.Td className="num">{p.start_date}</Table.Td>
                            <Table.Td className="num">{p.end_date}</Table.Td>
                            {MODULES.map((m) => {
                              const status = p.statuses[m] ?? 'OPEN';
                              return (
                                <Table.Td key={m}>
                                  <Select
                                    size="xs"
                                    w={locale === 'ar' ? 130 : 110}
                                    disabled={!canManage}
                                    data={PERIOD_STATUSES.map((s) => ({ value: s, label: t(`status${s}`) }))}
                                    value={status}
                                    allowDeselect={false}
                                    styles={{ input: { color: `var(--mantine-color-${COLORS[status]}-7)`, fontWeight: 600 } }}
                                    onChange={(v) => v && v !== status && setStatus(p.id, m, v as PeriodStatus)}
                                  />
                                </Table.Td>
                              );
                            })}
                          </Table.Tr>
                        ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Paper>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      <Modal opened={!!creating} onClose={() => setCreating(null)} title={t('newFiscalYear')}>
        {creating && (
          <Stack>
            <TextInput label={t('code')} value={creating.code} onChange={(e) => setCreating({ ...creating, code: e.currentTarget.value })} />
            <TextInput type="date" label={t('startDate')} value={creating.start_date} onChange={(e) => setCreating({ ...creating, start_date: e.currentTarget.value })} />
            <Checkbox label={t('withAdjustment')} checked={creating.with_adjustment_period} onChange={(e) => setCreating({ ...creating, with_adjustment_period: e.currentTarget.checked })} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setCreating(null)}>
                {t('cancel')}
              </Button>
              <Button onClick={createYear}>{t('save')}</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
};

export default PeriodsPage;
