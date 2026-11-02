'use client';

import { Alert, Anchor, Badge, Button, Card, Checkbox, FileButton, Group, Modal, Paper, SimpleGrid, Skeleton, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { IconCheck, IconFileImport, IconLink, IconPlus, IconTrash, IconWand, IconX } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AccountSelect, Amount, CostCenterSelect, PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { EmptyRow, EmptyState } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { api, upload } from '@/lib/api';
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
  statement_lines: StatementLine[];
};
type StatementLine = { id: string; line_no: number; line_date: string; description: string; reference: string | null; amount: string; matched_line_id: string | null };

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
  const [booking, setBooking] = useState<{ line: StatementLine; account_id: string | null; cost_center_id: string | null; description: string } | null>(null);

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

  /** Saves the current ticks first so importing or booking does not lose them. */
  const withItems = async () => {
    await api(`/cb/reconciliations/${current}/items`, { method: 'PUT', body: { line_ids: [...ticked] } });
  };

  const importStatement = (file: File | null) =>
    run(async () => {
      if (!file) return;
      await withItems();
      const result = await upload<State>(`/cb/reconciliations/${current}/statement`, file);
      const matched = result.statement_lines.filter((l) => l.matched_line_id).length;
      notifySuccess(`${t('statementImported')}: ${result.statement_lines.length} · ${t('matched')}: ${matched}`);
      await refresh();
    });

  const clearStatement = () =>
    run(async () => {
      if (!window.confirm(t('confirmDelete'))) return;
      await api(`/cb/reconciliations/${current}/statement`, { method: 'DELETE' });
      await refresh();
    });

  const rematch = () =>
    run(async () => {
      await withItems();
      await api(`/cb/reconciliations/${current}/match`, { method: 'POST' });
      await refresh();
    });

  const book = () =>
    run(async () => {
      if (!booking) return;
      await withItems();
      await api(`/cb/reconciliations/${current}/statement/${booking.line.id}/post`, {
        method: 'POST',
        body: { account_id: booking.account_id, cost_center_id: booking.cost_center_id, description: booking.description || null },
      });
      notifySuccess(t('saved'));
      setBooking(null);
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
  const matchedLedger = new Set((s?.statement_lines ?? []).map((l) => l.matched_line_id).filter(Boolean));
  const unmatched = (s?.statement_lines ?? []).filter((l) => !l.matched_line_id).length;

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
                <FileButton onChange={importStatement} accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
                  {(props) => (
                    <Button {...props} variant="light" size="xs" leftSection={<IconFileImport size={14} />} loading={busy}>
                      {t('importStatement')}
                    </Button>
                  )}
                </FileButton>
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
                        <Group gap={6} wrap="nowrap">
                          {matchedLedger.has(l.id) && (
                            <Tooltip label={t('matchedToStatement')}>
                              <IconLink size={14} color="var(--mantine-color-teal-6)" />
                            </Tooltip>
                          )}
                          <Text size="sm" lineClamp={1}>{l.description}</Text>
                        </Group>
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

      {s && s.statement_lines.length > 0 && (
        <Paper withBorder p="md" className="page-enter">
          <Group justify="space-between" mb="sm" wrap="wrap">
            <Title order={5}>
              {t('bankStatement')}{' '}
              <Badge variant="light" color={unmatched ? 'yellow' : 'teal'} ml="xs">
                {unmatched ? `${unmatched} ${t('unmatched')}` : t('allMatched')}
              </Badge>
            </Title>
            {editable && (
              <Group gap="xs">
                <Button variant="default" size="xs" leftSection={<IconWand size={14} />} onClick={rematch} loading={busy} disabled={!unmatched}>
                  {t('autoMatch')}
                </Button>
                <Button variant="subtle" color="red" size="xs" leftSection={<IconX size={14} />} onClick={clearStatement} loading={busy}>
                  {t('clearStatement')}
                </Button>
              </Group>
            )}
          </Group>
          <Table.ScrollContainer minWidth={700}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('date')}</Table.Th>
                  <Table.Th>{t('description')}</Table.Th>
                  <Table.Th>{t('reference')}</Table.Th>
                  <Table.Th style={{ textAlign: 'end' }}>{t('moneyIn')}</Table.Th>
                  <Table.Th style={{ textAlign: 'end' }}>{t('moneyOut')}</Table.Th>
                  <Table.Th style={{ width: 150 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {s.statement_lines.map((l) => {
                  const amount = Number(l.amount);
                  return (
                    <Table.Tr key={l.id}>
                      <Table.Td className="num">{l.line_date}</Table.Td>
                      <Table.Td>
                        <Text size="sm" lineClamp={1}>{l.description}</Text>
                      </Table.Td>
                      <Table.Td className="ltr">{l.reference}</Table.Td>
                      <Table.Td className="amount-cell">{amount > 0 && <Amount value={l.amount} minor={minor} />}</Table.Td>
                      <Table.Td className="amount-cell">{amount < 0 && <Amount value={String(-amount)} minor={minor} />}</Table.Td>
                      <Table.Td>
                        {l.matched_line_id ? (
                          <Badge variant="light" color="teal" leftSection={<IconCheck size={12} />}>
                            {t('matched')}
                          </Badge>
                        ) : (
                          editable && (
                            <Button size="compact-xs" variant="light" onClick={() => setBooking({ line: l, account_id: null, cost_center_id: null, description: l.description })}>
                              {t('bookLine')}
                            </Button>
                          )
                        )}
                      </Table.Td>
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

      <Modal opened={!!booking} onClose={() => setBooking(null)} title={t('bookLine')}>
        {booking && (
          <Stack>
            <Text size="sm" className="num">
              {booking.line.line_date} · <Amount value={booking.line.amount} minor={minor} /> {account.currency_code}
            </Text>
            <Alert variant="light">{t('bookLineHint')}</Alert>
            <AccountSelect label={t('account')} value={booking.account_id} onChange={(v) => setBooking({ ...booking, account_id: v })} />
            <CostCenterSelect label={t('costCenter')} value={booking.cost_center_id} onChange={(v) => setBooking({ ...booking, cost_center_id: v })} />
            <TextInput label={t('description')} value={booking.description} onChange={(e) => setBooking({ ...booking, description: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button onClick={book} loading={busy} disabled={!booking.account_id}>
                {t('postDocument')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

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
