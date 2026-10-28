'use client';

import { ActionIcon, Alert, Anchor, Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { sumAmounts } from '@erp/shared';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AccountSelect, Amount, CostCenterSelect, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCompanyQuery } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toTreeRows } from '@/lib/tree';
import type { Account, CostCenter } from '@/lib/types';

type Partner = { id: string; partner_company_id: string; partner_code: string; partner_name_ar: string; partner_name_en: string; due_from_code: string; due_to_code: string };
type Line = { account_id: string | null; cost_center_id: string | null; description: string; debit: string; credit: string };

const blank = (): Line => ({ account_id: null, cost_center_id: null, description: '', debit: '', credit: '' });
const isAmount = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());
const net = (lines: Line[]) =>
  sumAmounts(lines.map((l) => (isAmount(l.debit) ? l.debit : '0'))).minus(sumAmounts(lines.map((l) => (isAmount(l.credit) ? l.credit : '0'))));

/** Line editor for one company; account and cost center lists come from that company. */
const SideEditor = ({ title, companyId, lines, onChange }: { title: string; companyId: string | null; lines: Line[]; onChange: (lines: Line[]) => void }) => {
  const { t, name } = useI18n();
  const { company } = useSession();
  const foreign = !!companyId && companyId !== company?.id;
  const accounts = useQuery({
    queryKey: ['ic-accounts', companyId],
    queryFn: () => api<Account[]>('/gl/accounts', { companyId: companyId ?? undefined }),
    enabled: foreign,
  });
  const costCenters = useQuery({
    queryKey: ['ic-cost-centers', companyId],
    queryFn: () => api<CostCenter[]>('/gl/cost-centers', { companyId: companyId ?? undefined }),
    enabled: foreign,
  });
  const accountOptions = useMemo(() => toTreeRows(accounts.data ?? []).filter((a) => a.is_posting && a.is_active).map((a) => ({ value: a.id, label: `${a.code} — ${name(a)}` })), [accounts.data, name]);
  const ccOptions = useMemo(() => toTreeRows(costCenters.data ?? []).filter((c) => c.is_posting && c.is_active).map((c) => ({ value: c.id, label: `${c.code} — ${name(c)}` })), [costCenters.data, name]);
  const update = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Paper withBorder p="sm">
      <Title order={6} mb="xs">
        {title}
      </Title>
      <Stack gap={6}>
        {lines.map((l, i) => (
          <Group key={i} gap={6} wrap="nowrap" align="flex-start">
            {foreign ? (
              <Select size="xs" searchable style={{ flex: 2 }} placeholder={t('account')} data={accountOptions} value={l.account_id} onChange={(v) => update(i, { account_id: v })} />
            ) : (
              <AccountSelect size="xs" style={{ flex: 2 }} placeholder={t('account')} value={l.account_id} onChange={(v) => update(i, { account_id: v })} />
            )}
            {foreign ? (
              <Select size="xs" searchable clearable style={{ flex: 1 }} placeholder={t('costCenter')} data={ccOptions} value={l.cost_center_id} onChange={(v) => update(i, { cost_center_id: v })} />
            ) : (
              <CostCenterSelect size="xs" style={{ flex: 1 }} placeholder={t('costCenter')} value={l.cost_center_id} onChange={(v) => update(i, { cost_center_id: v })} />
            )}
            <TextInput size="xs" w={100} placeholder={t('debit')} classNames={{ input: 'ltr' }} value={l.debit} onChange={(e) => update(i, { debit: e.currentTarget.value, ...(e.currentTarget.value ? { credit: '' } : {}) })} />
            <TextInput size="xs" w={100} placeholder={t('credit')} classNames={{ input: 'ltr' }} value={l.credit} onChange={(e) => update(i, { credit: e.currentTarget.value, ...(e.currentTarget.value ? { debit: '' } : {}) })} />
            <ActionIcon variant="subtle" color="red" disabled={lines.length <= 1} onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={t('removeLine')}>
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        ))}
        <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => onChange([...lines, blank()])} w="fit-content">
          {t('addLine')}
        </Button>
      </Stack>
    </Paper>
  );
};

const IntercompanyPage = () => {
  const { t, name, errorText } = useI18n();
  const { me, company, can } = useSession();
  const queryClient = useQueryClient();
  const minor = company?.base_minor_units ?? 3;
  const { data: partners = [] } = useCompanyQuery<Partner[]>(['ic-partners'], '/gl/intercompany/partners');
  const [partnerForm, setPartnerForm] = useState<{ partner_company_id: string | null; due_from_account_id: string | null; due_to_account_id: string | null }>({ partner_company_id: null, due_from_account_id: null, due_to_account_id: null });
  const [tx, setTx] = useState({ target_company_id: null as string | null, entry_date: new Date().toISOString().slice(0, 10), description: '', reference: '' });
  const [sourceLines, setSourceLines] = useState<Line[]>([blank()]);
  const [targetLines, setTargetLines] = useState<Line[]>([blank()]);
  const [result, setResult] = useState<{ source_entry_id: string; source_entry_no: string; target_entry_no: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const otherCompanies = (me?.companies ?? []).filter((c) => c.id !== company?.id);
  const sourceNet = net(sourceLines);
  const targetNet = net(targetLines);
  const offsets = !sourceNet.isZero() && sourceNet.plus(targetNet).isZero();

  const savePartner = async () => {
    try {
      await api('/gl/intercompany/partners', { method: 'POST', body: partnerForm });
      notifySuccess(t('saved'));
      setPartnerForm({ partner_company_id: null, due_from_account_id: null, due_to_account_id: null });
      await queryClient.invalidateQueries({ queryKey: [company?.id, 'ic-partners'] });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const removePartner = async (p: Partner) => {
    if (!window.confirm(t('confirmDelete'))) return;
    await api(`/gl/intercompany/partners/${p.id}`, { method: 'DELETE' }).catch((e: unknown) => notifyError(errorText(e)));
    await queryClient.invalidateQueries({ queryKey: [company?.id, 'ic-partners'] });
  };

  const submit = async () => {
    setBusy(true);
    try {
      const toLines = (lines: Line[]) =>
        lines.filter((l) => l.account_id).map((l) => ({ account_id: l.account_id, cost_center_id: l.cost_center_id, description: l.description || null, debit: l.debit || '0', credit: l.credit || '0' }));
      const created = await api<{ source_entry_id: string; source_entry_no: string; target_entry_no: string; warnings: unknown[] }>('/gl/intercompany/transactions', {
        method: 'POST',
        body: { ...tx, description: tx.description || null, reference: tx.reference || null, source_lines: toLines(sourceLines), target_lines: toLines(targetLines) },
      });
      setResult(created);
      setSourceLines([blank()]);
      setTargetLines([blank()]);
      notifySuccess(t('saved'));
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack>
      <PageHeader title={t('navIntercompany')} />
      <Paper withBorder p="md">
        <Title order={5} mb="sm">
          {t('partners')}
        </Title>
        <Table striped mb="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('partnerCompany')}</Table.Th>
              <Table.Th>{t('dueFromAccount')}</Table.Th>
              <Table.Th>{t('dueToAccount')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {partners.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>
                  <span className="ltr">{p.partner_code}</span> — {name({ name_ar: p.partner_name_ar, name_en: p.partner_name_en })}
                </Table.Td>
                <Table.Td className="ltr">{p.due_from_code}</Table.Td>
                <Table.Td className="ltr">{p.due_to_code}</Table.Td>
                <Table.Td>
                  {can('gl.master.manage') && (
                    <ActionIcon variant="subtle" color="red" onClick={() => removePartner(p)} aria-label={t('delete')}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {can('gl.master.manage') && (
          <SimpleGrid cols={{ base: 1, sm: 4 }}>
            <Select label={t('partnerCompany')} data={otherCompanies.map((c) => ({ value: c.id, label: `${c.code} — ${name(c)}` }))} value={partnerForm.partner_company_id} onChange={(v) => setPartnerForm({ ...partnerForm, partner_company_id: v })} />
            <AccountSelect label={t('dueFromAccount')} value={partnerForm.due_from_account_id} onChange={(v) => setPartnerForm({ ...partnerForm, due_from_account_id: v })} />
            <AccountSelect label={t('dueToAccount')} value={partnerForm.due_to_account_id} onChange={(v) => setPartnerForm({ ...partnerForm, due_to_account_id: v })} />
            <Group align="flex-end">
              <Button onClick={savePartner} disabled={!partnerForm.partner_company_id || !partnerForm.due_from_account_id || !partnerForm.due_to_account_id}>
                {t('save')}
              </Button>
            </Group>
          </SimpleGrid>
        )}
      </Paper>

      {can('gl.journal.post') && (
        <Paper withBorder p="md">
          <Title order={5} mb="sm">
            {t('newIcTransaction')}
          </Title>
          <Text size="sm" c="dimmed" mb="sm">
            {t('icHint')}
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 4 }} mb="sm">
            <Select label={t('partnerCompany')} data={partners.map((p) => ({ value: p.partner_company_id, label: `${p.partner_code} — ${name({ name_ar: p.partner_name_ar, name_en: p.partner_name_en })}` }))} value={tx.target_company_id} onChange={(v) => { setTx({ ...tx, target_company_id: v }); setTargetLines([blank()]); }} />
            <TextInput type="date" label={t('entryDate')} value={tx.entry_date} onChange={(e) => setTx({ ...tx, entry_date: e.currentTarget.value })} />
            <TextInput label={t('description')} value={tx.description} onChange={(e) => setTx({ ...tx, description: e.currentTarget.value })} />
            <TextInput label={t('reference')} value={tx.reference} onChange={(e) => setTx({ ...tx, reference: e.currentTarget.value })} />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <SideEditor title={`${t('ourSide')}: ${company?.code ?? ''}`} companyId={company?.id ?? null} lines={sourceLines} onChange={setSourceLines} />
            {tx.target_company_id && <SideEditor title={`${t('partnerSide')}: ${partners.find((p) => p.partner_company_id === tx.target_company_id)?.partner_code ?? ''}`} companyId={tx.target_company_id} lines={targetLines} onChange={setTargetLines} />}
          </SimpleGrid>
          <Group mt="md" justify="space-between">
            <Group gap="md">
              <Text size="sm">
                {t('ourSide')}: <Amount value={sourceNet.toString()} minor={minor} />
              </Text>
              <Text size="sm">
                {t('partnerSide')}: <Amount value={targetNet.toString()} minor={minor} />
              </Text>
              <Badge color={offsets ? 'teal' : 'red'} variant="light">
                {offsets ? t('balanced') : t('unbalanced')}
              </Badge>
            </Group>
            <Button onClick={submit} loading={busy} disabled={!tx.target_company_id || !offsets}>
              {t('postBoth')}
            </Button>
          </Group>
          {result && (
            <Alert color="teal" mt="md">
              <Anchor component={Link} href={`/gl/journals/${result.source_entry_id}`} className="ltr">
                {result.source_entry_no}
              </Anchor>{' '}
              ↔ <span className="ltr">{result.target_entry_no}</span>
            </Alert>
          )}
        </Paper>
      )}
    </Stack>
  );
};

export default IntercompanyPage;

