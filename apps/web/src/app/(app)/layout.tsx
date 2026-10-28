'use client';

import { AppShell, Burger, Center, Group, Loader, Menu, NavLink, ScrollArea, Select, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { Permission } from '@erp/shared';
import {
  IconBook2,
  IconBuilding,
  IconCalendarStats,
  IconChartBar,
  IconChevronDown,
  IconCoins,
  IconFileInvoice,
  IconHierarchy2,
  IconHistory,
  IconLayoutDashboard,
  IconListDetails,
  IconShieldLock,
  IconSitemap,
  IconTag,
  IconUsers,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { LanguageToggle } from '@/components/LanguageToggle';
import { useI18n } from '@/i18n/i18n';
import type { MessageKey } from '@/i18n/messages';
import { api, ApiError } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';

type NavItem = { href: string; label: MessageKey; icon: typeof IconBook2; permission?: Permission };

const GL_ITEMS: NavItem[] = [
  { href: '/gl/journals', label: 'navJournals', icon: IconFileInvoice, permission: 'gl.journal.view' },
  { href: '/gl/accounts', label: 'navAccounts', icon: IconBook2, permission: 'gl.master.view' },
  { href: '/gl/cost-centers', label: 'navCostCenters', icon: IconSitemap, permission: 'gl.master.view' },
  { href: '/gl/dimensions', label: 'navDimensions', icon: IconHierarchy2, permission: 'gl.master.view' },
  { href: '/gl/journal-types', label: 'navJournalTypes', icon: IconTag, permission: 'gl.master.view' },
  { href: '/gl/distribution-templates', label: 'navTemplates', icon: IconListDetails, permission: 'gl.master.view' },
  { href: '/gl/currencies', label: 'navCurrencies', icon: IconCoins, permission: 'gl.master.view' },
  { href: '/gl/periods', label: 'navPeriods', icon: IconCalendarStats, permission: 'gl.master.view' },
];

const REPORT_ITEMS: { key: string; label: MessageKey }[] = [
  { key: 'trial-balance', label: 'reportTrialBalance' },
  { key: 'ledger', label: 'reportLedger' },
  { key: 'journal-register', label: 'reportJournalRegister' },
  { key: 'income-statement', label: 'reportIncomeStatement' },
  { key: 'balance-sheet', label: 'reportBalanceSheet' },
  { key: 'cost-center-matrix', label: 'reportCostCenterMatrix' },
  { key: 'cost-center-summary', label: 'reportCostCenterSummary' },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: '/admin/companies', label: 'navCompanies', icon: IconBuilding },
  { href: '/admin/users', label: 'navUsers', icon: IconUsers, permission: 'admin.users' },
  { href: '/admin/roles', label: 'navRoles', icon: IconShieldLock, permission: 'admin.users' },
  { href: '/admin/audit', label: 'navAudit', icon: IconHistory, permission: 'admin.audit' },
];

const Shell = ({ children }: { children: ReactNode }) => {
  const { t, name, digits, setDigits } = useI18n();
  const { me, error, isLoading, company, selectCompany, can } = useSession();
  const [opened, { toggle, close }] = useDisclosure();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace('/login');
  }, [error, router]);
  useEffect(close, [pathname, close]);

  if (isLoading || !me) {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    );
  }

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    queryClient.clear();
    router.replace('/login');
  };

  const switchTenant = async (tenantId: string) => {
    await api('/auth/switch-tenant', { method: 'POST', body: { tenantId } });
    queryClient.clear();
    router.replace('/dashboard');
  };

  const changeDigits = async (value: 'latn' | 'arab') => {
    setDigits(value);
    await api('/auth/preferences', { method: 'PATCH', body: { digit_style: value } }).catch(() => undefined);
  };

  const link = (item: NavItem) =>
    (!item.permission || can(item.permission)) && (
      <NavLink
        key={item.href}
        component={Link}
        href={item.href}
        label={t(item.label)}
        leftSection={<item.icon size={18} stroke={1.6} />}
        active={pathname.startsWith(item.href)}
      />
    );

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700} visibleFrom="xs">
              {t('appName')}
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Select
              size="xs"
              w={{ base: 130, sm: 220 }}
              aria-label={t('company')}
              data={me.companies.map((c) => ({ value: c.id, label: `${c.code} — ${name(c)}` }))}
              value={company?.id ?? null}
              onChange={(v) => v && selectCompany(v)}
              allowDeselect={false}
            />
            <LanguageToggle />
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <UnstyledButton>
                  <Group gap={4} wrap="nowrap">
                    <Text size="sm" visibleFrom="sm">
                      {me.user.full_name}
                    </Text>
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{me.tenant.name}</Menu.Label>
                {me.tenants.length > 1 && (
                  <>
                    <Menu.Label>{t('switchOrganisation')}</Menu.Label>
                    {me.tenants
                      .filter((x) => x.tenant_id !== me.tenant.id)
                      .map((x) => (
                        <Menu.Item key={x.tenant_id} onClick={() => switchTenant(x.tenant_id)}>
                          {x.tenant_name}
                        </Menu.Item>
                      ))}
                    <Menu.Divider />
                  </>
                )}
                <Menu.Label>{t('digitStyle')}</Menu.Label>
                <Menu.Item onClick={() => changeDigits('latn')} fw={digits === 'latn' ? 700 : 400}>
                  {t('digitsLatin')}
                </Menu.Item>
                <Menu.Item onClick={() => changeDigits('arab')} fw={digits === 'arab' ? 700 : 400}>
                  {t('digitsArabic')}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" onClick={logout}>
                  {t('signOut')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <ScrollArea>
          <NavLink component={Link} href="/dashboard" label={t('navDashboard')} leftSection={<IconLayoutDashboard size={18} stroke={1.6} />} active={pathname === '/dashboard'} />
          <NavLink label={t('navGl')} defaultOpened childrenOffset={12} leftSection={<IconBook2 size={18} stroke={1.6} />}>
            {GL_ITEMS.map(link)}
          </NavLink>
          {can('gl.report.view') && (
            <NavLink label={t('navReports')} defaultOpened childrenOffset={12} leftSection={<IconChartBar size={18} stroke={1.6} />}>
              {REPORT_ITEMS.map((r) => (
                <NavLink key={r.key} component={Link} href={`/reports/${r.key}`} label={t(r.label)} active={pathname === `/reports/${r.key}`} />
              ))}
            </NavLink>
          )}
          <NavLink label={t('navAdmin')} childrenOffset={12} defaultOpened={pathname.startsWith('/admin')} leftSection={<IconShieldLock size={18} stroke={1.6} />}>
            {ADMIN_ITEMS.map(link)}
          </NavLink>
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>{company ? children : <Text>{t('noData')}</Text>}</AppShell.Main>
    </AppShell>
  );
};

const AppLayout = ({ children }: { children: ReactNode }) => (
  <SessionProvider>
    <Shell>{children}</Shell>
  </SessionProvider>
);

export default AppLayout;
