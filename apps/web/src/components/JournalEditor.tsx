'use client';

import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  FileButton,
  Group,
  Indicator,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { convertToBase, Money, type MoneyValue, toMoney, translateError } from '@erp/shared';
import { IconAdjustmentsHorizontal, IconArrowBackUp, IconCheck, IconDownload, IconPaperclip, IconPlus, IconSend, IconTrash, IconX } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/i18n';
import { auditActionLabel } from '@/i18n/messages';
import { api, download, upload } from '@/lib/api';
import { useAccounts, useCostCenters, useCurrencies, useDimensions, useJournalTypes, useTemplates } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { JournalEntry, JournalLine } from '@/lib/types';
import { AccountSelect, Amount, CostCenterSelect, PageHeader, StatusBadge } from './common';
import { notifyError, notifySuccess } from './notify';

type SplitRow = { cost_center_id: string | null; value: string };
type EditLine = {
  key: string;
  account_id: string | null;
  cost_center_id: string | null;
  description: string;
  currency_code: string;
  exchange_rate: string;
  debit: string;
  credit: string;
  distribution_template_id: string | null;
  split_mode: 'percent' | 'amount';
  split: SplitRow[];
  dimensions: Record<string, string>;
};
type Header = { journal_type_id: string | null; entry_date: string; adjustment_period: boolean; description: string; reference: string; auto_reverse_date: string };

let keySeq = 0;
const nextKey = () => `l${++keySeq}`;

const blankLine = (currency: string): EditLine => ({
  key: nextKey(),
  account_id: null,
  cost_center_id: null,
  description: '',
  currency_code: currency,
  exchange_rate: '',
  debit: '',
  credit: '',
  distribution_template_id: null,
  split_mode: 'percent',
  split: [],
  dimensions: {},
});

const fromServerLine = (l: JournalLine, base: string): EditLine => {
  const split = l.distribution ?? [];
  const byAmount = split.length > 0 && split.every((s) => s.amount !== undefined);
  return {
    key: nextKey(),
    account_id: l.account_id,
    cost_center_id: l.cost_center_id,
    description: l.description ?? '',
    currency_code: l.currency_code,
    exchange_rate: l.currency_code === base ? '' : toMoney(l.exchange_rate).toString(),
    debit: toMoney(l.debit).isZero() ? '' : toMoney(l.debit).toString(),
    credit: toMoney(l.credit).isZero() ? '' : toMoney(l.credit).toString(),
    distribution_template_id: l.distribution_template_id,
    split_mode: byAmount ? 'amount' : 'percent',
    split: split.map((s) => ({ cost_center_id: s.cost_center_id, value: (byAmount ? s.amount : s.percent) ?? '' })),
    dimensions: Object.fromEntries(l.dimensions.map((d) => [d.dimension_type_id, d.dimension_value_id])),
  };
};

const isNumber = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());
const safe = (v: string): MoneyValue => (isNumber(v) ? toMoney(v.trim()) : new Money(0));

export const JournalEditor = ({ id }: { id?: string }) => {
  const { t, name, errorText, locale, amount, digits } = useI18n();
  const { company, can } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const base = company?.base_currency ?? 'KWD';
  const minor = company?.base_minor_units ?? 3;

  const { data: types = [] } = useJournalTypes();
  const { data: accounts = [] } = useAccounts();
  const { data: currencies = [] } = useCurrencies();
  const { data: dimensions = [] } = useDimensions();
  const { data: templates = [] } = useTemplates();
  useCostCenters();

  const entryQuery = useQuery({
    queryKey: [company?.id, 'journal', id],
    queryFn: () => api<JournalEntry>(`/gl/journals/${id}`),
    enabled: !!id && !!company,
  });
  const historyQuery = useQuery({
    queryKey: [company?.id, 'journal-audit', id],
    queryFn: () => api<{ id: number; occurred_at: string; action: string; user_name: string | null }[]>(`/gl/journals/${id}/audit`),
    enabled: !!id && !!company,
  });
  const entry = entryQuery.data;

  const [header, setHeader] = useState<Header>({ journal_type_id: null, entry_date: new Date().toISOString().slice(0, 10), adjustment_period: false, description: '', reference: '', auto_reverse_date: '' });
  const [lines, setLines] = useState<EditLine[]>(() => [blankLine(base), blankLine(base)]);
  const [busy, setBusy] = useState(false);
  const [lineDetails, setLineDetails] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reversing, setReversing] = useState<{ date: string; description: string } | null>(null);
  const [recurring, setRecurring] = useState<{ code: string; name: string; frequency: string; day_of_month: number; start_date: string; end_date: string; auto_post: boolean } | null>(null);

  const printVoucher = () =>
    download(`/gl/reports/voucher/${id}`, { format: 'pdf', lang: locale, digits }, 'voucher.pdf').catch((e: unknown) => notifyError(errorText(e)));

  const makeRecurring = () =>
    run(async () => {
      if (!recurring) return;
      try {
        await api('/gl/recurring', {
          method: 'POST',
          body: {
            code: recurring.code,
            name_ar: locale === 'ar' ? recurring.name : '',
            name_en: locale === 'en' ? recurring.name : '',
            frequency: recurring.frequency,
            day_of_month: recurring.day_of_month,
            start_date: recurring.start_date,
            end_date: recurring.end_date || null,
            auto_post: recurring.auto_post,
            from_entry_id: id,
          },
        });
        notifySuccess(t('saved'));
        setRecurring(null);
      } catch (error) {
        notifyError(errorText(error));
      }
    });

  const editable = can('gl.journal.create') && (!id || entry?.status === 'DRAFT');

  useEffect(() => {
    if (!entry) return;
    setHeader({
      journal_type_id: entry.journal_type_id,
      entry_date: entry.entry_date,
      adjustment_period: entry.period_code.endsWith('-13'),
      description: entry.description ?? '',
      reference: entry.reference ?? '',
      auto_reverse_date: entry.auto_reverse_date ?? '',
    });
    setLines(entry.lines.map((l) => fromServerLine(l, base)));
  }, [entry, base]);

  useEffect(() => {
    if (!id && !header.journal_type_id) {
      const jv = types.find((jt) => jt.code === 'JV') ?? types.find((jt) => !jt.is_system);
      if (jv) setHeader((h) => ({ ...h, journal_type_id: jv.id }));
    }
  }, [types, id, header.journal_type_id]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const updateLine = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const onAccountChange = (line: EditLine, accountId: string | null) => {
    const account = accountId ? accountById.get(accountId) : undefined;
    const patch: Partial<EditLine> = { account_id: accountId };
    if (account?.cost_center_rule === 'NOT_ALLOWED') patch.cost_center_id = null;
    else if (account?.default_cost_center_id && !line.cost_center_id) patch.cost_center_id = account.default_cost_center_id;
    if (account?.allowed_currencies?.length === 1 && account.allowed_currencies[0]) patch.currency_code = account.allowed_currencies[0];
    updateLine(line.key, patch);
  };

  const totals = useMemo(() => {
    let debit = new Money(0);
    let credit = new Money(0);
    let exact = true;
    for (const l of lines) {
      const rate = l.currency_code === base ? '1' : l.exchange_rate;
      if (!isNumber(rate)) {
        if (isNumber(l.debit) || isNumber(l.credit)) exact = false;
        continue;
      }
      debit = debit.plus(convertToBase(safe(l.debit), rate, minor));
      credit = credit.plus(convertToBase(safe(l.credit), rate, minor));
    }
    return { debit, credit, exact, diff: debit.minus(credit) };
  }, [lines, base, minor]);

  const buildBody = () => ({
    journal_type_id: header.journal_type_id,
    entry_date: header.entry_date,
    adjustment_period: header.adjustment_period,
    auto_reverse_date: header.auto_reverse_date || null,
    description: header.description || null,
    reference: header.reference || null,
    version: entry?.version,
    lines: lines
      .filter((l) => l.account_id || isNumber(l.debit) || isNumber(l.credit))
      .map((l) => ({
        account_id: l.account_id,
        cost_center_id: l.split.length || l.distribution_template_id ? null : l.cost_center_id,
        description: l.description || null,
        currency_code: l.currency_code,
        exchange_rate: l.currency_code !== base && isNumber(l.exchange_rate) ? l.exchange_rate : null,
        debit: isNumber(l.debit) ? l.debit.trim() : '0',
        credit: isNumber(l.credit) ? l.credit.trim() : '0',
        distribution_template_id: l.distribution_template_id,
        distribution: l.split.length
          ? l.split.map((s) => ({ cost_center_id: s.cost_center_id, ...(l.split_mode === 'amount' ? { amount: s.value } : { percent: s.value }) }))
          : null,
        dimensions: Object.entries(l.dimensions)
          .filter(([, v]) => !!v)
          .map(([dimension_type_id, dimension_value_id]) => ({ dimension_type_id, dimension_value_id })),
      })),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === company?.id && String(q.queryKey[1]).startsWith('journal') });
  };

  /** Saves the draft (when editable) and returns the entry id. */
  const save = async (): Promise<string | null> => {
    try {
      const saved = await api<JournalEntry>(id ? `/gl/journals/${id}` : '/gl/journals', { method: id ? 'PUT' : 'POST', body: buildBody() });
      return saved.id;
    } catch (error) {
      notifyError(errorText(error));
      return null;
    }
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () =>
    run(async () => {
      const savedId = await save();
      if (!savedId) return;
      notifySuccess(t('saved'));
      await invalidate();
      if (!id) router.replace(`/gl/journals/${savedId}`);
    });

  const transition = (action: 'submit' | 'approve' | 'post', confirmText?: string) =>
    run(async () => {
      if (confirmText && !window.confirm(confirmText)) return;
      const targetId = editable ? await save() : (id ?? null);
      if (!targetId) return;
      try {
        const result = await api<{ warnings?: { code: 'BUDGET_EXCEEDED'; params: Record<string, string> }[] }>(`/gl/journals/${targetId}/${action}`, { method: 'POST' });
        notifySuccess(t('saved'));
        for (const w of result.warnings ?? []) notifyError(translateError(w.code, locale, w.params));
      } catch (error) {
        notifyError(errorText(error));
      }
      await invalidate();
      if (!id) router.replace(`/gl/journals/${targetId}`);
    });

  const reject = () =>
    run(async () => {
      try {
        await api(`/gl/journals/${id}/reject`, { method: 'POST', body: { reason: rejecting } });
        setRejecting(null);
        await invalidate();
      } catch (error) {
        notifyError(errorText(error));
      }
    });

  const reverse = () =>
    run(async () => {
      if (!reversing) return;
      try {
        const rev = await api<JournalEntry>(`/gl/journals/${id}/reverse`, {
          method: 'POST',
          body: { reversal_date: reversing.date || undefined, description: reversing.description || undefined },
        });
        setReversing(null);
        await invalidate();
        router.push(`/gl/journals/${rev.id}`);
      } catch (error) {
        notifyError(errorText(error));
      }
    });

  const remove = () =>
    run(async () => {
      if (!window.confirm(t('confirmDelete'))) return;
      try {
        await api(`/gl/journals/${id}`, { method: 'DELETE' });
        await invalidate();
        router.replace('/gl/journals');
      } catch (error) {
        notifyError(errorText(error));
      }
    });

  const attach = (file: File | null) =>
    file &&
    run(async () => {
      try {
        await upload(`/gl/journals/${id}/attachments`, file);
        await invalidate();
      } catch (error) {
        notifyError(errorText(error));
      }
    });

  const removeAttachment = (attachmentId: string) =>
    run(async () => {
      try {
        await api(`/gl/attachments/${attachmentId}`, { method: 'DELETE' });
        await invalidate();
      } catch (error) {
        notifyError(errorText(error));
      }
    });

  if (id && entryQuery.isLoading) return <Text>{t('loading')}</Text>;
  if (id && entryQuery.error) return <Alert color="red">{errorText(entryQuery.error)}</Alert>;

  const status = entry?.status ?? 'DRAFT';
  const requireApproval = company?.require_approval ?? false;
  const isGl = (entry?.source_module ?? 'GL') === 'GL';
  const manualTypes = types.filter((jt) => !jt.is_system && jt.is_active);
  const currencyOptions = currencies.map((c) => c.code);
  const detailsLine = lines.find((l) => l.key === lineDetails);

  return (
    <Stack>
      <PageHeader
        title={entry?.entry_no ? `${t('journalEntry')} ${entry.entry_no}` : id ? t('journalEntry') : t('newEntry')}
        subtitle={entry && <StatusBadge status={entry.status} />}
        actions={
          <>
            {editable && (
              <Button variant="default" onClick={saveDraft} loading={busy}>
                {t('saveDraft')}
              </Button>
            )}
            {editable && id && (
              <Button variant="subtle" color="red" onClick={remove} disabled={busy} leftSection={<IconTrash size={16} />}>
                {t('delete')}
              </Button>
            )}
            {editable && requireApproval && (
              <Button onClick={() => transition('submit')} loading={busy} leftSection={<IconSend size={16} />}>
                {t('submit')}
              </Button>
            )}
            {isGl && status === 'SUBMITTED' && can('gl.journal.approve') && (
              <>
                <Button color="teal" onClick={() => transition('approve')} loading={busy} leftSection={<IconCheck size={16} />}>
                  {t('approve')}
                </Button>
                <Button color="orange" variant="light" onClick={() => setRejecting('')} disabled={busy} leftSection={<IconX size={16} />}>
                  {t('reject')}
                </Button>
              </>
            )}
            {isGl && status === 'APPROVED' && can('gl.journal.approve') && (
              <Button color="orange" variant="light" onClick={() => setRejecting('')} disabled={busy}>
                {t('reject')}
              </Button>
            )}
            {can('gl.journal.post') && (status === 'APPROVED' || (!requireApproval && (status === 'SUBMITTED' || editable))) && (
              <Button color="indigo" onClick={() => transition('post', t('confirmPost'))} loading={busy}>
                {t('post')}
              </Button>
            )}
            {id && entry && (
              <Button variant="default" onClick={printVoucher}>
                {t('printVoucher')}
              </Button>
            )}
            {id && entry && entry.source_module === 'GL' && can('gl.journal.create') && (
              <Button
                variant="default"
                onClick={() =>
                  setRecurring({
                    code: '',
                    name: entry.description ?? '',
                    frequency: 'MONTHLY',
                    day_of_month: Number(entry.entry_date.slice(8, 10)),
                    start_date: entry.entry_date,
                    end_date: '',
                    auto_post: true,
                  })
                }
              >
                {t('makeRecurring')}
              </Button>
            )}
            {status === 'POSTED' && can('gl.journal.reverse') && (
              <Button color="red" variant="light" onClick={() => setReversing({ date: entry?.entry_date ?? '', description: '' })} leftSection={<IconArrowBackUp size={16} />}>
                {t('reverse')}
              </Button>
            )}
          </>
        }
      />

      {entry?.rejection_reason && status === 'DRAFT' && (
        <Alert color="orange" title={t('rejectedBecause')}>
          {entry.rejection_reason}
        </Alert>
      )}
      {entry && (entry.reversed_by_id || entry.reversal_of_id) && (
        <Alert color="red" variant="light">
          {entry.reversed_by_id && (
            <Text size="sm">
              {t('reversedBy')}:{' '}
              <Anchor component={Link} href={`/gl/journals/${entry.reversed_by_id}`} className="ltr">
                {entry.reversed_by_no}
              </Anchor>
            </Text>
          )}
          {entry.reversal_of_id && (
            <Text size="sm">
              {t('reversalOf')}:{' '}
              <Anchor component={Link} href={`/gl/journals/${entry.reversal_of_id}`} className="ltr">
                {entry.reversal_of_no}
              </Anchor>
            </Text>
          )}
        </Alert>
      )}

      <Paper withBorder p="md">
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
          <Select
            label={t('journalType')}
            data={(editable ? manualTypes : types).map((jt) => ({ value: jt.id, label: `${jt.code} — ${name(jt)}` }))}
            value={header.journal_type_id}
            onChange={(v) => setHeader({ ...header, journal_type_id: v })}
            disabled={!editable}
            allowDeselect={false}
          />
          <TextInput type="date" label={t('entryDate')} value={header.entry_date} onChange={(e) => setHeader({ ...header, entry_date: e.currentTarget.value })} disabled={!editable} />
          <TextInput label={t('reference')} value={header.reference} onChange={(e) => setHeader({ ...header, reference: e.currentTarget.value })} disabled={!editable} />
          {entry && (
            <Stack gap={0}>
              <Text size="sm" fw={500}>
                {t('period')}
              </Text>
              <Text className="ltr">{entry.period_code}</Text>
            </Stack>
          )}
        </SimpleGrid>
        <Textarea mt="sm" label={t('description')} autosize minRows={1} value={header.description} onChange={(e) => setHeader({ ...header, description: e.currentTarget.value })} disabled={!editable} />
        <Group mt="sm" align="flex-end">
          <TextInput
            type="date"
            label={t('autoReverseDate')}
            value={header.auto_reverse_date}
            onChange={(e) => setHeader({ ...header, auto_reverse_date: e.currentTarget.value })}
            disabled={!editable}
          />
          {editable && <Checkbox mb={8} label={t('adjustmentPeriod')} checked={header.adjustment_period} onChange={(e) => setHeader({ ...header, adjustment_period: e.currentTarget.checked })} />}
        </Group>
        {entry && (
          <Group mt="sm" gap="lg">
            {entry.created_by_name && (
              <Text size="xs" c="dimmed">
                {t('createdBy')}: {entry.created_by_name}
              </Text>
            )}
            {entry.approved_by_name && (
              <Text size="xs" c="dimmed">
                {t('approvedBy')}: {entry.approved_by_name}
              </Text>
            )}
            {entry.posted_by_name && (
              <Text size="xs" c="dimmed">
                {t('postedBy')}: {entry.posted_by_name}
              </Text>
            )}
            {entry.source_module !== 'GL' && (
              <Badge variant="outline" size="sm">
                {t('sourceModule')}: {entry.source_module}
              </Badge>
            )}
          </Group>
        )}
      </Paper>

      <Paper withBorder p="md">
        <Title order={5} mb="sm">
          {t('lines')}
        </Title>
        {editable ? (
          <Table.ScrollContainer minWidth={1100}>
            <Table verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={36}>#</Table.Th>
                  <Table.Th miw={240}>{t('account')}</Table.Th>
                  <Table.Th miw={190}>{t('costCenter')}</Table.Th>
                  <Table.Th miw={160}>{t('description')}</Table.Th>
                  <Table.Th w={96}>{t('currency')}</Table.Th>
                  <Table.Th w={110}>{t('rate')}</Table.Th>
                  <Table.Th w={130}>{t('debit')}</Table.Th>
                  <Table.Th w={130}>{t('credit')}</Table.Th>
                  <Table.Th w={72} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lines.map((l, index) => {
                  const account = l.account_id ? accountById.get(l.account_id) : undefined;
                  const hasSplit = l.split.length > 0 || !!l.distribution_template_id;
                  const extras = (hasSplit ? 1 : 0) + Object.values(l.dimensions).filter(Boolean).length;
                  return (
                    <Table.Tr key={l.key}>
                      <Table.Td className="num">{index + 1}</Table.Td>
                      <Table.Td>
                        <AccountSelect size="xs" value={l.account_id} onChange={(v) => onAccountChange(l, v)} />
                      </Table.Td>
                      <Table.Td>
                        {hasSplit ? (
                          <Badge variant="light" onClick={() => setLineDetails(l.key)} style={{ cursor: 'pointer' }}>
                            {t('distribution')}
                          </Badge>
                        ) : (
                          <CostCenterSelect
                            size="xs"
                            value={l.cost_center_id}
                            onChange={(v) => updateLine(l.key, { cost_center_id: v })}
                            disabled={account?.cost_center_rule === 'NOT_ALLOWED'}
                            error={account?.cost_center_rule === 'REQUIRED' && !l.cost_center_id ? ' ' : undefined}
                          />
                        )}
                      </Table.Td>
                      <Table.Td>
                        <TextInput size="xs" value={l.description} onChange={(e) => updateLine(l.key, { description: e.currentTarget.value })} />
                      </Table.Td>
                      <Table.Td>
                        <Select size="xs" searchable data={currencyOptions} value={l.currency_code} onChange={(v) => updateLine(l.key, { currency_code: v ?? base, exchange_rate: '' })} allowDeselect={false} />
                      </Table.Td>
                      <Table.Td>
                        {l.currency_code !== base && (
                          <TextInput size="xs" placeholder="auto" classNames={{ input: 'ltr' }} value={l.exchange_rate} onChange={(e) => updateLine(l.key, { exchange_rate: e.currentTarget.value })} />
                        )}
                      </Table.Td>
                      <Table.Td>
                        <TextInput
                          size="xs"
                          inputMode="decimal"
                          classNames={{ input: 'ltr' }}
                          value={l.debit}
                          onChange={(e) => updateLine(l.key, { debit: e.currentTarget.value, ...(e.currentTarget.value ? { credit: '' } : {}) })}
                          error={l.debit && !isNumber(l.debit) ? ' ' : undefined}
                        />
                      </Table.Td>
                      <Table.Td>
                        <TextInput
                          size="xs"
                          inputMode="decimal"
                          classNames={{ input: 'ltr' }}
                          value={l.credit}
                          onChange={(e) => updateLine(l.key, { credit: e.currentTarget.value, ...(e.currentTarget.value ? { debit: '' } : {}) })}
                          error={l.credit && !isNumber(l.credit) ? ' ' : undefined}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Group gap={2} wrap="nowrap">
                          <Tooltip label={`${t('distribution')} / ${t('navDimensions')}`}>
                            <Indicator disabled={extras === 0} label={extras} size={14}>
                              <ActionIcon variant="subtle" onClick={() => setLineDetails(l.key)} aria-label={t('distribution')}>
                                <IconAdjustmentsHorizontal size={16} />
                              </ActionIcon>
                            </Indicator>
                          </Tooltip>
                          <ActionIcon variant="subtle" color="red" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t('removeLine')} disabled={lines.length <= 2}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Table.ScrollContainer minWidth={900}>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>{t('account')}</Table.Th>
                  <Table.Th>{t('costCenter')}</Table.Th>
                  <Table.Th>{t('description')}</Table.Th>
                  <Table.Th>{t('currency')}</Table.Th>
                  <Table.Th className="amount-cell">{t('amount')}</Table.Th>
                  <Table.Th className="amount-cell">{t('debit')}</Table.Th>
                  <Table.Th className="amount-cell">{t('credit')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {entry?.lines.map((l, index) => {
                  const foreign = l.currency_code !== base;
                  return (
                    <Table.Tr key={l.id}>
                      <Table.Td className="num">{index + 1}</Table.Td>
                      <Table.Td>
                        <span className="ltr">{l.account_code}</span> — {locale === 'ar' ? l.account_name_ar : l.account_name_en}
                        {l.is_rounding && (
                          <Badge size="xs" ms={6} variant="outline">
                            {t('rounding')}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td className="ltr">{l.cost_center_code ?? ''}</Table.Td>
                      <Table.Td>{l.description}</Table.Td>
                      <Table.Td>{l.currency_code}</Table.Td>
                      <Table.Td className="amount-cell">
                        {foreign && (
                          <Tooltip label={`${t('rate')}: ${toMoney(l.exchange_rate).toString()}`}>
                            <span className="num">{amount(toMoney(l.debit).plus(l.credit), currencies.find((c) => c.code === l.currency_code)?.minor_units ?? 2)}</span>
                          </Tooltip>
                        )}
                      </Table.Td>
                      <Table.Td className="amount-cell">
                        <Amount value={l.debit_base} minor={minor} />
                      </Table.Td>
                      <Table.Td className="amount-cell">
                        <Amount value={l.credit_base} minor={minor} />
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        <Group justify="space-between" mt="sm">
          {editable ? (
            <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setLines((ls) => [...ls, blankLine(base)])}>
              {t('addLine')}
            </Button>
          ) : (
            <span />
          )}
          <Group gap="lg">
            <Text size="sm">
              {t('debit')}: <Amount value={editable ? totals.debit.toString() : entry?.total_debit} minor={minor} />
            </Text>
            <Text size="sm">
              {t('credit')}: <Amount value={editable ? totals.credit.toString() : entry?.total_credit} minor={minor} />
            </Text>
            {editable && totals.exact && (
              <Badge color={totals.diff.isZero() ? 'teal' : 'red'} variant="light">
                {totals.diff.isZero() ? t('balanced') : `${t('difference')}: ${amount(totals.diff.toString(), minor)}`}
              </Badge>
            )}
            <Text size="xs" c="dimmed">
              {base}
            </Text>
          </Group>
        </Group>
      </Paper>

      {id && entry && (
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Paper withBorder p="md">
            <Group justify="space-between" mb="sm">
              <Title order={5}>{t('attachments')}</Title>
              {can('gl.journal.create') && (
                <FileButton onChange={attach} accept="application/pdf,image/png,image/jpeg,image/webp,.xlsx,.xls,.docx,.csv">
                  {(props) => (
                    <Button size="xs" variant="light" leftSection={<IconPaperclip size={14} />} {...props}>
                      {t('upload')}
                    </Button>
                  )}
                </FileButton>
              )}
            </Group>
            {entry.attachments.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
            {entry.attachments.map((a) => (
              <Group key={a.id} justify="space-between">
                <Text size="sm">{a.file_name}</Text>
                <Group gap={4}>
                  <ActionIcon variant="subtle" aria-label="download" onClick={() => download(`/gl/attachments/${a.id}`, undefined, a.file_name).catch((e: unknown) => notifyError(errorText(e)))}>
                    <IconDownload size={16} />
                  </ActionIcon>
                  {entry.status === 'DRAFT' && (
                    <ActionIcon variant="subtle" color="red" aria-label={t('delete')} onClick={() => removeAttachment(a.id)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Group>
              </Group>
            ))}
          </Paper>
          <Paper withBorder p="md">
            <Title order={5} mb="sm">
              {t('history')}
            </Title>
            {(historyQuery.data ?? []).map((h) => (
              <Group key={h.id} justify="space-between">
                <Text size="sm">{auditActionLabel(h.action, locale)}</Text>
                <Text size="xs" c="dimmed">
                  {h.user_name} · <span className="num">{new Date(h.occurred_at).toLocaleString(locale === 'ar' ? 'ar-KW' : 'en-GB')}</span>
                </Text>
              </Group>
            ))}
          </Paper>
        </SimpleGrid>
      )}

      <Modal opened={!!detailsLine} onClose={() => setLineDetails(null)} title={`${t('distribution')} / ${t('navDimensions')}`} size="lg">
        {detailsLine && (
          <Stack>
            <SegmentedControl
              value={detailsLine.distribution_template_id ? 'template' : detailsLine.split.length ? 'manual' : 'none'}
              onChange={(mode) =>
                updateLine(detailsLine.key, {
                  distribution_template_id: mode === 'template' ? (templates[0]?.id ?? null) : null,
                  split: mode === 'manual' ? [{ cost_center_id: null, value: '' }, { cost_center_id: null, value: '' }] : [],
                })
              }
              data={[
                { value: 'none', label: t('costCenter') },
                { value: 'template', label: t('distributionTemplate') },
                { value: 'manual', label: t('manualSplit') },
              ]}
            />
            {detailsLine.distribution_template_id && (
              <Select
                label={t('distributionTemplate')}
                data={templates.filter((x) => x.is_active).map((x) => ({ value: x.id, label: `${x.code} — ${name(x)}` }))}
                value={detailsLine.distribution_template_id}
                onChange={(v) => updateLine(detailsLine.key, { distribution_template_id: v })}
                allowDeselect={false}
              />
            )}
            {detailsLine.split.length > 0 && (
              <Stack gap="xs">
                <SegmentedControl
                  size="xs"
                  value={detailsLine.split_mode}
                  onChange={(v) => updateLine(detailsLine.key, { split_mode: v === 'amount' ? 'amount' : 'percent' })}
                  data={[
                    { value: 'percent', label: t('percent') },
                    { value: 'amount', label: t('amount') },
                  ]}
                />
                {detailsLine.split.map((s, i) => (
                  <Group key={i} wrap="nowrap">
                    <CostCenterSelect
                      style={{ flex: 1 }}
                      value={s.cost_center_id}
                      onChange={(v) => updateLine(detailsLine.key, { split: detailsLine.split.map((x, j) => (j === i ? { ...x, cost_center_id: v } : x)) })}
                    />
                    <TextInput
                      w={130}
                      classNames={{ input: 'ltr' }}
                      rightSection={detailsLine.split_mode === 'percent' ? '%' : undefined}
                      value={s.value}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        updateLine(detailsLine.key, { split: detailsLine.split.map((x, j) => (j === i ? { ...x, value } : x)) });
                      }}
                    />
                    <ActionIcon variant="subtle" color="red" aria-label={t('removeLine')} onClick={() => updateLine(detailsLine.key, { split: detailsLine.split.filter((_, j) => j !== i) })}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                ))}
                <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => updateLine(detailsLine.key, { split: [...detailsLine.split, { cost_center_id: null, value: '' }] })}>
                  {t('addLine')}
                </Button>
              </Stack>
            )}
            {dimensions.filter((d) => d.is_active).map((d) => (
              <Select
                key={d.id}
                label={name(d)}
                clearable
                data={d.values.filter((v) => v.is_active).map((v) => ({ value: v.id, label: `${v.code} — ${name(v)}` }))}
                value={detailsLine.dimensions[d.id] ?? null}
                onChange={(v) => updateLine(detailsLine.key, { dimensions: { ...detailsLine.dimensions, [d.id]: v ?? '' } })}
              />
            ))}
            <Group justify="flex-end">
              <Button onClick={() => setLineDetails(null)}>{t('save')}</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!recurring} onClose={() => setRecurring(null)} title={t('makeRecurring')}>
        {recurring && (
          <Stack>
            <SimpleGrid cols={2}>
              <TextInput label={t('code')} required value={recurring.code} onChange={(e) => setRecurring({ ...recurring, code: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
              <TextInput label={t('name')} required value={recurring.name} onChange={(e) => setRecurring({ ...recurring, name: e.currentTarget.value })} />
              <Select
                label={t('frequency')}
                data={(['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'] as const).map((f) => ({ value: f, label: t(`freq${f}`) }))}
                value={recurring.frequency}
                onChange={(v) => setRecurring({ ...recurring, frequency: v ?? 'MONTHLY' })}
                allowDeselect={false}
              />
              <TextInput type="number" min={1} max={31} label={t('dayOfMonth')} value={recurring.day_of_month} onChange={(e) => setRecurring({ ...recurring, day_of_month: Number(e.currentTarget.value) })} />
              <TextInput type="date" label={t('startDate')} value={recurring.start_date} onChange={(e) => setRecurring({ ...recurring, start_date: e.currentTarget.value })} />
              <TextInput type="date" label={t('endDate')} value={recurring.end_date} onChange={(e) => setRecurring({ ...recurring, end_date: e.currentTarget.value })} />
            </SimpleGrid>
            <Checkbox label={t('autoPost')} checked={recurring.auto_post} onChange={(e) => setRecurring({ ...recurring, auto_post: e.currentTarget.checked })} />
            <Group justify="flex-end">
              <Button onClick={makeRecurring} loading={busy} disabled={!recurring.code || !recurring.name}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={rejecting !== null} onClose={() => setRejecting(null)} title={t('reject')}>
        <Stack>
          <Textarea label={t('rejectReason')} value={rejecting ?? ''} onChange={(e) => setRejecting(e.currentTarget.value)} autosize minRows={2} />
          <Group justify="flex-end">
            <Button color="orange" onClick={reject} disabled={!rejecting} loading={busy}>
              {t('reject')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!reversing} onClose={() => setReversing(null)} title={t('reverse')}>
        {reversing && (
          <Stack>
            <TextInput type="date" label={t('reversalDate')} value={reversing.date} onChange={(e) => setReversing({ ...reversing, date: e.currentTarget.value })} />
            <Textarea label={t('description')} value={reversing.description} onChange={(e) => setReversing({ ...reversing, description: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button color="red" onClick={reverse} loading={busy}>
                {t('reverse')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};
