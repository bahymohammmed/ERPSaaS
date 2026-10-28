'use client';

import { ActionIcon, Badge, Button, Checkbox, Group, Modal, MultiSelect, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { AccountSelect, Amount, CostCenterSelect, PageHeader, StatusBadge } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useAccounts, useCompanyQuery, useCostCenters, usePeriods } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toTreeRows } from '@/lib/tree';

type Driver = { id: string; code: string; name_ar: string; name_en: string; unit: string; is_active: boolean };
type Rule = {
  id?: string;
  code: string;
  name_ar: string;
  name_en: string;
  step_no: number;
  method: 'FIXED' | 'DRIVER';
  driver_id: string | null;
  source_account_ids: string[];
  source_cost_center_ids: string[];
  target_account_id: string | null;
  is_active: boolean;
  targets: { cost_center_id: string | null; percent: string | null }[];
};
type Run = { id: string; period_code: string; status: 'POSTED' | 'REVERSED'; created_at: string; created_by_name: string; entries: number; total: string };
type RunResult = { run_id: string; rules: { code: string; name_ar: string; name_en: string; step_no: number; allocated: string; lines: { account_code: string; cost_center_code: string; debit: string; credit: string }[] }[] };

const AllocationPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const minor = company?.base_minor_units ?? 3;
  const { data: accounts = [] } = useAccounts();
  const { data: costCenters = [] } = useCostCenters();
  const { data: periods = [] } = usePeriods();
  const { data: drivers = [] } = useCompanyQuery<Driver[]>(['drivers'], '/gl/allocation/drivers');
  const { data: rules = [] } = useCompanyQuery<Rule[]>(['allocation-rules'], '/gl/allocation/rules');
  const { data: runs = [] } = useCompanyQuery<Run[]>(['allocation-runs'], '/gl/allocation/runs');
  const [rule, setRule] = useState<Rule | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [valuesFor, setValuesFor] = useState<{ driverId: string | null; periodId: string | null }>({ driverId: null, periodId: null });
  const [values, setValues] = useState<Record<string, string>>({});
  const [runPeriod, setRunPeriod] = useState<string | null>(null);
  const [preview, setPreview] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can('gl.master.manage');
  const canRun = can('gl.close.manage');

  const invalidate = (key: string) => queryClient.invalidateQueries({ queryKey: [company?.id, key] });
  const accountOptions = useMemo(() => toTreeRows(accounts).map((a) => ({ value: a.id, label: `${a.code} — ${name(a)}` })), [accounts, name]);
  const ccOptions = useMemo(() => toTreeRows(costCenters).map((c) => ({ value: c.id, label: `${c.code} — ${name(c)}` })), [costCenters, name]);
  const postingCcs = useMemo(() => toTreeRows(costCenters).filter((c) => c.is_posting && c.is_active), [costCenters]);
  const periodOptions = periods.map((p) => ({ value: p.id, label: `${p.code} — ${name(p)}` }));

  useEffect(() => {
    if (!valuesFor.driverId || !valuesFor.periodId) return;
    api<{ cost_center_id: string; value: string }[]>(`/gl/allocation/drivers/${valuesFor.driverId}/values`, { query: { period_id: valuesFor.periodId } })
      .then((rows) => setValues(Object.fromEntries(rows.map((r) => [r.cost_center_id, String(Number(r.value))]))))
      .catch((e: unknown) => notifyError(errorText(e)));
  }, [valuesFor, errorText]);

  const call = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const saveRule = () =>
    call(async () => {
      if (!rule) return;
      const { id, ...body } = rule;
      await api(id ? `/gl/allocation/rules/${id}` : '/gl/allocation/rules', {
        method: id ? 'PUT' : 'POST',
        body: { ...body, targets: body.targets.filter((x) => x.cost_center_id).map((x) => ({ cost_center_id: x.cost_center_id, percent: body.method === 'FIXED' ? x.percent : null })) },
      });
      notifySuccess(t('saved'));
      setRule(null);
      await invalidate('allocation-rules');
    });

  const deleteRule = (r: Rule) =>
    call(async () => {
      if (!window.confirm(`${t('confirmDelete')}\n${r.code}`)) return;
      await api(`/gl/allocation/rules/${r.id}`, { method: 'DELETE' });
      await invalidate('allocation-rules');
    });

  const saveDriver = () =>
    call(async () => {
      if (!driver) return;
      const { id, ...body } = driver;
      await api(id ? `/gl/allocation/drivers/${id}` : '/gl/allocation/drivers', { method: id ? 'PUT' : 'POST', body });
      notifySuccess(t('saved'));
      setDriver(null);
      await invalidate('drivers');
    });

  const saveValues = () =>
    call(async () => {
      await api(`/gl/allocation/drivers/${valuesFor.driverId}/values`, {
        method: 'PUT',
        body: { period_id: valuesFor.periodId, values: Object.entries(values).filter(([, v]) => v !== '').map(([cost_center_id, value]) => ({ cost_center_id, value })) },
      });
      notifySuccess(t('saved'));
    });

  const doPreview = () => call(async () => setPreview(await api<RunResult>('/gl/allocation/preview', { method: 'POST', body: { period_id: runPeriod } })));
  const doRun = () =>
    call(async () => {
      await api('/gl/allocation/runs', { method: 'POST', body: { period_id: runPeriod } });
      notifySuccess(t('saved'));
      setPreview(null);
      await invalidate('allocation-runs');
    });
  const reverseRun = (run: Run) =>
    call(async () => {
      if (!window.confirm(t('reverseRun'))) return;
      await api(`/gl/allocation/runs/${run.id}/reverse`, { method: 'POST' });
      await invalidate('allocation-runs');
    });

  return (
    <Stack>
      <PageHeader title={t('navAllocation')} />
      <Tabs defaultValue="rules" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="rules">{t('rules')}</Tabs.Tab>
          <Tabs.Tab value="drivers">{t('drivers')}</Tabs.Tab>
          <Tabs.Tab value="runs">{t('runs')}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="rules" pt="md">
          <Paper withBorder p="sm">
            {canManage && (
              <Button
                mb="sm"
                leftSection={<IconPlus size={16} />}
                onClick={() =>
                  setRule({ code: '', name_ar: '', name_en: '', step_no: rules.length + 1, method: 'FIXED', driver_id: null, source_account_ids: [], source_cost_center_ids: [], target_account_id: null, is_active: true, targets: [{ cost_center_id: null, percent: '100' }] })
                }
              >
                {t('add')}
              </Button>
            )}
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('stepNo')}</Table.Th>
                  <Table.Th>{t('code')}</Table.Th>
                  <Table.Th>{t('name')}</Table.Th>
                  <Table.Th>{t('method')}</Table.Th>
                  <Table.Th>{t('sourceCostCenters')}</Table.Th>
                  <Table.Th>{t('targets')}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rules.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td className="num">{r.step_no}</Table.Td>
                    <Table.Td className="ltr">{r.code}</Table.Td>
                    <Table.Td>
                      {name(r)} {!r.is_active && <Badge size="xs" color="gray">{t('inactive')}</Badge>}
                    </Table.Td>
                    <Table.Td>{t(`method${r.method}`)}</Table.Td>
                    <Table.Td className="ltr">{r.source_cost_center_ids.map((id) => costCenters.find((c) => c.id === id)?.code).join(', ')}</Table.Td>
                    <Table.Td className="ltr">
                      {r.targets.map((x) => `${costCenters.find((c) => c.id === x.cost_center_id)?.code ?? ''}${x.percent ? ` ${Number(x.percent)}%` : ''}`).join(', ')}
                    </Table.Td>
                    <Table.Td>
                      {canManage && (
                        <Group gap={4} wrap="nowrap">
                          <ActionIcon variant="subtle" onClick={() => setRule({ ...r, targets: r.targets.map((x) => ({ ...x, percent: x.percent === null ? null : String(Number(x.percent)) })) })} aria-label={t('edit')}>
                            <IconPencil size={16} />
                          </ActionIcon>
                          <ActionIcon variant="subtle" color="red" onClick={() => deleteRule(r)} aria-label={t('delete')}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {rules.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="drivers" pt="md">
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Paper withBorder p="sm">
              {canManage && (
                <Button mb="sm" leftSection={<IconPlus size={16} />} onClick={() => setDriver({ id: '', code: '', name_ar: '', name_en: '', unit: '', is_active: true })}>
                  {t('add')}
                </Button>
              )}
              <Table striped>
                <Table.Tbody>
                  {drivers.map((d) => (
                    <Table.Tr key={d.id}>
                      <Table.Td className="ltr">{d.code}</Table.Td>
                      <Table.Td>{name(d)}</Table.Td>
                      <Table.Td>{d.unit}</Table.Td>
                      <Table.Td>
                        {canManage && (
                          <ActionIcon variant="subtle" onClick={() => setDriver({ ...d })} aria-label={t('edit')}>
                            <IconPencil size={16} />
                          </ActionIcon>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
            <Paper withBorder p="sm">
              <Title order={5} mb="sm">
                {t('driverValues')}
              </Title>
              <Group grow mb="sm">
                <Select placeholder={t('driver')} data={drivers.map((d) => ({ value: d.id, label: `${d.code} — ${name(d)}` }))} value={valuesFor.driverId} onChange={(v) => setValuesFor({ ...valuesFor, driverId: v })} />
                <Select placeholder={t('period')} searchable data={periodOptions} value={valuesFor.periodId} onChange={(v) => setValuesFor({ ...valuesFor, periodId: v })} />
              </Group>
              {valuesFor.driverId && valuesFor.periodId && (
                <>
                  <Table>
                    <Table.Tbody>
                      {postingCcs.map((c) => (
                        <Table.Tr key={c.id}>
                          <Table.Td>
                            <span className="ltr">{c.code}</span> — {name(c)}
                          </Table.Td>
                          <Table.Td w={140}>
                            <TextInput size="xs" classNames={{ input: 'ltr' }} value={values[c.id] ?? ''} onChange={(e) => setValues({ ...values, [c.id]: e.currentTarget.value })} disabled={!canManage} />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  {canManage && (
                    <Button mt="sm" onClick={saveValues} loading={busy}>
                      {t('save')}
                    </Button>
                  )}
                </>
              )}
            </Paper>
          </SimpleGrid>
        </Tabs.Panel>

        <Tabs.Panel value="runs" pt="md">
          <Stack>
            {canRun && (
              <Paper withBorder p="sm">
                <Group align="flex-end">
                  <Select label={t('period')} searchable data={periodOptions} value={runPeriod} onChange={(v) => { setRunPeriod(v); setPreview(null); }} w={280} />
                  <Button variant="light" onClick={doPreview} disabled={!runPeriod} loading={busy}>
                    {t('preview')}
                  </Button>
                  <Button onClick={doRun} disabled={!preview} loading={busy}>
                    {t('runAllocation')}
                  </Button>
                </Group>
                {preview &&
                  preview.rules.map((r) => (
                    <Stack key={r.code} gap={4} mt="md">
                      <Text fw={600}>
                        {r.step_no}. {name(r)} — {t('allocated')}: <Amount value={r.allocated} minor={minor} />
                      </Text>
                      {r.lines.length > 0 && (
                        <Table>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>{t('account')}</Table.Th>
                              <Table.Th>{t('costCenter')}</Table.Th>
                              <Table.Th className="amount-cell">{t('debit')}</Table.Th>
                              <Table.Th className="amount-cell">{t('credit')}</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {r.lines.map((l, i) => (
                              <Table.Tr key={i}>
                                <Table.Td className="ltr">{l.account_code}</Table.Td>
                                <Table.Td className="ltr">{l.cost_center_code}</Table.Td>
                                <Table.Td className="amount-cell"><Amount value={l.debit} minor={minor} /></Table.Td>
                                <Table.Td className="amount-cell"><Amount value={l.credit} minor={minor} /></Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      )}
                    </Stack>
                  ))}
              </Paper>
            )}
            <Paper withBorder p="sm">
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('period')}</Table.Th>
                    <Table.Th>{t('status')}</Table.Th>
                    <Table.Th>{t('entries')}</Table.Th>
                    <Table.Th className="amount-cell">{t('allocated')}</Table.Th>
                    <Table.Th>{t('createdBy')}</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {runs.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td className="ltr">{r.period_code}</Table.Td>
                      <Table.Td><StatusBadge status={r.status} /></Table.Td>
                      <Table.Td className="num">{r.entries}</Table.Td>
                      <Table.Td className="amount-cell"><Amount value={r.total} minor={minor} /></Table.Td>
                      <Table.Td>{r.created_by_name}</Table.Td>
                      <Table.Td>
                        {canRun && r.status === 'POSTED' && (
                          <Button size="xs" color="red" variant="light" onClick={() => reverseRun(r)}>
                            {t('reverseRun')}
                          </Button>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {runs.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
            </Paper>
          </Stack>
        </Tabs.Panel>
      </Tabs>

      <Modal opened={!!rule} onClose={() => setRule(null)} title={rule?.id ? t('edit') : t('add')} size="xl">
        {rule && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 4 }}>
              <TextInput label={t('code')} value={rule.code} onChange={(e) => setRule({ ...rule, code: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
              <TextInput label={t('nameAr')} value={rule.name_ar} onChange={(e) => setRule({ ...rule, name_ar: e.currentTarget.value })} dir="rtl" />
              <TextInput label={t('nameEn')} value={rule.name_en} onChange={(e) => setRule({ ...rule, name_en: e.currentTarget.value })} dir="ltr" />
              <NumberInput label={t('stepNo')} min={1} max={99} value={rule.step_no} onChange={(v) => setRule({ ...rule, step_no: Number(v) || 1 })} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select
                label={t('method')}
                data={(['FIXED', 'DRIVER'] as const).map((m) => ({ value: m, label: t(`method${m}`) }))}
                value={rule.method}
                onChange={(v) => setRule({ ...rule, method: v === 'DRIVER' ? 'DRIVER' : 'FIXED' })}
                allowDeselect={false}
              />
              {rule.method === 'DRIVER' && (
                <Select label={t('driver')} data={drivers.map((d) => ({ value: d.id, label: `${d.code} — ${name(d)}` }))} value={rule.driver_id} onChange={(v) => setRule({ ...rule, driver_id: v })} />
              )}
            </SimpleGrid>
            <MultiSelect label={t('sourceAccounts')} searchable data={accountOptions} value={rule.source_account_ids} onChange={(v) => setRule({ ...rule, source_account_ids: v })} />
            <MultiSelect label={t('sourceCostCenters')} searchable data={ccOptions} value={rule.source_cost_center_ids} onChange={(v) => setRule({ ...rule, source_cost_center_ids: v })} />
            <AccountSelect label={t('targetAccount')} value={rule.target_account_id} onChange={(v) => setRule({ ...rule, target_account_id: v })} />
            <Text fw={600} size="sm">
              {t('targets')}
            </Text>
            {rule.targets.map((target, i) => (
              <Group key={i} wrap="nowrap">
                <CostCenterSelect style={{ flex: 1 }} value={target.cost_center_id} onChange={(v) => setRule({ ...rule, targets: rule.targets.map((x, j) => (j === i ? { ...x, cost_center_id: v } : x)) })} />
                {rule.method === 'FIXED' && (
                  <TextInput
                    w={110}
                    rightSection="%"
                    classNames={{ input: 'ltr' }}
                    value={target.percent ?? ''}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      setRule({ ...rule, targets: rule.targets.map((x, j) => (j === i ? { ...x, percent: value } : x)) });
                    }}
                  />
                )}
                <ActionIcon color="red" variant="subtle" onClick={() => setRule({ ...rule, targets: rule.targets.filter((_, j) => j !== i) })} aria-label={t('removeLine')}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            <Group justify="space-between">
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setRule({ ...rule, targets: [...rule.targets, { cost_center_id: null, percent: '' }] })}>
                {t('addLine')}
              </Button>
              <Checkbox label={t('active')} checked={rule.is_active} onChange={(e) => setRule({ ...rule, is_active: e.currentTarget.checked })} />
            </Group>
            <Group justify="flex-end">
              <Button onClick={saveRule} loading={busy}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!driver} onClose={() => setDriver(null)} title={driver?.id ? t('edit') : t('add')}>
        {driver && (
          <Stack>
            <SimpleGrid cols={2}>
              <TextInput label={t('code')} value={driver.code} onChange={(e) => setDriver({ ...driver, code: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
              <TextInput label={t('unit')} value={driver.unit} onChange={(e) => setDriver({ ...driver, unit: e.currentTarget.value })} />
              <TextInput label={t('nameAr')} value={driver.name_ar} onChange={(e) => setDriver({ ...driver, name_ar: e.currentTarget.value })} dir="rtl" />
              <TextInput label={t('nameEn')} value={driver.name_en} onChange={(e) => setDriver({ ...driver, name_en: e.currentTarget.value })} dir="ltr" />
            </SimpleGrid>
            <Group justify="flex-end">
              <Button onClick={saveDriver} loading={busy}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};

export default AllocationPage;
