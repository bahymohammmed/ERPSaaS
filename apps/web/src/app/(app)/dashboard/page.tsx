'use client';

import { Anchor, Badge, Button, Card, Grid, Group, SimpleGrid, Skeleton, Stack, Table, Text, ThemeIcon, Title, UnstyledButton } from '@mantine/core';
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconCalendarStats,
  IconChecks,
  IconClockHour4,
  IconFilePlus,
  IconPencil,
  IconScale,
  IconTrendingUp,
  IconWallet,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { RevenueChart, type MonthPoint } from '@/components/RevenueChart';
import { StatusBadge } from '@/components/common';
import { EmptyState, TableSkeletonRows } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCountUp } from '@/lib/useCountUp';
import { usePeriods } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { JournalEntry } from '@/lib/types';

type Financials =
  | { available: false }
  | { available: true; fiscal_year: string; months: MonthPoint[]; cash_balance: string; revenue_ytd: string; expense_ytd: string; net_profit_ytd: string };

type Recent = Pick<JournalEntry, 'id' | 'entry_no' | 'entry_date' | 'status' | 'description' | 'total_debit'>;

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const useCount = (status: string, extra: Record<string, string> = {}) => {
  const { company } = useSession();
  return useQuery({
    queryKey: [company?.id, 'journal-count', status, extra],
    queryFn: () => api<{ total: number }>('/gl/journals', { query: { status, page_size: 1, ...extra } }),
    enabled: !!company,
  });
};

/** A headline amount that counts up from zero when it arrives. */
const KpiCard = ({ label, value, icon, color, minor }: { label: string; value: string | undefined; icon: ReactNode; color: string; minor: number }) => {
  const { amount } = useI18n();
  const animated = useCountUp(value === undefined ? undefined : Number(value));
  return (
    <Card className="lift" padding="lg">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={6} style={{ minWidth: 0 }}>
          <Text size="sm" c="dimmed" fw={500}>
            {label}
          </Text>
          {animated === null ? (
            <Skeleton height={28} width={140} radius="sm" />
          ) : (
            <Text fz={26} fw={700} className="num" lh={1.15} style={{ letterSpacing: '-0.02em' }}>
              {amount(animated.toFixed(minor), minor)}
            </Text>
          )}
        </Stack>
        <ThemeIcon className="kpi-icon" variant="light" color={color} size={44} radius="md">
          {icon}
        </ThemeIcon>
      </Group>
    </Card>
  );
};

const QueueRow = ({ icon, color, label, hint, value, href }: { icon: ReactNode; color: string; label: string; hint?: string; value: ReactNode; href?: string }) => {
  const content = (
    <Group justify="space-between" wrap="nowrap" py={10} px={4}>
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon variant="light" color={color} radius="md" size={34}>
          {icon}
        </ThemeIcon>
        <div>
          <Text size="sm">{label}</Text>
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
        </div>
      </Group>
      <div style={{ flexShrink: 0 }}>{value}</div>
    </Group>
  );
  return href ? (
    <UnstyledButton component={Link} href={href} className="queue-row">
      {content}
    </UnstyledButton>
  ) : (
    content
  );
};

const DashboardPage = () => {
  const { t, name, amount, locale } = useI18n();
  const { me, company, can } = useSession();
  const router = useRouter();
  const today = localToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const minor = company?.base_minor_units ?? 3;
  const drafts = useCount('DRAFT');
  const pending = useCount('SUBMITTED');
  const posted = useCount('POSTED', { from: monthStart, to: today });
  const { data: periods = [] } = usePeriods();
  const current = periods.find((p) => !p.is_adjustment && p.start_date <= today && p.end_date >= today);
  const financials = useQuery({
    queryKey: [company?.id, 'dashboard', today],
    queryFn: () => api<Financials>('/gl/dashboard', { query: { today } }),
    enabled: !!company && can('gl.report.view'),
  });
  const recent = useQuery({
    queryKey: [company?.id, 'journals-recent'],
    queryFn: () => api<{ rows: Recent[] }>('/gl/journals', { query: { page: 1, page_size: 6 } }),
    enabled: !!company && can('gl.journal.view'),
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('goodMorning') : hour < 18 ? t('goodAfternoon') : t('goodEvening');
  const fin = financials.data?.available ? financials.data : null;
  const showFinancials = can('gl.report.view') && financials.data?.available !== false;
  const net = fin ? Number(fin.net_profit_ytd) : 0;
  const count = (q: { data?: { total: number } }) =>
    q.data ? (
      <Badge variant="light" size="lg" className="num">
        {q.data.total}
      </Badge>
    ) : (
      <Skeleton height={22} width={36} radius="xl" />
    );

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap" className="stagger">
        <div>
          <Title order={2} fw={700} style={{ letterSpacing: '-0.02em' }}>
            {greeting}{locale === 'ar' ? '، ' : ', '}{me?.user.full_name.split(' ')[0]}
          </Title>
          <Text c="dimmed" mt={4}>
            {t('dashboardSubtitle').replace('{company}', name(company))}
          </Text>
        </div>
        <Group gap="xs">
          {can('gl.report.view') && (
            <Button variant="default" component={Link} href="/reports/trial-balance" leftSection={<IconScale size={16} />}>
              {t('reportTrialBalance')}
            </Button>
          )}
          {can('gl.journal.create') && (
            <Button component={Link} href="/gl/journals/new" leftSection={<IconFilePlus size={16} />}>
              {t('newEntry')}
            </Button>
          )}
        </Group>
      </Group>

      {showFinancials && (
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} className="stagger">
          <KpiCard label={t('cashBalance')} value={fin?.cash_balance} icon={<IconWallet size={22} />} color="brand" minor={minor} />
          <KpiCard label={t('revenueYtd')} value={fin?.revenue_ytd} icon={<IconTrendingUp size={22} />} color="teal" minor={minor} />
          <KpiCard label={t('expensesYtd')} value={fin?.expense_ytd} icon={<IconArrowDownRight size={22} />} color="orange" minor={minor} />
          <KpiCard
            label={t('netProfitYtd')}
            value={fin?.net_profit_ytd}
            icon={net >= 0 ? <IconArrowUpRight size={22} /> : <IconArrowDownRight size={22} />}
            color={net >= 0 ? 'green' : 'red'}
            minor={minor}
          />
        </SimpleGrid>
      )}

      <Grid gutter="lg" className="stagger">
        {showFinancials && (
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Card padding="lg" h="100%">
              <Group justify="space-between" mb="sm">
                <div>
                  <Text fw={600}>{t('revenueVsExpenses')}</Text>
                  {fin && (
                    <Text size="xs" c="dimmed">
                      {t('ofYear').replace('{year}', fin.fiscal_year)}
                    </Text>
                  )}
                </div>
                <Anchor component={Link} href="/reports/income-statement" size="sm">
                  {t('reportIncomeStatement')}
                </Anchor>
              </Group>
              {fin ? <RevenueChart months={fin.months} minorUnits={minor} /> : <Skeleton height={240} radius="md" />}
            </Card>
          </Grid.Col>
        )}
        <Grid.Col span={{ base: 12, lg: showFinancials ? 4 : 12 }}>
          <Card padding="lg" h="100%">
            <Text fw={600} mb="xs">
              {t('workQueue')}
            </Text>
            <Stack gap={0}>
              <QueueRow icon={<IconPencil size={17} />} color="gray" label={t('dashboardDrafts')} value={count(drafts)} href="/gl/journals?status=DRAFT" />
              <QueueRow icon={<IconClockHour4 size={17} />} color="yellow" label={t('dashboardPending')} value={count(pending)} href="/gl/journals?status=SUBMITTED" />
              <QueueRow icon={<IconChecks size={17} />} color="teal" label={t('dashboardPosted')} value={count(posted)} href="/gl/journals?status=POSTED" />
              <QueueRow
                icon={<IconCalendarStats size={17} />}
                color="brand"
                label={t('dashboardCurrentPeriod')}
                hint={current ? name(current) : undefined}
                value={current?.statuses.GL ? <StatusBadge status={current.statuses.GL} /> : <Text c="dimmed">—</Text>}
                href="/gl/periods"
              />
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      {can('gl.journal.view') && (
        <Card padding="lg" className="stagger">
          <Group justify="space-between" mb="sm">
            <Text fw={600}>{t('recentEntries')}</Text>
            <Anchor component={Link} href="/gl/journals" size="sm">
              {t('viewAll')}
            </Anchor>
          </Group>
          <Table.ScrollContainer minWidth={560}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('entryNo')}</Table.Th>
                  <Table.Th>{t('date')}</Table.Th>
                  <Table.Th>{t('description')}</Table.Th>
                  <Table.Th style={{ textAlign: 'end' }}>{t('amount')}</Table.Th>
                  <Table.Th>{t('status')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {recent.isLoading && <TableSkeletonRows cols={5} rows={4} />}
                {recent.data?.rows.map((row) => (
                  <Table.Tr key={row.id} className="clickable" onClick={() => router.push(`/gl/journals/${row.id}`)}>
                    <Table.Td className="ltr" fw={500}>
                      {row.entry_no ?? '—'}
                    </Table.Td>
                    <Table.Td className="num">{row.entry_date}</Table.Td>
                    <Table.Td>
                      <Text size="sm" lineClamp={1}>
                        {row.description}
                      </Text>
                    </Table.Td>
                    <Table.Td className="num" style={{ textAlign: 'end' }}>
                      {amount(row.total_debit, minor)}
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={row.status} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {recent.data?.rows.length === 0 && (
            <EmptyState
              action={
                can('gl.journal.create') && (
                  <Button mt="xs" size="xs" component={Link} href="/gl/journals/new" leftSection={<IconFilePlus size={14} />}>
                    {t('newEntry')}
                  </Button>
                )
              }
            />
          )}
        </Card>
      )}
    </Stack>
  );
};

export default DashboardPage;
