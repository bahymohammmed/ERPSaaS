'use client';

import { Button, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconChartBar, IconFilePlus, IconScale } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { StatusBadge } from '@/components/common';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { usePeriods } from '@/lib/queries';
import { useSession } from '@/lib/session';

const useCount = (status: string, extra: Record<string, string> = {}) => {
  const { company } = useSession();
  return useQuery({
    queryKey: [company?.id, 'journal-count', status, extra],
    queryFn: () => api<{ total: number }>('/gl/journals', { query: { status, page_size: 1, ...extra } }),
    enabled: !!company,
  });
};

const DashboardPage = () => {
  const { t, name } = useI18n();
  const { company, can } = useSession();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const drafts = useCount('DRAFT');
  const pending = useCount('SUBMITTED');
  const posted = useCount('POSTED', { from: monthStart, to: today });
  const { data: periods = [] } = usePeriods();
  const current = periods.find((p) => !p.is_adjustment && p.start_date <= today && p.end_date >= today);

  const stat = (label: string, value: number | undefined, href: string) => (
    <Card withBorder component={Link} href={href}>
      <Text c="dimmed" size="sm">
        {label}
      </Text>
      <Title order={2} className="num">
        {value ?? '—'}
      </Title>
    </Card>
  );

  return (
    <Stack>
      <Title order={3}>{name(company)}</Title>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
        {stat(t('dashboardDrafts'), drafts.data?.total, '/gl/journals?status=DRAFT')}
        {stat(t('dashboardPending'), pending.data?.total, '/gl/journals?status=SUBMITTED')}
        {stat(t('dashboardPosted'), posted.data?.total, '/gl/journals?status=POSTED')}
        <Card withBorder>
          <Text c="dimmed" size="sm">
            {t('dashboardCurrentPeriod')}
          </Text>
          {current ? (
            <Group gap="xs">
              <Title order={4}>{name(current)}</Title>
              {current.statuses.GL && <StatusBadge status={current.statuses.GL} />}
            </Group>
          ) : (
            <Text>—</Text>
          )}
        </Card>
      </SimpleGrid>
      <Card withBorder>
        <Text fw={600} mb="sm">
          {t('quickActions')}
        </Text>
        <Group>
          {can('gl.journal.create') && (
            <Button component={Link} href="/gl/journals/new" leftSection={<IconFilePlus size={16} />}>
              {t('newEntry')}
            </Button>
          )}
          {can('gl.report.view') && (
            <>
              <Button variant="light" component={Link} href="/reports/trial-balance" leftSection={<IconScale size={16} />}>
                {t('reportTrialBalance')}
              </Button>
              <Button variant="light" component={Link} href="/reports/income-statement" leftSection={<IconChartBar size={16} />}>
                {t('reportIncomeStatement')}
              </Button>
            </>
          )}
        </Group>
      </Card>
    </Stack>
  );
};

export default DashboardPage;
