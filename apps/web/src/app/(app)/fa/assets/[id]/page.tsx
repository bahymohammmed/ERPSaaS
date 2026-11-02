'use client';

import {
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import type { DepreciationMethod } from '@erp/shared';
import { IconArrowsExchange, IconCircleCheck, IconTrash, IconTruckReturn, IconX } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { AccountSelect, Amount, CostCenterSelect, PageHeader } from '@/components/common';
import { AssetStatusBadge, useFaCategories, useMethodOptions } from '@/components/fixed-assets';
import { notifyError, notifySuccess } from '@/components/notify';
import { EmptyState } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { FaAssetDetail } from '@/lib/types';

type Form = {
  code: string;
  name_ar: string;
  name_en: string;
  category_id: string | null;
  cost_center_id: string | null;
  location: string;
  custodian: string;
  serial_no: string;
  acquisition_date: string;
  in_service_date: string;
  cost: string;
  residual_value: string;
  method: DepreciationMethod | null;
  useful_life_months: number | '';
  declining_rate: string;
  notes: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const blank = (): Form => ({
  code: '',
  name_ar: '',
  name_en: '',
  category_id: null,
  cost_center_id: null,
  location: '',
  custodian: '',
  serial_no: '',
  acquisition_date: today(),
  in_service_date: '',
  cost: '',
  residual_value: '',
  method: null,
  useful_life_months: '',
  declining_rate: '',
  notes: '',
});

const fromAsset = (a: FaAssetDetail, minor: number): Form => ({
  code: a.code,
  name_ar: a.name_ar,
  name_en: a.name_en,
  category_id: a.category_id,
  cost_center_id: a.cost_center_id,
  location: a.location ?? '',
  custodian: a.custodian ?? '',
  serial_no: a.serial_no ?? '',
  acquisition_date: a.acquisition_date,
  in_service_date: a.in_service_date,
  cost: Number(a.cost).toFixed(minor),
  residual_value: Number(a.residual_value).toFixed(minor),
  method: a.method,
  useful_life_months: a.useful_life_months ?? '',
  declining_rate: a.declining_rate ?? '',
  notes: a.notes ?? '',
});

type Activate = { mode: 'POST' | 'EXISTING'; offset_account_id: string | null; description: string; opening_accum_dep: string; opening_dep_date: string };
type Dispose = { disposal_date: string; proceeds: string; proceeds_account_id: string | null; description: string };

const Stat = ({ label, children }: { label: string; children: ReactNode }) => (
  <Card padding="md">
    <Text size="sm" c="dimmed">
      {label}
    </Text>
    <Text fz={20} fw={700} className="num">
      {children}
    </Text>
  </Card>
);

const AssetPage = () => {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const minor = company?.base_minor_units ?? 3;
  const canManage = can('fa.manage');
  const { data: categories = [] } = useFaCategories();
  const methodOptions = useMethodOptions();
  const detail = useQuery({
    queryKey: [company?.id, 'fa-asset', id],
    queryFn: () => api<FaAssetDetail>(`/fa/assets/${id}`),
    enabled: !!company && !isNew,
  });
  const asset = detail.data;
  const [form, setForm] = useState<Form>(blank);
  const [busy, setBusy] = useState(false);
  const [activate, setActivate] = useState<Activate | null>(null);
  const [transfer, setTransfer] = useState<{ cost_center_id: string | null; transfer_date: string; notes: string } | null>(null);
  const [dispose, setDispose] = useState<Dispose | null>(null);

  useEffect(() => {
    if (asset) setForm(fromAsset(asset, minor));
  }, [asset, minor]);

  const draft = isNew || asset?.status === 'DRAFT';
  const category = categories.find((c) => c.id === form.category_id);
  const method = form.method ?? category?.method ?? null;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const refresh = async () => {
    await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === company?.id && String(q.queryKey[1]).startsWith('fa-') });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const body = {
        ...form,
        in_service_date: form.in_service_date || null,
        residual_value: form.residual_value || null,
        useful_life_months: form.useful_life_months === '' ? null : form.useful_life_months,
        declining_rate: form.declining_rate || null,
        method: form.method,
        location: form.location || null,
        custodian: form.custodian || null,
        serial_no: form.serial_no || null,
        notes: form.notes || null,
      };
      if (isNew) {
        const created = await api<{ id: string }>('/fa/assets', { method: 'POST', body });
        notifySuccess(t('saved'));
        await refresh();
        router.replace(`/fa/assets/${created.id}`);
      } else {
        await api(`/fa/assets/${id}`, { method: 'PUT', body });
        notifySuccess(t('saved'));
        await refresh();
      }
    });

  const remove = () =>
    run(async () => {
      if (!window.confirm(`${t('confirmDelete')}\n${form.code}`)) return;
      await api(`/fa/assets/${id}`, { method: 'DELETE' });
      await refresh();
      router.replace('/fa/assets');
    });

  const submitActivate = () =>
    run(async () => {
      if (!activate) return;
      const body =
        activate.mode === 'POST'
          ? { mode: 'POST', offset_account_id: activate.offset_account_id, description: activate.description || null }
          : { mode: 'EXISTING', opening_accum_dep: activate.opening_accum_dep || '0', opening_dep_date: activate.opening_dep_date || null };
      await api(`/fa/assets/${id}/activate`, { method: 'POST', body });
      notifySuccess(t('saved'));
      setActivate(null);
      await refresh();
    });

  const submitTransfer = () =>
    run(async () => {
      if (!transfer) return;
      await api(`/fa/assets/${id}/transfer`, { method: 'POST', body: { ...transfer, notes: transfer.notes || null } });
      notifySuccess(t('saved'));
      setTransfer(null);
      await refresh();
    });

  const submitDispose = () =>
    run(async () => {
      if (!dispose || !window.confirm(t('confirmDispose'))) return;
      await api(`/fa/assets/${id}/dispose`, { method: 'POST', body: { ...dispose, proceeds: dispose.proceeds || '0', description: dispose.description || null } });
      notifySuccess(t('saved'));
      setDispose(null);
      await refresh();
    });

  const reverseDisposal = () =>
    run(async () => {
      if (!window.confirm(t('confirmReverseDisposal'))) return;
      await api(`/fa/assets/${id}/reverse-disposal`, { method: 'POST' });
      notifySuccess(t('saved'));
      await refresh();
    });

  if (!isNew && !asset) return <Skeleton height={420} radius="lg" />;

  const entryLink = (entryId: string | null, entryNo: string | null) =>
    entryId ? (
      <Anchor component={Link} href={`/gl/journals/${entryId}`} className="ltr" size="sm">
        {entryNo ?? '—'}
      </Anchor>
    ) : (
      '—'
    );

  return (
    <Stack>
      <PageHeader
        title={isNew ? t('newAsset') : `${asset?.code} — ${name(asset)}`}
        subtitle={asset && <AssetStatusBadge status={asset.status} />}
        actions={
          canManage && (
            <>
              {draft && (
                <Button variant="default" onClick={save} loading={busy}>
                  {t('save')}
                </Button>
              )}
              {!isNew && asset?.status === 'DRAFT' && (
                <>
                  <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={remove} disabled={busy}>
                    {t('delete')}
                  </Button>
                  <Button
                    leftSection={<IconCircleCheck size={16} />}
                    onClick={() => setActivate({ mode: 'POST', offset_account_id: null, description: '', opening_accum_dep: '', opening_dep_date: '' })}
                  >
                    {t('putInService')}
                  </Button>
                </>
              )}
              {asset && (asset.status === 'ACTIVE' || asset.status === 'FULLY_DEPRECIATED') && (
                <>
                  <Button variant="default" onClick={save} loading={busy}>
                    {t('save')}
                  </Button>
                  <Button variant="default" leftSection={<IconArrowsExchange size={16} />} onClick={() => setTransfer({ cost_center_id: null, transfer_date: today(), notes: '' })}>
                    {t('transfer')}
                  </Button>
                  <Button color="red" variant="light" leftSection={<IconX size={16} />} onClick={() => setDispose({ disposal_date: today(), proceeds: '', proceeds_account_id: null, description: '' })}>
                    {t('dispose')}
                  </Button>
                </>
              )}
              {asset?.status === 'DISPOSED' && (
                <Button variant="default" leftSection={<IconTruckReturn size={16} />} onClick={reverseDisposal} loading={busy}>
                  {t('reverseDisposal')}
                </Button>
              )}
            </>
          )
        }
      />

      {asset && asset.status !== 'DRAFT' && (
        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} className="stagger">
          <Stat label={t('cost')}>
            <Amount value={asset.cost} minor={minor} />
          </Stat>
          <Stat label={t('accumulatedDep')}>
            <Amount value={asset.accumulated} minor={minor} />
          </Stat>
          <Stat label={t('netBookValue')}>
            <Amount value={asset.net_book_value} minor={minor} />
          </Stat>
          <Stat label={asset.status === 'DISPOSED' ? t('disposalDate') : t('depreciatedTo')}>{(asset.status === 'DISPOSED' ? asset.disposal_date : asset.depreciated_to) ?? '—'}</Stat>
        </SimpleGrid>
      )}

      <Paper withBorder p="md">
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <TextInput label={t('code')} required disabled={!draft} value={form.code} onChange={(e) => set('code', e.currentTarget.value)} classNames={{ input: 'ltr' }} />
            <TextInput label={t('nameAr')} value={form.name_ar} onChange={(e) => set('name_ar', e.currentTarget.value)} dir="rtl" />
            <TextInput label={t('nameEn')} value={form.name_en} onChange={(e) => set('name_en', e.currentTarget.value)} dir="ltr" />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Select
              label={t('assetCategory')}
              required
              disabled={!draft}
              data={categories.filter((c) => c.is_active || c.id === form.category_id).map((c) => ({ value: c.id, label: `${c.code} — ${name(c)}` }))}
              value={form.category_id}
              onChange={(v) => set('category_id', v)}
              searchable
            />
            <CostCenterSelect label={t('costCenter')} required disabled={!draft} value={form.cost_center_id} onChange={(v) => set('cost_center_id', v)} />
            <TextInput label={t('serialNo')} value={form.serial_no} onChange={(e) => set('serial_no', e.currentTarget.value)} classNames={{ input: 'ltr' }} />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label={t('location')} value={form.location} onChange={(e) => set('location', e.currentTarget.value)} />
            <TextInput label={t('custodian')} value={form.custodian} onChange={(e) => set('custodian', e.currentTarget.value)} />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 4 }}>
            <TextInput type="date" label={t('acquisitionDate')} required disabled={!draft} value={form.acquisition_date} onChange={(e) => set('acquisition_date', e.currentTarget.value)} />
            <TextInput type="date" label={t('inServiceDate')} disabled={!draft} value={form.in_service_date} onChange={(e) => set('in_service_date', e.currentTarget.value)} placeholder={form.acquisition_date} />
            <TextInput label={t('cost')} required disabled={!draft} value={form.cost} onChange={(e) => set('cost', e.currentTarget.value)} classNames={{ input: 'num' }} inputMode="decimal" />
            <TextInput
              label={t('residualValue')}
              disabled={!draft}
              value={form.residual_value}
              onChange={(e) => set('residual_value', e.currentTarget.value)}
              classNames={{ input: 'num' }}
              inputMode="decimal"
              placeholder={category ? `${Number(category.residual_percent)}%` : undefined}
            />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Select
              label={t('depMethod')}
              disabled={!draft}
              clearable
              data={methodOptions}
              value={form.method}
              onChange={(v) => set('method', (v as DepreciationMethod | null) ?? null)}
              placeholder={category ? t(`method${category.method}`) : undefined}
              description={draft ? t('defaultsFromCategory') : undefined}
            />
            {method === 'STRAIGHT_LINE' && (
              <NumberInput
                label={t('usefulLife')}
                disabled={!draft}
                min={1}
                max={1200}
                value={form.useful_life_months}
                onChange={(v) => set('useful_life_months', v === '' ? '' : Number(v))}
                placeholder={category?.useful_life_months ? String(category.useful_life_months) : undefined}
              />
            )}
            {method === 'DECLINING_BALANCE' && (
              <TextInput
                label={t('decliningRate')}
                disabled={!draft}
                value={form.declining_rate}
                onChange={(e) => set('declining_rate', e.currentTarget.value)}
                classNames={{ input: 'num' }}
                placeholder={category?.declining_rate ?? undefined}
              />
            )}
          </SimpleGrid>
          <Textarea label={t('description')} autosize minRows={2} value={form.notes} onChange={(e) => set('notes', e.currentTarget.value)} />
        </Stack>
      </Paper>

      {asset && asset.status !== 'DRAFT' && (
        <Paper withBorder p="md">
          <Tabs defaultValue="depreciation">
            <Tabs.List mb="sm">
              <Tabs.Tab value="depreciation">{t('depreciationHistory')}</Tabs.Tab>
              <Tabs.Tab value="history">{t('assetHistory')}</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="depreciation">
              {asset.depreciation.length === 0 ? (
                <EmptyState />
              ) : (
                <Table.ScrollContainer minWidth={560}>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t('period')}</Table.Th>
                        <Table.Th>{t('from')}</Table.Th>
                        <Table.Th>{t('to')}</Table.Th>
                        <Table.Th style={{ textAlign: 'end' }}>{t('amount')}</Table.Th>
                        <Table.Th>{t('entryNo')}</Table.Th>
                        <Table.Th>{t('status')}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {asset.depreciation.map((d) => (
                        <Table.Tr key={d.run_id} style={{ opacity: d.status === 'REVERSED' ? 0.5 : 1 }}>
                          <Table.Td className="ltr">{d.period_code}</Table.Td>
                          <Table.Td className="num">{d.from_date}</Table.Td>
                          <Table.Td className="num">{d.to_date}</Table.Td>
                          <Table.Td className="amount-cell">
                            <Amount value={d.amount} minor={minor} />
                          </Table.Td>
                          <Table.Td>{entryLink(d.entry_id, d.entry_no)}</Table.Td>
                          <Table.Td>{d.status === 'REVERSED' ? t('statusREVERSED') : t('statusPOSTED')}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Tabs.Panel>
            <Tabs.Panel value="history">
              <Table.ScrollContainer minWidth={560}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('date')}</Table.Th>
                      <Table.Th>{t('action')}</Table.Th>
                      <Table.Th style={{ textAlign: 'end' }}>{t('amount')}</Table.Th>
                      <Table.Th>{t('entryNo')}</Table.Th>
                      <Table.Th>{t('user')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {asset.events.map((e) => (
                      <Table.Tr key={e.id}>
                        <Table.Td className="num">{e.event_date}</Table.Td>
                        <Table.Td>
                          {t(`event${e.event_type}`)}
                          {e.event_type === 'DISPOSE' && typeof e.details.gain === 'string' && (
                            <Text size="xs" c="dimmed">
                              {t('gainLoss')}: <Amount value={e.details.gain} minor={minor} />
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td className="amount-cell">
                          <Amount value={e.amount} minor={minor} />
                        </Table.Td>
                        <Table.Td>{entryLink(e.entry_id, e.entry_no)}</Table.Td>
                        <Table.Td>{e.created_by_name ?? ''}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Tabs.Panel>
          </Tabs>
        </Paper>
      )}

      <Modal opened={!!activate} onClose={() => setActivate(null)} title={t('putInService')} size="lg">
        {activate && (
          <Stack>
            <SegmentedControl
              fullWidth
              value={activate.mode}
              onChange={(v) => setActivate({ ...activate, mode: v === 'EXISTING' ? 'EXISTING' : 'POST' })}
              data={[
                { value: 'POST', label: t('activateModePost') },
                { value: 'EXISTING', label: t('activateModeExisting') },
              ]}
            />
            <Alert variant="light">{activate.mode === 'POST' ? t('activateModePostHint') : t('activateModeExistingHint')}</Alert>
            {activate.mode === 'POST' ? (
              <>
                <AccountSelect label={t('offsetAccount')} required value={activate.offset_account_id} onChange={(v) => setActivate({ ...activate, offset_account_id: v })} />
                <TextInput label={t('description')} value={activate.description} onChange={(e) => setActivate({ ...activate, description: e.currentTarget.value })} />
              </>
            ) : (
              <SimpleGrid cols={2}>
                <TextInput
                  label={t('openingAccumDep')}
                  value={activate.opening_accum_dep}
                  onChange={(e) => setActivate({ ...activate, opening_accum_dep: e.currentTarget.value })}
                  classNames={{ input: 'num' }}
                  inputMode="decimal"
                />
                <TextInput type="date" label={t('openingDepDate')} value={activate.opening_dep_date} onChange={(e) => setActivate({ ...activate, opening_dep_date: e.currentTarget.value })} />
              </SimpleGrid>
            )}
            <Group justify="flex-end">
              <Button onClick={submitActivate} loading={busy} disabled={activate.mode === 'POST' && !activate.offset_account_id}>
                {t('putInService')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!transfer} onClose={() => setTransfer(null)} title={t('transferAsset')}>
        {transfer && (
          <Stack>
            <CostCenterSelect label={t('costCenter')} required value={transfer.cost_center_id} onChange={(v) => setTransfer({ ...transfer, cost_center_id: v })} />
            <TextInput type="date" label={t('transferDate')} value={transfer.transfer_date} onChange={(e) => setTransfer({ ...transfer, transfer_date: e.currentTarget.value })} />
            <TextInput label={t('description')} value={transfer.notes} onChange={(e) => setTransfer({ ...transfer, notes: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button onClick={submitTransfer} loading={busy} disabled={!transfer.cost_center_id}>
                {t('transfer')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!dispose} onClose={() => setDispose(null)} title={t('dispose')}>
        {dispose && (
          <Stack>
            <Alert variant="light">{t('disposeHint')}</Alert>
            <SimpleGrid cols={2}>
              <TextInput type="date" label={t('disposalDate')} value={dispose.disposal_date} onChange={(e) => setDispose({ ...dispose, disposal_date: e.currentTarget.value })} />
              <TextInput label={t('proceeds')} value={dispose.proceeds} onChange={(e) => setDispose({ ...dispose, proceeds: e.currentTarget.value })} classNames={{ input: 'num' }} inputMode="decimal" placeholder="0" />
            </SimpleGrid>
            {Number(dispose.proceeds) > 0 && (
              <AccountSelect label={t('proceedsAccount')} required value={dispose.proceeds_account_id} onChange={(v) => setDispose({ ...dispose, proceeds_account_id: v })} />
            )}
            <TextInput label={t('description')} value={dispose.description} onChange={(e) => setDispose({ ...dispose, description: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button color="red" onClick={submitDispose} loading={busy}>
                {t('dispose')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};

export default AssetPage;
