'use client';

import { Alert, Button, Checkbox, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { pickText, type ReportColumn, type ReportDocument, type ReportLanguage, type ReportRow } from '@erp/shared';
import { IconFileSpreadsheet, IconFileTypePdf, IconPlayerPlay } from '@tabler/icons-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { AccountSelect, CostCenterSelect, PageHeader } from '@/components/common';
import { notifyError } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import type { MessageKey } from '@/i18n/messages';
import { api, download } from '@/lib/api';
import { useJournalTypes, usePeriods } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { Period } from '@/lib/types';

type Field = 'periodRange' | 'period' | 'dateRange' | 'account' | 'costCenter' | 'parentCostCenter' | 'level' | 'includeZero' | 'compare' | 'journalType' | 'accountScope';

const REPORTS: Record<string, { title: MessageKey; fields: Field[]; required: string[] }> = {
  'trial-balance': { title: 'reportTrialBalance', fields: ['periodRange', 'costCenter', 'level', 'includeZero'], required: ['from_period_id', 'to_period_id'] },
  ledger: { title: 'reportLedger', fields: ['account', 'dateRange', 'costCenter'], required: ['account_id', 'from', 'to'] },
  'journal-register': { title: 'reportJournalRegister', fields: ['dateRange', 'journalType'], required: ['from', 'to'] },
  'income-statement': { title: 'reportIncomeStatement', fields: ['periodRange', 'costCenter', 'level', 'compare'], required: ['from_period_id', 'to_period_id'] },
  'balance-sheet': { title: 'reportBalanceSheet', fields: ['period', 'level', 'compare'], required: ['period_id'] },
  'cost-center-matrix': { title: 'reportCostCenterMatrix', fields: ['periodRange', 'parentCostCenter', 'accountScope'], required: ['from_period_id', 'to_period_id'] },
  'cost-center-summary': { title: 'reportCostCenterSummary', fields: ['periodRange'], required: ['from_period_id', 'to_period_id'] },
};

type Params = Record<string, string>;

const defaultParams = (periods: Period[]): Params => {
  const today = new Date().toISOString().slice(0, 10);
  const current = periods.find((p) => !p.is_adjustment && p.start_date <= today && p.end_date >= today) ?? periods.filter((p) => !p.is_adjustment).at(-1);
  const yearPeriods = periods.filter((p) => p.fiscal_year_id === current?.fiscal_year_id);
  const first = yearPeriods.find((p) => p.period_no === 1);
  return {
    from_period_id: first?.id ?? '',
    to_period_id: current?.id ?? '',
    period_id: current?.id ?? '',
    from: first?.start_date ?? `${today.slice(0, 4)}-01-01`,
    to: current?.end_date ?? today,
    compare: 'none',
    include_zero: 'false',
    account_scope: 'PL',
  };
};

const ReportScreen = () => {
  const { key } = useParams<{ key: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { t, name, locale, digits, errorText, amount } = useI18n();
  const { company } = useSession();
  const { data: periods = [] } = usePeriods();
  const { data: journalTypes = [] } = useJournalTypes();
  const report = REPORTS[key];
  const [params, setParams] = useState<Params | null>(null);
  const [doc, setDoc] = useState<ReportDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportLang, setExportLang] = useState<ReportLanguage>(locale);

  useEffect(() => {
    if (!periods.length || params) return;
    const fromUrl = Object.fromEntries(search.entries());
    setParams({ ...defaultParams(periods), ...fromUrl });
  }, [periods, params, search]);

  useEffect(() => setExportLang(locale), [locale]);

  const ready = !!report && !!params && report.required.every((k) => params[k]);

  const runReport = async (p: Params | null = params) => {
    if (!report || !p) return;
    setLoading(true);
    try {
      setDoc(await api<ReportDocument>(`/gl/reports/${key}`, { query: query(p) }));
    } catch (error) {
      setDoc(null);
      notifyError(errorText(error));
    } finally {
      setLoading(false);
    }
  };

  // Drill-down links arrive with parameters: run immediately.
  useEffect(() => {
    if (params && search.size > 0 && ready && !doc) void runReport(params);
  }, [params]); // runs once when parameters are first resolved

  const query = (p: Params) => {
    const relevant: Record<string, string> = {};
    const add = (k: string) => {
      if (p[k]) relevant[k] = p[k];
    };
    for (const field of report?.fields ?? []) {
      if (field === 'periodRange') ['from_period_id', 'to_period_id'].forEach(add);
      if (field === 'period') add('period_id');
      if (field === 'dateRange') ['from', 'to'].forEach(add);
      if (field === 'account') add('account_id');
      if (field === 'costCenter') add('cost_center_id');
      if (field === 'parentCostCenter') add('parent_cost_center_id');
      if (field === 'level') add('level');
      if (field === 'includeZero') add('include_zero');
      if (field === 'compare') add('compare');
      if (field === 'journalType') add('journal_type_id');
      if (field === 'accountScope') add('account_scope');
    }
    return relevant;
  };

  const exportAs = async (format: 'pdf' | 'xlsx') => {
    if (!params) return;
    setLoading(true);
    try {
      await download(`/gl/reports/${key}`, { ...query(params), format, lang: exportLang, digits }, `${key}.${format}`);
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setLoading(false);
    }
  };

  const periodById = useMemo(() => new Map(periods.map((p) => [p.id, p])), [periods]);

  const drill = (row: ReportRow) => {
    if (!row.drill || !params) return;
    if (row.drill.kind === 'entry') {
      router.push(`/gl/journals/${row.drill.id}`);
      return;
    }
    const from = periodById.get(params.from_period_id ?? '')?.start_date ?? params.from;
    const to = periodById.get(params.to_period_id ?? params.period_id ?? '')?.end_date ?? params.to;
    if (row.drill.kind === 'account') {
      const qs = new URLSearchParams({ account_id: row.drill.id, from: from ?? '', to: to ?? '', ...(params.cost_center_id ? { cost_center_id: params.cost_center_id } : {}) });
      window.open(`/reports/ledger?${qs}`, '_self');
    } else {
      const qs = new URLSearchParams({ cost_center_id: row.drill.id, from_period_id: params.from_period_id ?? '', to_period_id: params.to_period_id ?? '' });
      window.open(`/reports/income-statement?${qs}`, '_self');
    }
  };

  if (!report) return <Alert color="red">{t('noData')}</Alert>;
  if (!params) return <Text>{t('loading')}</Text>;

  const set = (k: string, v: string | null | undefined) => setParams((p) => ({ ...(p ?? {}), [k]: v ?? '' }));
  const periodOptions = periods.map((p) => ({ value: p.id, label: `${p.code} — ${name(p)}` }));

  return (
    <Stack>
      <PageHeader title={t(report.title)} subtitle={name(company)} />
      <Paper withBorder p="md">
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
          {report.fields.includes('periodRange') && (
            <>
              <Select label={t('fromPeriod')} searchable data={periodOptions} value={params.from_period_id || null} onChange={(v) => set('from_period_id', v)} />
              <Select label={t('toPeriod')} searchable data={periodOptions} value={params.to_period_id || null} onChange={(v) => set('to_period_id', v)} />
            </>
          )}
          {report.fields.includes('period') && <Select label={t('asOfPeriod')} searchable data={periodOptions} value={params.period_id || null} onChange={(v) => set('period_id', v)} />}
          {report.fields.includes('account') && <AccountSelect label={t('account')} postingOnly={false} activeOnly={false} value={params.account_id || null} onChange={(v) => set('account_id', v)} />}
          {report.fields.includes('dateRange') && (
            <>
              <TextInput type="date" label={t('from')} value={params.from ?? ''} onChange={(e) => set('from', e.currentTarget.value)} />
              <TextInput type="date" label={t('to')} value={params.to ?? ''} onChange={(e) => set('to', e.currentTarget.value)} />
            </>
          )}
          {report.fields.includes('costCenter') && (
            <CostCenterSelect label={t('costCenter')} postingOnly={false} activeOnly={false} value={params.cost_center_id || null} onChange={(v) => set('cost_center_id', v)} />
          )}
          {report.fields.includes('parentCostCenter') && (
            <CostCenterSelect label={t('parentCostCenter')} postingOnly={false} activeOnly={false} value={params.parent_cost_center_id || null} onChange={(v) => set('parent_cost_center_id', v)} />
          )}
          {report.fields.includes('accountScope') && (
            <Select
              label={t('accountScope')}
              data={(['PL', 'EXPENSE', 'REVENUE'] as const).map((s) => ({ value: s, label: t(`scope${s}`) }))}
              value={params.account_scope || 'PL'}
              onChange={(v) => set('account_scope', v)}
              allowDeselect={false}
            />
          )}
          {report.fields.includes('journalType') && (
            <Select label={t('journalType')} clearable data={journalTypes.map((jt) => ({ value: jt.id, label: `${jt.code} — ${name(jt)}` }))} value={params.journal_type_id || null} onChange={(v) => set('journal_type_id', v)} />
          )}
          {report.fields.includes('level') && (
            <NumberInput label={t('level')} min={1} max={10} value={params.level ? Number(params.level) : ''} onChange={(v) => set('level', v === '' ? '' : String(v))} placeholder={t('all')} />
          )}
          {report.fields.includes('compare') && (
            <Select
              label={t('compare')}
              data={[
                { value: 'none', label: t('compareNone') },
                { value: 'prior_year', label: t('comparePrior') },
              ]}
              value={params.compare || 'none'}
              onChange={(v) => set('compare', v)}
              allowDeselect={false}
            />
          )}
          {report.fields.includes('includeZero') && (
            <Checkbox mt="xl" label={t('includeZero')} checked={params.include_zero === 'true'} onChange={(e) => set('include_zero', e.currentTarget.checked ? 'true' : 'false')} />
          )}
        </SimpleGrid>
        <Group mt="md" justify="space-between">
          <Button leftSection={<IconPlayerPlay size={16} />} onClick={() => runReport()} disabled={!ready} loading={loading}>
            {t('run')}
          </Button>
          <Group gap="xs">
            <Select
              size="xs"
              w={170}
              aria-label={t('reportLanguage')}
              data={[
                { value: 'ar', label: t('arabic') },
                { value: 'en', label: t('english') },
                { value: 'both', label: t('bothLanguages') },
              ]}
              value={exportLang}
              onChange={(v) => setExportLang((v ?? 'ar') as ReportLanguage)}
              allowDeselect={false}
            />
            <Button size="xs" variant="light" leftSection={<IconFileTypePdf size={16} />} disabled={!ready} onClick={() => exportAs('pdf')}>
              {t('exportPdf')}
            </Button>
            <Button size="xs" variant="light" color="teal" leftSection={<IconFileSpreadsheet size={16} />} disabled={!ready} onClick={() => exportAs('xlsx')}>
              {t('exportExcel')}
            </Button>
          </Group>
        </Group>
      </Paper>

      {doc && (
        <Paper withBorder p="md">
          <Title order={4}>{pickText(doc.title, locale)}</Title>
          {doc.subtitle.map((s, i) => (
            <Text key={i} size="sm" c="dimmed">
              {pickText(s, locale)}
            </Text>
          ))}
          <Table.ScrollContainer minWidth={Math.max(600, doc.columns.length * 130)} mt="sm">
            <Table>
              <Table.Thead>
                <Table.Tr>
                  {doc.columns.map((c) => (
                    <Table.Th key={c.key} className={c.kind === 'amount' ? 'amount-cell' : undefined}>
                      {pickText(c.label, locale)}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {doc.rows.map((row, i) => (
                  <Table.Tr key={i} className={`row-${row.style ?? 'normal'}${row.drill ? ' clickable' : ''}`} onClick={() => drill(row)}>
                    {doc.columns.map((c) => (
                      <Table.Td key={c.key} className={c.kind === 'amount' ? 'amount-cell' : undefined} style={c.kind === 'bilingual' && row.level ? { paddingInlineStart: 12 + row.level * 16 } : undefined}>
                        <Cell column={c} row={row} minor={doc.minorUnits} format={amount} locale={locale} />
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {doc.notes.map((n, i) => (
            <Text key={i} size="xs" c="dimmed" mt={4}>
              {pickText(n, locale)}
            </Text>
          ))}
        </Paper>
      )}
    </Stack>
  );
};

const Cell = ({
  column,
  row,
  minor,
  format,
  locale,
}: {
  column: ReportColumn;
  row: ReportRow;
  minor: number;
  format: (v: string, m: number) => string;
  locale: 'ar' | 'en';
}) => {
  const value = row.cells[column.key];
  if (value === null || value === undefined) return null;
  if (column.kind === 'amount' && typeof value === 'string') return <span className="num">{format(value, column.minorUnits ?? minor)}</span>;
  if (column.kind === 'date' || column.key === 'code' || column.key === 'entry_no') return <span className="ltr">{pickText(value, locale)}</span>;
  return <>{pickText(value, locale)}</>;
};

const ReportPage = () => (
  <Suspense>
    <ReportScreen />
  </Suspense>
);

export default ReportPage;
