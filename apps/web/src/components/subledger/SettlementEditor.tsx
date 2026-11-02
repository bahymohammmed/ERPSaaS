'use client';

import { Alert, Anchor, Badge, Button, Group, Paper, Select, SimpleGrid, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core';
import type { LedgerSide } from '@erp/shared';
import { IconBan, IconCheck } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Amount, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCompanyQuery } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { AllocationTable, type AllocationMap, toAllocations } from './AllocationTable';
import { type BankAccount, type Party, SIDE_UI } from './config';

type Detail = {
  id: string;
  doc_no: string;
  party_code: string;
  party_name_ar: string;
  party_name_en: string;
  bank_code: string;
  bank_name_ar: string;
  bank_name_en: string;
  settle_date: string;
  currency_code: string;
  exchange_rate: string;
  amount: string;
  reference: string | null;
  description: string | null;
  status: 'POSTED' | 'VOID';
  entry_id: string | null;
  entry_no: string | null;
  allocations: { id: string; amount: string; fx_difference: string; is_active: boolean; document_id: string; doc_no: string; doc_date: string }[];
};

export const SettlementEditor = ({ side, id }: { side: LedgerSide; id: string }) => {
  const ui = SIDE_UI[side];
  const isNew = id === 'new';
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const minor = company?.base_minor_units ?? 3;
  const { data: parties = [] } = useCompanyQuery<Party[]>(['sl-parties', side], `/sl/${side}/parties`);
  const { data: banks = [] } = useCompanyQuery<BankAccount[]>(['cb-accounts'], '/cb/accounts');
  const detail = useQuery({ queryKey: [company?.id, 'sl-settlement', id], queryFn: () => api<Detail>(`/sl/${side}/settlements/${id}`), enabled: !!company && !isNew });
  const [form, setForm] = useState({ party_id: null as string | null, bank_account_id: null as string | null, settle_date: new Date().toISOString().slice(0, 10), amount: '', exchange_rate: '', reference: '', description: '' });
  const [allocations, setAllocations] = useState<AllocationMap>({});
  const [busy, setBusy] = useState(false);
  const party = parties.find((p) => p.id === form.party_id);
  const foreign = !!party && party.currency_code !== company?.base_currency;
  const bankOptions = banks.filter((b) => b.is_active && (!party || b.currency_code === party.currency_code));

  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === company?.id && (String(q.queryKey[1]).startsWith('sl-') || String(q.queryKey[1]).startsWith('cb-')) });

  const save = async () => {
    setBusy(true);
    try {
      const result = await api<{ id: string; doc_no: string }>(`/sl/${side}/settlements`, {
        method: 'POST',
        body: { ...form, exchange_rate: foreign && form.exchange_rate ? form.exchange_rate : null, reference: form.reference || null, description: form.description || null, allocations: toAllocations(allocations) },
      });
      notifySuccess(`${t('saved')}: ${result.doc_no}`);
      await refresh();
      router.replace(`${ui.settlements}/${result.id}`);
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const voidIt = async () => {
    if (!window.confirm(t('confirmVoid'))) return;
    setBusy(true);
    try {
      await api(`/sl/${side}/settlements/${id}/void`, { method: 'POST', body: {} });
      notifySuccess(t('saved'));
      await refresh();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (!isNew) {
    const s = detail.data;
    if (!s) return <Skeleton height={320} radius="lg" />;
    return (
      <Stack>
        <PageHeader
          title={s.doc_no}
          subtitle={
            <Badge variant="light" color={s.status === 'POSTED' ? 'teal' : 'red'}>
              {t(`docStatus${s.status}`)}
            </Badge>
          }
          actions={
            can(ui.manage) &&
            s.status === 'POSTED' && (
              <Button color="red" variant="light" leftSection={<IconBan size={16} />} onClick={voidIt} loading={busy}>
                {t('voidDocument')}
              </Button>
            )
          }
        />
        <Paper withBorder p="md">
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
            <div>
              <Text size="xs" c="dimmed">{t(ui.party)}</Text>
              <Text>{s.party_code} — {name({ name_ar: s.party_name_ar, name_en: s.party_name_en })}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">{t('bankAccount')}</Text>
              <Text>{s.bank_code} — {name({ name_ar: s.bank_name_ar, name_en: s.bank_name_en })}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">{t('date')}</Text>
              <Text className="num">{s.settle_date}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">{t('amount')}</Text>
              <Text fw={700} className="num">
                <Amount value={s.amount} minor={minor} /> {s.currency_code}
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">{t('reference')}</Text>
              <Text>{s.reference ?? '—'}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">{t('entryNo')}</Text>
              {s.entry_id ? (
                <Anchor component={Link} href={`/gl/journals/${s.entry_id}`} className="ltr">
                  {s.entry_no}
                </Anchor>
              ) : (
                '—'
              )}
            </div>
          </SimpleGrid>
        </Paper>
        <Paper withBorder p="md">
          <Text fw={600} mb="xs">{t('appliedDocuments')}</Text>
          <Table>
            <Table.Tbody>
              {s.allocations.map((a) => (
                <Table.Tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.5 }}>
                  <Table.Td>
                    <Anchor component={Link} href={`${ui.documents}/${a.document_id}`} className="ltr" size="sm">
                      {a.doc_no}
                    </Anchor>
                  </Table.Td>
                  <Table.Td className="num">{a.doc_date}</Table.Td>
                  <Table.Td className="amount-cell">
                    <Amount value={a.amount} minor={minor} />
                  </Table.Td>
                  <Table.Td className="amount-cell">{Number(a.fx_difference) !== 0 && <Text size="xs" c="dimmed">{t('fxDifference')}: <Amount value={a.fx_difference} minor={minor} /></Text>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      </Stack>
    );
  }

  return (
    <Stack>
      <PageHeader
        title={t(ui.newSettlement)}
        actions={
          <Button leftSection={<IconCheck size={16} />} onClick={save} loading={busy} disabled={!form.party_id || !form.bank_account_id || !(Number(form.amount) > 0)}>
            {t('postDocument')}
          </Button>
        }
      />
      <Alert variant="light">{t('settlementInfo')}</Alert>
      <Paper withBorder p="md">
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label={t(ui.party)}
            required
            searchable
            data={parties.filter((p) => p.is_active).map((p) => ({ value: p.id, label: `${p.code} — ${name(p)}` }))}
            value={form.party_id}
            onChange={(v) => {
              const chosen = parties.find((p) => p.id === v);
              const bank = banks.find((b) => b.is_active && b.currency_code === chosen?.currency_code);
              setForm({ ...form, party_id: v, bank_account_id: bank?.id ?? null });
              setAllocations({});
            }}
          />
          <Select label={t('bankAccount')} required data={bankOptions.map((b) => ({ value: b.id, label: `${b.code} — ${name(b)} (${b.currency_code})` }))} value={form.bank_account_id} onChange={(v) => setForm({ ...form, bank_account_id: v })} />
          <TextInput type="date" label={t('date')} required value={form.settle_date} onChange={(e) => setForm({ ...form, settle_date: e.currentTarget.value })} />
          <TextInput label={`${t('amount')}${party ? ` (${party.currency_code})` : ''}`} required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.currentTarget.value })} classNames={{ input: 'num' }} inputMode="decimal" />
          <TextInput label={t('reference')} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.currentTarget.value })} />
          {foreign ? (
            <TextInput label={t('exchangeRate')} value={form.exchange_rate} onChange={(e) => setForm({ ...form, exchange_rate: e.currentTarget.value })} classNames={{ input: 'num' }} placeholder="SPOT" />
          ) : (
            <TextInput label={t('description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.currentTarget.value })} />
          )}
        </SimpleGrid>
      </Paper>
      {form.party_id && (
        <Paper withBorder p="md">
          <AllocationTable side={side} partyId={form.party_id} total={Number(form.amount) || 0} value={allocations} onChange={setAllocations} minor={minor} />
        </Paper>
      )}
    </Stack>
  );
};
