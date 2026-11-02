'use client';

import { ActionIcon, Anchor, Badge, Button, Group, Modal, Paper, Select, SimpleGrid, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core';
import type { LedgerSide } from '@erp/shared';
import { IconBan, IconCheck, IconDeviceFloppy, IconPlus, IconPrinter, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AccountSelect, Amount, CostCenterSelect, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api, download } from '@/lib/api';
import { useCompanyQuery } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { AllocationTable, type AllocationMap, toAllocations } from './AllocationTable';
import { ApplyButton, RemoveAllocationButton } from './ApplyLater';
import { DOC_STATUS_COLORS, type Party, type PartyDocument, SIDE_UI } from './config';

type Line = { key: number; description: string; account_id: string | null; cost_center_id: string | null; quantity: string; unit_price: string; tax_code_id: string | null };
type TaxCode = { id: string; code: string; name_ar: string; name_en: string; rate: string; is_active: boolean };
type Detail = PartyDocument & {
  entry_id: string | null;
  entry_no: string | null;
  void_entry_no: string | null;
  subtotal: string;
  tax_total: string;
  lines: { line_no: number; description: string; account_id: string; cost_center_id: string | null; quantity: string; unit_price: string; amount: string; tax_code_id: string | null; tax_amount: string }[];
  applied: { id: string; amount: string; fx_difference: string; is_active: boolean; alloc_date: string; removed_on: string | null; source_no: string; source_date: string; target_no: string; settlement_id: string | null; source_document_id: string | null; target_id: string }[];
};

let nextKey = 1;
const blankLine = (account: string | null = null, tax: string | null = null): Line => ({ key: nextKey++, description: '', account_id: account, cost_center_id: null, quantity: '1', unit_price: '', tax_code_id: tax });
const today = () => new Date().toISOString().slice(0, 10);

export const DocumentEditor = ({ side, id }: { side: LedgerSide; id: string }) => {
  const ui = SIDE_UI[side];
  const isNew = id === 'new';
  const search = useSearchParams();
  const { t, name, errorText, locale, digits } = useI18n();
  const { can, company } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const minor = company?.base_minor_units ?? 3;
  const { data: parties = [] } = useCompanyQuery<Party[]>(['sl-parties', side], `/sl/${side}/parties`);
  const { data: taxCodes = [] } = useCompanyQuery<TaxCode[]>(['tax-codes'], '/tax/codes');
  const detail = useQuery({ queryKey: [company?.id, 'sl-document', id], queryFn: () => api<Detail>(`/sl/${side}/documents/${id}`), enabled: !!company && !isNew });
  const doc = detail.data;
  const [docType, setDocType] = useState<'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE'>(search.get('type') === ui.note ? ui.note : 'INVOICE');
  const [header, setHeader] = useState({ party_id: null as string | null, doc_date: today(), due_date: '', exchange_rate: '', reference: '', description: '' });
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [allocating, setAllocating] = useState<AllocationMap | null>(null);

  useEffect(() => {
    if (!doc) return;
    setDocType(doc.doc_type);
    setHeader({ party_id: doc.party_id, doc_date: doc.doc_date, due_date: doc.due_date, exchange_rate: doc.currency_code === company?.base_currency ? '' : String(Number(doc.exchange_rate)), reference: doc.reference ?? '', description: doc.description ?? '' });
    setLines(doc.lines.map((l) => ({ key: nextKey++, description: l.description, account_id: l.account_id, cost_center_id: l.cost_center_id, quantity: String(Number(l.quantity)), unit_price: String(Number(l.unit_price)), tax_code_id: l.tax_code_id })));
  }, [doc, company?.base_currency]);

  const party = parties.find((p) => p.id === header.party_id);
  const draft = isNew || doc?.status === 'DRAFT';
  const canManage = can(ui.manage);
  const foreign = !!party && party.currency_code !== company?.base_currency;
  const rateOf = (code: string | null) => Number(taxCodes.find((c) => c.id === code)?.rate ?? 0);
  const lineAmount = (l: Line) => (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
  const lineTax = (l: Line) => Number(((lineAmount(l) * rateOf(l.tax_code_id)) / 100).toFixed(minor));
  const subtotal = useMemo(() => lines.reduce((acc, l) => acc + lineAmount(l), 0), [lines]);
  const taxTotal = useMemo(() => lines.reduce((acc, l) => acc + lineTax(l), 0), [lines, taxCodes]);
  const total = subtotal + taxTotal;
  const taxOptions = taxCodes.filter((c) => c.is_active || lines.some((l) => l.tax_code_id === c.id)).map((c) => ({ value: c.id, label: `${c.code} ${Number(c.rate)}%` }));
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === company?.id && String(q.queryKey[1]).startsWith('sl-') });

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

  const body = () => ({
    doc_type: docType,
    party_id: header.party_id,
    doc_date: header.doc_date,
    due_date: header.due_date || null,
    exchange_rate: foreign && header.exchange_rate ? header.exchange_rate : null,
    reference: header.reference || null,
    description: header.description || null,
    lines: lines.filter((l) => l.account_id && l.unit_price !== '').map((l) => ({ description: l.description, account_id: l.account_id, cost_center_id: l.cost_center_id, quantity: l.quantity || '1', unit_price: l.unit_price, tax_code_id: l.tax_code_id })),
  });

  const save = async (): Promise<string> => {
    if (isNew) {
      const created = await api<{ id: string }>(`/sl/${side}/documents`, { method: 'POST', body: body() });
      return created.id;
    }
    await api(`/sl/${side}/documents/${id}`, { method: 'PUT', body: body() });
    return id;
  };

  const saveDraft = () =>
    run(async () => {
      const savedId = await save();
      notifySuccess(t('saved'));
      await refresh();
      if (isNew) router.replace(`${ui.documents}/${savedId}`);
    });

  const post = (allocations: AllocationMap = {}) =>
    run(async () => {
      const savedId = await save();
      const result = await api<{ doc_no: string }>(`/sl/${side}/documents/${savedId}/post`, { method: 'POST', body: { allocations: toAllocations(allocations) } });
      notifySuccess(`${t('saved')}: ${result.doc_no}`);
      setAllocating(null);
      await refresh();
      if (isNew) router.replace(`${ui.documents}/${savedId}`);
    });

  const voidDoc = () =>
    run(async () => {
      if (!window.confirm(t('confirmVoid'))) return;
      await api(`/sl/${side}/documents/${id}/void`, { method: 'POST', body: {} });
      notifySuccess(t('saved'));
      await refresh();
    });

  const remove = () =>
    run(async () => {
      if (!window.confirm(t('confirmDelete'))) return;
      await api(`/sl/${side}/documents/${id}`, { method: 'DELETE' });
      await refresh();
      router.replace(ui.documents);
    });

  const print = () => download(`/sl/${side}/documents/${id}/print`, { format: 'pdf', lang: locale === 'ar' ? 'both' : 'en', digits }, `${doc?.doc_no ?? 'document'}.pdf`).catch((e: unknown) => notifyError(errorText(e)));

  if (!isNew && !doc) return <Skeleton height={420} radius="lg" />;
  const title = isNew ? (docType === 'INVOICE' ? t('newInvoice') : t(ui.newNote)) : `${t(`doc${docType}`)} ${doc?.doc_no ?? ''}`;

  return (
    <Stack>
      <PageHeader
        title={title}
        subtitle={
          doc && (
            <Badge variant="light" color={DOC_STATUS_COLORS[doc.status]}>
              {t(`docStatus${doc.status}`)}
            </Badge>
          )
        }
        actions={
          <>
            {!isNew && (
              <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={print}>
                {t('printPdf')}
              </Button>
            )}
            {canManage && draft && !isNew && (
              <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={remove} disabled={busy}>
                {t('delete')}
              </Button>
            )}
            {canManage && draft && (
              <>
                <Button variant="default" leftSection={<IconDeviceFloppy size={16} />} onClick={saveDraft} loading={busy}>
                  {t('saveDraft')}
                </Button>
                <Button leftSection={<IconCheck size={16} />} onClick={() => (docType === 'INVOICE' ? post() : setAllocating({}))} loading={busy} disabled={!header.party_id || subtotal <= 0}>
                  {t('postDocument')}
                </Button>
              </>
            )}
            {canManage && doc?.status === 'POSTED' && doc.doc_type !== 'INVOICE' && Number(doc.open_amount) > 0 && (
              <ApplyButton side={side} partyId={doc.party_id} sourceType="DOCUMENT" sourceId={doc.id} open={Number(doc.open_amount)} minor={minor} onDone={refresh} />
            )}
            {canManage && doc?.status === 'POSTED' && (
              <Button color="red" variant="light" leftSection={<IconBan size={16} />} onClick={voidDoc} loading={busy}>
                {t('voidDocument')}
              </Button>
            )}
          </>
        }
      />

      {doc && doc.status !== 'DRAFT' && (
        <Group gap="lg">
          <Text size="sm">
            {t('total')}: <Amount value={doc.total} minor={minor} /> {doc.currency_code}
          </Text>
          <Text size="sm" fw={600}>
            {t('openAmount')}: <Amount value={doc.open_amount} minor={minor} />
          </Text>
          {doc.entry_id && (
            <Anchor component={Link} href={`/gl/journals/${doc.entry_id}`} size="sm" className="ltr">
              {doc.entry_no}
            </Anchor>
          )}
        </Group>
      )}

      <Paper withBorder p="md">
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label={t(ui.party)}
            required
            searchable
            disabled={!draft}
            data={parties.filter((p) => p.is_active || p.id === header.party_id).map((p) => ({ value: p.id, label: `${p.code} — ${name(p)}` }))}
            value={header.party_id}
            onChange={(v) => {
              const chosen = parties.find((p) => p.id === v);
              setHeader((h) => ({ ...h, party_id: v }));
              if (chosen?.default_account_id) setLines((ls) => ls.map((l) => (l.account_id ? l : { ...l, account_id: chosen.default_account_id })));
            }}
          />
          <TextInput type="date" label={t('date')} required disabled={!draft} value={header.doc_date} onChange={(e) => setHeader({ ...header, doc_date: e.currentTarget.value })} />
          <TextInput
            type="date"
            label={t('dueDate')}
            disabled={!draft}
            value={header.due_date}
            onChange={(e) => setHeader({ ...header, due_date: e.currentTarget.value })}
            description={draft && party && !header.due_date ? `+${party.payment_terms_days}` : undefined}
          />
          <TextInput label={t('reference')} disabled={!draft} value={header.reference} onChange={(e) => setHeader({ ...header, reference: e.currentTarget.value })} />
          <TextInput label={t('description')} disabled={!draft} value={header.description} onChange={(e) => setHeader({ ...header, description: e.currentTarget.value })} />
          {foreign && (
            <TextInput
              label={`${t('exchangeRate')} (${party?.currency_code})`}
              disabled={!draft}
              value={header.exchange_rate}
              onChange={(e) => setHeader({ ...header, exchange_rate: e.currentTarget.value })}
              classNames={{ input: 'num' }}
              placeholder="SPOT"
            />
          )}
        </SimpleGrid>
      </Paper>

      <Paper withBorder p="md">
        <Table.ScrollContainer minWidth={1080}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 32 }}>#</Table.Th>
                <Table.Th style={{ minWidth: 200 }}>{t('description')}</Table.Th>
                <Table.Th style={{ width: 240 }}>{t('account')}</Table.Th>
                <Table.Th style={{ width: 190 }}>{t('costCenter')}</Table.Th>
                <Table.Th style={{ width: 90 }}>{t('quantity')}</Table.Th>
                <Table.Th style={{ width: 130 }}>{t('unitPrice')}</Table.Th>
                <Table.Th style={{ width: 130, textAlign: 'end' }}>{t('amount')}</Table.Th>
                {(taxOptions.length > 0 || taxTotal > 0) && <Table.Th style={{ width: 140 }}>{t('taxCode')}</Table.Th>}
                <Table.Th style={{ width: 40 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((l, i) => (
                <Table.Tr key={l.key}>
                  <Table.Td>{i + 1}</Table.Td>
                  <Table.Td>
                    <TextInput size="xs" disabled={!draft} value={l.description} onChange={(e) => setLine(l.key, { description: e.currentTarget.value })} />
                  </Table.Td>
                  <Table.Td>
                    <AccountSelect size="xs" disabled={!draft} value={l.account_id} onChange={(v) => setLine(l.key, { account_id: v })} />
                  </Table.Td>
                  <Table.Td>
                    <CostCenterSelect size="xs" disabled={!draft} value={l.cost_center_id} onChange={(v) => setLine(l.key, { cost_center_id: v })} />
                  </Table.Td>
                  <Table.Td>
                    <TextInput size="xs" disabled={!draft} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.currentTarget.value })} classNames={{ input: 'num' }} inputMode="decimal" />
                  </Table.Td>
                  <Table.Td>
                    <TextInput size="xs" disabled={!draft} value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: e.currentTarget.value })} classNames={{ input: 'num' }} inputMode="decimal" />
                  </Table.Td>
                  <Table.Td className="amount-cell">
                    <Amount value={lineAmount(l).toFixed(minor)} minor={minor} />
                  </Table.Td>
                  {(taxOptions.length > 0 || taxTotal > 0) && (
                    <Table.Td>
                      <Select size="xs" clearable disabled={!draft} data={taxOptions} value={l.tax_code_id} onChange={(v) => setLine(l.key, { tax_code_id: v })} placeholder="—" />
                    </Table.Td>
                  )}
                  <Table.Td>
                    {draft && lines.length > 1 && (
                      <ActionIcon variant="subtle" color="red" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t('removeLine')}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Group justify="space-between" mt="sm" className="totals-bar">
          {draft ? (
            <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setLines((ls) => [...ls, blankLine(party?.default_account_id ?? null, ls.at(-1)?.tax_code_id ?? null)])}>
              {t('addLine')}
            </Button>
          ) : (
            <span />
          )}
          <Group gap="lg">
            {taxTotal > 0 && (
              <>
                <Text size="sm" c="dimmed" className="num">
                  {t('subtotal')}: {subtotal.toFixed(minor)}
                </Text>
                <Text size="sm" c="dimmed" className="num">
                  {t('tax')}: {taxTotal.toFixed(minor)}
                </Text>
              </>
            )}
            <Text fw={700} className="num">
              {t('total')}: {total.toFixed(minor)} {party?.currency_code ?? ''}
            </Text>
          </Group>
        </Group>
      </Paper>

      {doc && doc.applied.length > 0 && (
        <Paper withBorder p="md">
          <Text fw={600} mb="xs">
            {t('appliedDocuments')}
          </Text>
          <Table>
            <Table.Tbody>
              {doc.applied.map((a) => (
                <Table.Tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.5 }}>
                  <Table.Td className="ltr">{a.target_id === doc.id ? a.source_no : a.target_no}</Table.Td>
                  <Table.Td className="num">{a.alloc_date}</Table.Td>
                  <Table.Td className="amount-cell">
                    <Amount value={a.amount} minor={minor} />
                  </Table.Td>
                  <Table.Td className="amount-cell">{Number(a.fx_difference) !== 0 && <Text size="xs" c="dimmed">{t('fxDifference')}: <Amount value={a.fx_difference} minor={minor} /></Text>}</Table.Td>
                  <Table.Td>
                    {a.is_active ? (
                      canManage && doc.status === 'POSTED' && <RemoveAllocationButton side={side} allocationId={a.id} onDone={refresh} />
                    ) : (
                      <Text size="xs" c="dimmed">{a.removed_on ? `${t('unallocated')} ${a.removed_on}` : t('docStatusVOID')}</Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <Modal opened={!!allocating} onClose={() => setAllocating(null)} title={t('postDocument')} size="xl">
        {allocating && (
          <Stack>
            <AllocationTable side={side} partyId={header.party_id} total={total} value={allocating} onChange={setAllocating} minor={minor} />
            <Group justify="flex-end">
              <Button onClick={() => post(allocating)} loading={busy}>
                {t('postDocument')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};
