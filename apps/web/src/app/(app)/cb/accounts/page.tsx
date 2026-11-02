'use client';

import { ActionIcon, Badge, Button, Checkbox, Group, Modal, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconArrowsExchange, IconPencil, IconPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AccountSelect, Amount, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { EmptyRow, TableSkeletonRows } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCompanyQuery, useCurrencies } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Account = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  kind: 'BANK' | 'CASH';
  account_id: string;
  account_code: string;
  currency_code: string;
  bank_name: string | null;
  account_number: string | null;
  iban: string | null;
  is_active: boolean;
  balance: string;
  balance_base: string;
  reconciled_to: string | null;
};
type Form = { id?: string; code: string; name_ar: string; name_en: string; kind: 'BANK' | 'CASH'; account_id: string | null; currency_code: string; bank_name: string; account_number: string; iban: string; is_active: boolean };
type Transfer = { transfer_date: string; from_account_id: string | null; to_account_id: string | null; amount: string; to_amount: string; reference: string; description: string };

const BankAccountsPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const minor = company?.base_minor_units ?? 3;
  const { data = [], isLoading } = useCompanyQuery<Account[]>(['cb-accounts'], '/cb/accounts');
  const { data: currencies = [] } = useCurrencies();
  const [form, setForm] = useState<Form | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can('cb.manage');
  const refresh = () => queryClient.invalidateQueries({ queryKey: [company?.id, 'cb-accounts'] });

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
      if (!form) return;
      const { id, ...body } = form;
      await api(id ? `/cb/accounts/${id}` : '/cb/accounts', { method: id ? 'PUT' : 'POST', body: { ...body, bank_name: body.bank_name || null, account_number: body.account_number || null, iban: body.iban || null } });
      notifySuccess(t('saved'));
      setForm(null);
      await refresh();
    });

  const submitTransfer = () =>
    run(async () => {
      if (!transfer) return;
      await api('/cb/transfers', { method: 'POST', body: { ...transfer, to_amount: transfer.to_amount || null, reference: transfer.reference || null, description: transfer.description || null } });
      notifySuccess(t('saved'));
      setTransfer(null);
      await refresh();
    });

  const from = data.find((a) => a.id === transfer?.from_account_id);
  const to = data.find((a) => a.id === transfer?.to_account_id);
  const options = data.filter((a) => a.is_active).map((a) => ({ value: a.id, label: `${a.code} — ${name(a)} (${a.currency_code})` }));

  return (
    <>
      <PageHeader
        title={t('navBankAccounts')}
        actions={
          canManage && (
            <>
              <Button
                variant="default"
                leftSection={<IconArrowsExchange size={16} />}
                onClick={() => setTransfer({ transfer_date: new Date().toISOString().slice(0, 10), from_account_id: null, to_account_id: null, amount: '', to_amount: '', reference: '', description: '' })}
              >
                {t('transferFunds')}
              </Button>
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() => setForm({ code: '', name_ar: '', name_en: '', kind: 'BANK', account_id: null, currency_code: company?.base_currency ?? 'KWD', bank_name: '', account_number: '', iban: '', is_active: true })}
              >
                {t('add')}
              </Button>
            </>
          )
        }
      />
      <Paper withBorder p="sm">
        <Table.ScrollContainer minWidth={860}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('code')}</Table.Th>
                <Table.Th>{t('name')}</Table.Th>
                <Table.Th>{t('type')}</Table.Th>
                <Table.Th>{t('ledgerAccount')}</Table.Th>
                <Table.Th>{t('currency')}</Table.Th>
                <Table.Th style={{ textAlign: 'end' }}>{t('balance')}</Table.Th>
                <Table.Th>{t('reconciledTo')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && <TableSkeletonRows cols={8} />}
              {!isLoading && data.length === 0 && <EmptyRow cols={8} />}
              {data.map((a) => (
                <Table.Tr key={a.id} className="clickable" onClick={() => router.push(`/cb/accounts/${a.id}`)}>
                  <Table.Td className="ltr" fw={500}>
                    {a.code}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{name(a)}</Text>
                    {(a.bank_name || a.iban) && (
                      <Text size="xs" c="dimmed" className="ltr">
                        {[a.bank_name, a.iban].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={a.kind === 'BANK' ? 'blue' : 'grape'}>
                      {t(`kind${a.kind}`)}
                    </Badge>
                  </Table.Td>
                  <Table.Td className="ltr">{a.account_code}</Table.Td>
                  <Table.Td className="ltr">{a.currency_code}</Table.Td>
                  <Table.Td className="amount-cell" fw={600}>
                    <Amount value={a.balance} minor={minor} />
                  </Table.Td>
                  <Table.Td className="num">{a.reconciled_to ?? '—'}</Table.Td>
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    {canManage && (
                      <ActionIcon
                        variant="subtle"
                        aria-label={t('edit')}
                        onClick={() =>
                          setForm({ id: a.id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, kind: a.kind, account_id: a.account_id, currency_code: a.currency_code, bank_name: a.bank_name ?? '', account_number: a.account_number ?? '', iban: a.iban ?? '', is_active: a.is_active })
                        }
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? t('edit') : t('add')} size="lg">
        {form && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('code')} required value={form.code} onChange={(e) => setForm({ ...form, code: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
              <TextInput label={t('nameAr')} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.currentTarget.value })} dir="rtl" />
              <TextInput label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.currentTarget.value })} dir="ltr" />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Select label={t('type')} data={(['BANK', 'CASH'] as const).map((k) => ({ value: k, label: t(`kind${k}`) }))} value={form.kind} onChange={(v) => setForm({ ...form, kind: v === 'CASH' ? 'CASH' : 'BANK' })} allowDeselect={false} />
              <Select label={t('currency')} data={currencies.map((c) => c.code)} value={form.currency_code} onChange={(v) => setForm({ ...form, currency_code: v ?? form.currency_code })} searchable allowDeselect={false} />
              <AccountSelect label={t('ledgerAccount')} required value={form.account_id} onChange={(v) => setForm({ ...form, account_id: v })} />
            </SimpleGrid>
            {form.kind === 'BANK' && (
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <TextInput label={t('bankName')} value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.currentTarget.value })} />
                <TextInput label={t('accountNumber')} value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
                <TextInput label={t('iban')} value={form.iban} onChange={(e) => setForm({ ...form, iban: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
              </SimpleGrid>
            )}
            <Checkbox label={t('active')} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })} />
            <Group justify="flex-end">
              <Button onClick={save} loading={busy}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!transfer} onClose={() => setTransfer(null)} title={t('transferFunds')} size="lg">
        {transfer && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select label={t('transferFrom')} required data={options} value={transfer.from_account_id} onChange={(v) => setTransfer({ ...transfer, from_account_id: v })} />
              <Select label={t('transferTo')} required data={options.filter((o) => o.value !== transfer.from_account_id)} value={transfer.to_account_id} onChange={(v) => setTransfer({ ...transfer, to_account_id: v })} />
              <TextInput type="date" label={t('date')} value={transfer.transfer_date} onChange={(e) => setTransfer({ ...transfer, transfer_date: e.currentTarget.value })} />
              <TextInput label={`${t('amount')}${from ? ` (${from.currency_code})` : ''}`} value={transfer.amount} onChange={(e) => setTransfer({ ...transfer, amount: e.currentTarget.value })} classNames={{ input: 'num' }} inputMode="decimal" />
              {from && to && from.currency_code !== to.currency_code && (
                <TextInput label={`${t('amountReceived')} (${to.currency_code})`} value={transfer.to_amount} onChange={(e) => setTransfer({ ...transfer, to_amount: e.currentTarget.value })} classNames={{ input: 'num' }} inputMode="decimal" />
              )}
              <TextInput label={t('reference')} value={transfer.reference} onChange={(e) => setTransfer({ ...transfer, reference: e.currentTarget.value })} />
            </SimpleGrid>
            <TextInput label={t('description')} value={transfer.description} onChange={(e) => setTransfer({ ...transfer, description: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button onClick={submitTransfer} loading={busy} disabled={!transfer.from_account_id || !transfer.to_account_id || !(Number(transfer.amount) > 0)}>
                {t('transferFunds')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
};

export default BankAccountsPage;
