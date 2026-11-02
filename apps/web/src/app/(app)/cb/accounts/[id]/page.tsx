'use client';

import { Alert, Anchor, Badge, Button, Card, Checkbox, Group, Modal, Paper, SimpleGrid, Skeleton, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconCheck, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Amount, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { EmptyRow, EmptyState } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCompanyQuery } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Account = { id: string; code: string; name_ar: string; name_en: string; currency_code: string; balance: string; reconciled_to: string | null };
type Rec = { id: string; statement_date: string; statement_balance: string; status: 'DRAFT' | 'COMPLETED'; completed_at: string | null; completed_by_name: string | null; item_count: number };
type State = {
  id: string;
  statement_date: string;
  statement_balance: string;
  status: 'DRAFT' | 'COMPLETED';
  opening_cleared: string;
  selected_total: string;
  reconciled_balance: string;
  difference: string;
  lines: { id: string; entry_date: string; entry_no: string; entry_id: string; description: string | null; reference: string | null; amount: string; selected: boolean }[];
};

const BankAccountPage = () => {
  const { id } = useParams<{ id: string }>();
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const minor = company?.base_minor_units ?? 3;
  const canManage = can('cb.manage');
  const { data: accounts = [] } = useCompanyQuery<Account[]>(['cb-accounts'], '/cb/accounts');
  const account = accounts.find((a) => a.id === id);
  const recs = useQuery({ queryKey: [company?.id, 'cb-recs', id], queryFn: () => api<Rec[]>(`/cb/accounts/${id}/reconciliations`), enabled: !!company });
  const draft = recs.data?.find((r) => r.status === 'DRAFT');
  const [activeId, setActiveId] = useState<string | null>(null);
  const current = activeId ?? draft?.id ?? null;
  const state = useQuery({ queryKey: [company?.id, 'cb-rec', current], queryFn: () => api<State>(`/cb/reconciliations/${current}`), enabled: !!current });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [start, setStart] = useState<{ statement_date: string; statement_balance: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.data) setTicked(new Set(state.data.lines.filter((l) => l.selected).map((l) => l.id)));
  }, [state.data]);

  // Live totals while ticking, before saving.
  const live = useMemo(() => {
    if (!state.data) return null;
    const selected = state.data.lines.filter((l) => ticked.has(l.id)).reduce((acc, l) => acc + Number(l.amount), 0);
    const reconciled = Number(state.data.opening_cleared) + selected;
    return { selected, reconciled, difference: Number(state.data.statement_balance) - reconciled };
  }, [state.data, ticked]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === company?.id && String(q.queryKey[1]).startsWith('cb-') });
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

  const begin = () =>
    run(async () => {
      if (!start) return;
      const created = await api<{ id: string }>('/cb/reconciliations', { method: 'POST', body: { bank_account_id: id, ...start } });
      setStart(null);
      setActiveId(created.id);
      await refresh();
    });

  const saveItems = () => run(async () => {
    await api(`/cb/reconciliations/${current}/items`, { method: 'PUT', body: { line_ids: [...ticked] } });
    notifySuccess(t('saved'));
    await refresh();
  });

  const complete = () =>
    run(async () => {
      await api(`/cb/reconciliations/${current}/items`, { method: 'PUT', body: { line_ids: [...ticked] } });
      await api(`/cb/reconciliations/${current}/complete`, { method: 'POST' });
      notifySuccess(t('saved'));
      setActiveId(null);
      await refresh();
    });

  const discard = () =>
    run(async () => {
      if (!window.confirm(t('confirmDelete'))) return;
      await api(`/cb/reconciliations/${current}`, { method: 'DELETE' });
      setActiveId(null);
      await refresh();
    });

  if (!account) return <Skeleton height={300} radius="lg" />;
  const s = state.data;
  const editable = s?.status === 'DRAFT' && canManage;

  return (
    <Stack>
      <PageHeader
        title={`${account.code} — ${name(account)}`}
        subtitle={`${account.currency_code}`}
        actions={
          canManage &&
          !draft && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setStart({ statement_date: new Date().toISOString().slice(0, 10), statement_balance: '' })}>
              {t('newReconciliation')}
            </Button>
          )
        }
      />
      <SimpleGrid cols={{ base: 1, sm: 3 }} className="stagger">
        <Card padding="md">
          <Text size="sm" c="dimmed">{t('balance')}</Text>
          <Text fz={22} fw={700} className="num"><Amount value={account.balance} minor={minor} /></Text>
        </Card>
        <Card padding="md">
          <Text size="sm" c="dimmed">{t('reconciledTo')}</Text>
          <Text fz={22} fw={700} className="num">{account.reconciled_to ?? '—'}</Text>
        </Card>
        <Card padding="md">
          <Text size="sm" c="dimmed">{t('reconciliations')}</Text>
          <Text fz={22} fw={700} className="num">{recs.data?.filter((r) => r.status === 'COMPLETED').length ?? 0}</Text>
        </Card>
      </SimpleGrid>

      {s && live && (
        <Paper withBorder p="md" className="page-enter">
          <Group justify="space-between" mb="sm" wrap="wrap">
            <Title order={5}>
              {t('statementDate')}: <span className="num">{s.statement_date}</span>
            </Title>
            {editable && (
              <Group gap="xs">
                <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />} onClick={discard} loading={busy}>
                  {t('delete')}
                </Button>
                <Button variant="default" size="xs" onClick={saveItems} loading={busy}>
                  {t('save')}
                </Button>
                <Button size="xs" leftSection={<IconCheck size={14} />} onClick={complete} loading={busy} disabled={Math.abs(live.difference) > 1e-9}>
                  {t('completeReconciliation')}
                </Button>
              </Group>
            )}
          </Group>
          {editable && <Alert variant="light" mb="sm">{t('reconcileHint')}</Alert>}
          <SimpleGrid cols={{ base: 2, md: 5 }} mb="md">
            {[
              [t('statementBalance'), s.statement_balance],
              [t('clearedPreviously'), s.opening_cleared],
              [t('clearedNow'), live.selected.toFixed(minor)],
              [t('reconciledBalance'), live.reconciled.toFixed(minor)],
              [t('difference'), live.difference.toFixed(minor)],
            ].map(([label, value], i) => (
              <div key={label}>
                <Text size="xs" c="dimmed">{label}</Text>
                <Text fw={700} className="num" c={i === 4 ? (Math.abs(live.difference) < 1e-9 ? 'teal' : 'red') : undefined}>
                  <Amount value={value} minor={minor} />
                  {i === 4 && Math.abs(live.difference) < 1e-9 && ' ✓'}
                </Text>
              </div>
            ))}
          </SimpleGrid>
          <Table.ScrollContainer minWidth={700}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 40 }}>
                    {editable && (
                      <Checkbox
                        aria-label="all"
                        checked={s.lines.length > 0 && ticked.size === s.lines.length}
                        indeterminate={ticked.size > 0 && ticked.size < s.lines.length}
                        onChange={(e) => setTicked(e.currentTarget.checked ? new Set(s.lines.map((l) => l.id)) : new Set())}
                      />
                    )}
                  </Table.Th>
                  <Table.Th>{t('date')}</Table.Th>
                  <Table.Th>{t('entryNo')}</Table.Th>
                  <Table.Th>{t('description')}</Table.Th>
                  <Table.Th style={{ textAlign: 'end' }}>{t('debit')}</Table.Th>
                  <Table.Th style={{ textAlign: 'end' }}>{t('credit')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {s.lines.length === 0 && <EmptyRow cols={6} />}
                {s.lines.map((l) => {
                  const on = ticked.has(l.id);
                  const amount = Number(l.amount);
                  return (
                    <Table.Tr key={l.id} className={on ? 'selected' : undefined} style={{ cursor: editable ? 'pointer' : undefined }} onClick={() => editable && setTicked((prev) => { const next = new Set(prev); if (next.has(l.id)) next.delete(l.id); else next.add(l.id); return next; })}>
                      <Table.Td>
                        <Checkbox checked={on} readOnly disabled={!editable} aria-label={l.entry_no} />
                      </Table.Td>
                      <Table.Td className="num">{l.entry_date}</Table.Td>
                      <Table.Td onClick={(e) => e.stopPropagation()}>
                        <Anchor component={Link} href={`/gl/journals/${l.entry_id}`} size="sm" className="ltr">
                          {l.entry_no}
                        </Anchor>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" lineClamp={1}>{l.description}</Text>
                      </Table.Td>
                      <Table.Td className="amount-cell">{amount > 0 && <Amount value={l.amount} minor={minor} />}</Table.Td>
                      <Table.Td className="amount-cell">{amount < 0 && <Amount value={String(-amount)} minor={minor} />}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      <Paper withBorder p="md">
        <Title order={5} mb="sm">{t('reconciliations')}</Title>
        {recs.data?.length === 0 ? (
          <EmptyState />
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('statementDate')}</Table.Th>
                <Table.Th style={{ textAlign: 'end' }}>{t('statementBalance')}</Table.Th>
                <Table.Th>{t('entries')}</Table.Th>
                <Table.Th>{t('user')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recs.data?.map((r) => (
                <Table.Tr key={r.id} className="clickable" onClick={() => setActiveId(r.id)}>
                  <Table.Td className="num">{r.statement_date}</Table.Td>
                  <Table.Td className="amount-cell"><Amount value={r.statement_balance} minor={minor} /></Table.Td>
                  <Table.Td className="num">{r.item_count}</Table.Td>
                  <Table.Td>{r.completed_by_name}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={r.status === 'COMPLETED' ? 'teal' : 'yellow'}>
                      {r.status === 'COMPLETED' ? t('statusCOMPLETED') : t('statusDRAFT')}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      <Modal opened={!!start} onClose={() => setStart(null)} title={t('newReconciliation')}>
        {start && (
          <Stack>
            <TextInput type="date" label={t('statementDate')} value={start.statement_date} onChange={(e) => setStart({ ...start, statement_date: e.currentTarget.value })} />
            <TextInput label={`${t('statementBalance')} (${account.currency_code})`} value={start.statement_balance} onChange={(e) => setStart({ ...start, statement_balance: e.currentTarget.value })} classNames={{ input: 'num' }} inputMode="decimal" />
            <Group justify="flex-end">
              <Button onClick={begin} loading={busy} disabled={start.statement_balance === ''}>
                {t('newReconciliation')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};

export default BankAccountPage;
