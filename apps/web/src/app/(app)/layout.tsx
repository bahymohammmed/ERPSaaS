'use client';

import {
  ActionIcon,
  AppShell,
  Avatar,
  Box,
  Burger,
  Center,
  Collapse,
  Divider,
  Group,
  Loader,
  Menu,
  NavLink,
  ScrollArea,
  Select,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import { Spotlight, type SpotlightActionGroupData, spotlight } from '@mantine/spotlight';
import type { Permission } from '@erp/shared';
import {
  IconArrowsExchange,
  IconArrowsSplit,
  IconBook2,
  IconBuilding,
  IconBuildingSkyscraper,
  IconCalendarRepeat,
  IconCalendarStats,
  IconChartBar,
  IconChevronDown,
  IconCoins,
  IconCurrencyDollar,
  IconFileImport,
  IconFileInvoice,
  IconFilePlus,
  IconHelpCircle,
  IconHierarchy2,
  IconHistory,
  IconLanguage,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconListDetails,
  IconLock,
  IconLogout,
  IconMoon,
  IconReportAnalytics,
  IconReportMoney,
  IconSearch,
  IconShieldCheck,
  IconShieldLock,
  IconSitemap,
  IconTable,
  IconTag,
  IconUsers,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo } from 'react';
import { Brand } from '@/components/Brand';
import { HelpButton } from '@/components/HelpButton';
import { LanguageToggle } from '@/components/LanguageToggle';
import { MfaModal } from '@/components/MfaModal';
import { EmptyState } from '@/components/states';
import { ThemePicker, ThemeToggle } from '@/components/ThemeToggle';
import { useI18n } from '@/i18n/i18n';
import type { MessageKey } from '@/i18n/messages';
import { api, ApiError } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';

type NavItem = { href: string; label: MessageKey; icon: typeof IconBook2; permission?: Permission };
type NavSection = { label: MessageKey; items: NavItem[] };

const SECTIONS: NavSection[] = [
  { label: 'navOverview', items: [{ href: '/dashboard', label: 'navDashboard', icon: IconLayoutDashboard }] },
  {
    label: 'navGl',
    items: [
      { href: '/gl/journals', label: 'navJournals', icon: IconFileInvoice, permission: 'gl.journal.view' },
      { href: '/gl/accounts', label: 'navAccounts', icon: IconBook2, permission: 'gl.master.view' },
      { href: '/gl/cost-centers', label: 'navCostCenters', icon: IconSitemap, permission: 'gl.master.view' },
      { href: '/gl/dimensions', label: 'navDimensions', icon: IconHierarchy2, permission: 'gl.master.view' },
      { href: '/gl/journal-types', label: 'navJournalTypes', icon: IconTag, permission: 'gl.master.view' },
      { href: '/gl/distribution-templates', label: 'navTemplates', icon: IconListDetails, permission: 'gl.master.view' },
      { href: '/gl/currencies', label: 'navCurrencies', icon: IconCoins, permission: 'gl.master.view' },
      { href: '/gl/periods', label: 'navPeriods', icon: IconCalendarStats, permission: 'gl.master.view' },
    ],
  },
  {
    label: 'navClosing',
    items: [
      { href: '/gl/recurring', label: 'navRecurring', icon: IconCalendarRepeat, permission: 'gl.journal.view' },
      { href: '/gl/fx-revaluation', label: 'navFxRevaluation', icon: IconCurrencyDollar, permission: 'gl.close.manage' },
      { href: '/gl/allocation', label: 'navAllocation', icon: IconArrowsSplit, permission: 'gl.master.view' },
      { href: '/gl/budgets', label: 'navBudgets', icon: IconReportMoney, permission: 'gl.report.view' },
      { href: '/gl/year-end', label: 'navYearEnd', icon: IconLock, permission: 'gl.close.manage' },
      { href: '/gl/statements', label: 'navStatements', icon: IconTable, permission: 'gl.report.view' },
      { href: '/gl/import', label: 'navImport', icon: IconFileImport, permission: 'gl.master.manage' },
    ],
  },
  {
    label: 'navGroupCompanies',
    items: [
      { href: '/gl/intercompany', label: 'navIntercompany', icon: IconArrowsExchange, permission: 'gl.master.view' },
      { href: '/consolidation', label: 'navConsolidation', icon: IconBuildingSkyscraper, permission: 'gl.report.view' },
    ],
  },
];

const REPORT_ITEMS: { key: string; label: MessageKey }[] = [
  { key: 'trial-balance', label: 'reportTrialBalance' },
  { key: 'ledger', label: 'reportLedger' },
  { key: 'journal-register', label: 'reportJournalRegister' },
  { key: 'income-statement', label: 'reportIncomeStatement' },
  { key: 'balance-sheet', label: 'reportBalanceSheet' },
  { key: 'cash-flow', label: 'reportCashFlow' },
  { key: 'cost-center-matrix', label: 'reportCostCenterMatrix' },
  { key: 'cost-center-summary', label: 'reportCostCenterSummary' },
  { key: 'budget-vs-actual', label: 'reportBudgetVsActual' },
  { key: 'statement', label: 'reportStatement' },
  { key: 'intercompany-reconciliation', label: 'reportIcReconciliation' },
  { key: 'consolidation-worksheet', label: 'reportConsolidationWorksheet' },
  { key: 'consolidated-balance-sheet', label: 'reportConsolidatedBs' },
  { key: 'consolidated-income-statement', label: 'reportConsolidatedIs' },
];

const ADMIN_SECTION: NavSection = {
  label: 'navAdmin',
  items: [
    { href: '/admin/companies', label: 'navCompanies', icon: IconBuilding },
    { href: '/admin/users', label: 'navUsers', icon: IconUsers, permission: 'admin.users' },
    { href: '/admin/roles', label: 'navRoles', icon: IconShieldLock, permission: 'admin.users' },
    { href: '/admin/audit', label: 'navAudit', icon: IconHistory, permission: 'admin.audit' },
  ],
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');

const Shell = ({ children }: { children: ReactNode }) => {
  const { t, name, locale, setLocale, digits, setDigits } = useI18n();
  const { me, error, isLoading, company, selectCompany, can } = useSession();
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure();
  const [mfaOpened, { open: openMfa, close: closeMfa }] = useDisclosure();
  const [collapsed, setCollapsed] = useLocalStorage({ key: 'erp-nav-collapsed', defaultValue: false });
  const [reportsOpen, setReportsOpen] = useLocalStorage({ key: 'erp-nav-reports', defaultValue: true });
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace('/login');
  }, [error, router]);
  useEffect(closeMobile, [pathname, closeMobile]);

  const allowed = (item: NavItem) => !item.permission || can(item.permission);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    queryClient.clear();
    router.replace('/login');
  };

  const spotlightActions = useMemo<SpotlightActionGroupData[]>(() => {
    if (!me) return [];
    const go = (href: string) => () => router.push(href);
    const screens = [...SECTIONS, ADMIN_SECTION].flatMap((section) =>
      section.items.filter(allowed).map((item) => ({
        id: item.href,
        label: t(item.label),
        description: t(section.label),
        leftSection: <item.icon size={18} stroke={1.6} />,
        onClick: go(item.href),
      })),
    );
    const reports = can('gl.report.view')
      ? REPORT_ITEMS.map((r) => ({ id: `report-${r.key}`, label: t(r.label), description: t('navReports'), leftSection: <IconReportAnalytics size={18} stroke={1.6} />, onClick: go(`/reports/${r.key}`) }))
      : [];
    const actions = [
      ...(can('gl.journal.create') ? [{ id: 'new-entry', label: t('newEntry'), leftSection: <IconFilePlus size={18} stroke={1.6} />, onClick: go('/gl/journals/new') }] : []),
      { id: 'theme', label: t('toggleTheme'), leftSection: <IconMoon size={18} stroke={1.6} />, onClick: () => setColorScheme(scheme === 'dark' ? 'light' : 'dark') },
      { id: 'language', label: locale === 'ar' ? 'English' : 'العربية', leftSection: <IconLanguage size={18} stroke={1.6} />, onClick: () => setLocale(locale === 'ar' ? 'en' : 'ar') },
      { id: 'guide', label: t('userGuide'), leftSection: <IconHelpCircle size={18} stroke={1.6} />, onClick: () => window.open('/help', '_blank') },
      { id: 'logout', label: t('signOut'), leftSection: <IconLogout size={18} stroke={1.6} />, onClick: () => void logout() },
    ];
    return [
      { group: t('actionsGroup'), actions },
      { group: t('screensGroup'), actions: screens },
      ...(reports.length ? [{ group: t('navReports'), actions: reports }] : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, locale, scheme]);

  if (isLoading || !me) {
    return (
      <Center mih="100vh">
        <Loader type="dots" />
      </Center>
    );
  }

  const switchTenant = async (tenantId: string) => {
    await api('/auth/switch-tenant', { method: 'POST', body: { tenantId } });
    queryClient.clear();
    router.replace('/dashboard');
  };

  const changeDigits = async (value: 'latn' | 'arab') => {
    setDigits(value);
    await api('/auth/preferences', { method: 'PATCH', body: { digit_style: value } }).catch(() => undefined);
  };

  const isActive = (href: string) => (href === '/dashboard' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const tooltipSide = locale === 'ar' ? 'left' : 'right';
  const iconOnly = collapsed ? { root: { justifyContent: 'center', paddingInline: 0 }, section: { marginInlineEnd: 0 }, body: { display: 'none' } } : undefined;

  const navItem = (item: { href: string; label: string; icon: typeof IconBook2 }) => {
    const link = (
      <NavLink
        key={item.href}
        className="nav-link"
        component={Link}
        href={item.href}
        label={item.label}
        leftSection={<item.icon size={19} stroke={1.6} />}
        active={isActive(item.href)}
        styles={iconOnly}
        aria-label={item.label}
      />
    );
    return collapsed ? (
      <Tooltip key={item.href} label={item.label} position={tooltipSide} withArrow>
        {link}
      </Tooltip>
    ) : (
      link
    );
  };

  const section = (s: NavSection) => {
    const items = s.items.filter(allowed);
    if (!items.length) return null;
    return (
      <Box key={s.label}>
        {collapsed ? <Divider my={8} /> : <div className="nav-section">{t(s.label)}</div>}
        {items.map((item) => navItem({ ...item, label: t(item.label) }))}
      </Box>
    );
  };

  const reportsActive = pathname.startsWith('/reports/');

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: collapsed ? 76 : 268, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      padding={{ base: 'md', md: 'lg' }}
      transitionDuration={220}
      transitionTimingFunction="cubic-bezier(0.2, 0.8, 0.2, 1)"
    >
      <AppShell.Header className="glass">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap" gap="sm">
          <Group gap="xs" wrap="nowrap">
            <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" />
            <Tooltip label={collapsed ? t('expandSidebar') : t('collapseSidebar')}>
              <ActionIcon visibleFrom="sm" variant="subtle" color="gray" size="lg" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}>
                {collapsed ? <IconLayoutSidebarLeftExpand size={19} className="flip-rtl" /> : <IconLayoutSidebarLeftCollapse size={19} className="flip-rtl" />}
              </ActionIcon>
            </Tooltip>
            <UnstyledButton component={Link} href="/dashboard" aria-label={t('navDashboard')}>
              <Box visibleFrom="xs">
                <Brand name={t('appName')} />
              </Box>
              <Box hiddenFrom="xs">
                <Brand name={t('appName')} compact />
              </Box>
            </UnstyledButton>
          </Group>

          <UnstyledButton className="search-trigger" onClick={spotlight.open} visibleFrom="md">
            <IconSearch size={16} />
            <Text size="sm" c="dimmed" style={{ flex: 1 }}>
              {t('searchPlaceholder')}
            </Text>
            <span className="kbd">Ctrl K</span>
          </UnstyledButton>

          <Group gap={4} wrap="nowrap">
            <ActionIcon hiddenFrom="md" variant="subtle" color="gray" size="lg" onClick={spotlight.open} aria-label={t('searchShort')}>
              <IconSearch size={19} />
            </ActionIcon>
            <Select
              size="xs"
              w={{ base: 120, sm: 210 }}
              aria-label={t('company')}
              leftSection={<IconBuilding size={14} />}
              data={me.companies.map((c) => ({ value: c.id, label: `${c.code} — ${name(c)}` }))}
              value={company?.id ?? null}
              onChange={(v) => v && selectCompany(v)}
              allowDeselect={false}
            />
            <HelpButton />
            <ThemeToggle />
            <Box visibleFrom="lg">
              <LanguageToggle />
            </Box>
            <Menu position="bottom-end" withinPortal width={260}>
              <Menu.Target>
                <UnstyledButton aria-label={me.user.full_name} ms={4}>
                  <Group gap={8} wrap="nowrap">
                    <Avatar color="brand" radius="xl" size={34} variant="filled">
                      {initials(me.user.full_name)}
                    </Avatar>
                    <Box visibleFrom="xl" style={{ lineHeight: 1.2 }}>
                      <Text size="sm" fw={600} lineClamp={1}>
                        {me.user.full_name}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {me.tenant.name}
                      </Text>
                    </Box>
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
                        <Menu.Item key={x.tenant_id} leftSection={<IconBuildingSkyscraper size={15} />} onClick={() => switchTenant(x.tenant_id)}>
                          {x.tenant_name}
                        </Menu.Item>
                      ))}
                    <Menu.Divider />
                  </>
                )}
                <Menu.Item leftSection={<IconShieldCheck size={15} />} onClick={openMfa}>
                  {t('twoFactor')}
                </Menu.Item>
                <Menu.Item leftSection={<IconHelpCircle size={15} />} component={Link} href="/help" target="_blank">
                  {t('userGuide')}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Label>{t('appearance')}</Menu.Label>
                <Box px="xs" pb={6}>
                  <ThemePicker />
                </Box>
                <Box px="xs" pb={6} hiddenFrom="lg">
                  <LanguageToggle />
                </Box>
                <Menu.Label>{t('digitStyle')}</Menu.Label>
                <Menu.Item onClick={() => changeDigits('latn')} fw={digits === 'latn' ? 700 : 400}>
                  {t('digitsLatin')}
                </Menu.Item>
                <Menu.Item onClick={() => changeDigits('arab')} fw={digits === 'arab' ? 700 : 400}>
                  {t('digitsArabic')}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconLogout size={15} />} onClick={logout}>
                  {t('signOut')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar px={collapsed ? 10 : 12} pb="sm">
        <AppShell.Section grow component={ScrollArea} scrollbarSize={6} pt={4}>
          {SECTIONS.map(section)}
          {can('gl.report.view') &&
            (collapsed ? (
              <Box>
                <Divider my={8} />
                {navItem({ href: '/reports/trial-balance', label: t('navReports'), icon: IconChartBar })}
              </Box>
            ) : (
              <Box>
                <UnstyledButton className="nav-section nav-section-toggle" onClick={() => setReportsOpen(!reportsOpen)} aria-expanded={reportsOpen}>
                  <span>{t('navReports')}</span>
                  <IconChevronDown size={12} style={{ transform: reportsOpen ? 'none' : 'rotate(-90deg)', transition: 'transform 200ms var(--ease-out)' }} />
                </UnstyledButton>
                <Collapse in={reportsOpen || reportsActive} transitionDuration={220}>
                  {REPORT_ITEMS.map((r) => (
                    <NavLink
                      key={r.key}
                      className="nav-link"
                      component={Link}
                      href={`/reports/${r.key}`}
                      label={t(r.label)}
                      leftSection={<IconReportAnalytics size={17} stroke={1.5} />}
                      active={pathname === `/reports/${r.key}`}
                    />
                  ))}
                </Collapse>
              </Box>
            ))}
          {section(ADMIN_SECTION)}
        </AppShell.Section>
        <AppShell.Section>
          <Divider mb="sm" />
          <Group gap="sm" wrap="nowrap" justify={collapsed ? 'center' : 'flex-start'}>
            <Avatar radius="md" size={34} color="gray" variant="light">
              {initials(me.tenant.name)}
            </Avatar>
            {!collapsed && (
              <Box style={{ minWidth: 0 }}>
                <Text size="sm" fw={600} lineClamp={1}>
                  {me.tenant.name}
                </Text>
                <Text size="xs" c="dimmed" lineClamp={1} tt="capitalize">
                  {me.tenant.plan_code}
                </Text>
              </Box>
            )}
          </Group>
        </AppShell.Section>
      </AppShell.Navbar>

      <Spotlight
        actions={spotlightActions}
        nothingFound={t('nothingFound')}
        highlightQuery
        shortcut={['mod + K', '/']}
        limit={14}
        scrollable
        maxHeight={440}
        radius="lg"
        searchProps={{ leftSection: <IconSearch size={18} stroke={1.6} />, placeholder: t('searchPlaceholder') }}
      />
      <MfaModal opened={mfaOpened} enabled={!!me.user.mfa_enabled} onClose={closeMfa} />
      <AppShell.Main>
        <div key={pathname} className="page-enter">
          {company ? children : <EmptyState />}
        </div>
      </AppShell.Main>
    </AppShell>
  );
};

const AppLayout = ({ children }: { children: ReactNode }) => (
  <SessionProvider>
    <Shell>{children}</Shell>
  </SessionProvider>
);

export default AppLayout;
