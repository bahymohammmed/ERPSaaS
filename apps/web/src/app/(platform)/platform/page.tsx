'use client';

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  CopyButton,
  Divider,
  Drawer,
  Group,
  Menu,
  Modal,
  NumberInput,
  Paper,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconDots, IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { EmptyRow, TableSkeletonRows } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import type { Plan } from './plans/page';

type Tenant = {
  id: string;
  name: string;
  plan_code: string;
  plan_name_ar: string | null;
  plan_name_en: string | null;
  max_companies: number;
  max_users: number;
  is_active: boolean;
  created_at: string;
  company_count: number;
  user_count: number;
  last_login_at: string | null;
};

type Detail = {
  tenant: Tenant;
  companies: { id: string; code: string; name_ar: string; name_en: string; base_currency: string; is_active: boolean }[];
  members: { user_id: string; email: string; full_name: string; last_login_at: string | null; mfa_enabled: boolean; is_active: boolean; role_name_ar: string; role_name_en: string }[];
};

const CURRENCIES = ['KWD', 'SAR', 'AED', 'BHD', 'QAR', 'OMR', 'EGP', 'JOD', 'USD', 'EUR'];

const emptyTenant = () => ({
  name: '',
  plan_code: null as string | null,
  max_companies: 3,
  max_users: 25,
  company: { code: 'C01', name_ar: '', name_en: '', base_currency: 'KWD', fiscal_year_start_month: 1, first_fiscal_year: new Date().getFullYear(), seed_chart_of_accounts: true },
  admin: { email: '', full_name: '', password: '', locale: 'ar' as 'ar' | 'en' },
});

type NewTenant = ReturnType<typeof emptyTenant>;
type Edit = { id: string; name: string; plan_code: string; max_companies: number; max_users: number };

type Secret = { title: string; password: string | null; note: string };

const PlatformPage = () => {
  const { t, locale, name, errorText } = useI18n();
  const tenants = useQuery({ queryKey: ['platform-tenants'], queryFn: () => api<Tenant[]>('/platform/tenants') });
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api<Plan[]>('/platform/plans') });
  const planName = (p: { name_ar: string; name_en: string }) => (locale === 'ar' ? p.name_ar || p.name_en : p.name_en || p.name_ar);
  const planOptions = (current?: string) =>
    (plans.data ?? [])
      .filter((p) => p.is_active || p.code === current)
      .map((p) => ({ value: p.code, label: `${planName(p)}${p.is_default ? ` (${t('defaultPlan')})` : ''}` }));
  const planOf = (code: string | null) => plans.data?.find((p) => (code ? p.code === code : p.is_default));
  const [form, setForm] = useState<NewTenant | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [busy, setBusy] = useState(false);
  const detail = useQuery({ queryKey: ['platform-tenant', detailId], queryFn: () => api<Detail>(`/platform/tenants/${detailId}`), enabled: !!detailId });

  const when = (value: string | null) => (value ? new Date(value).toLocaleString(locale === 'ar' ? 'ar-KW' : 'en-GB') : t('never'));
  const day = (value: string) => new Date(value).toLocaleDateString(locale === 'ar' ? 'ar-KW' : 'en-GB');

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

  const create = () =>
    run(async () => {
      if (!form) return;
      const { password, ...admin } = form.admin;
      const result = await api<{ temporary_password: string | null; admin_created: boolean }>('/platform/tenants', {
        method: 'POST',
        body: { ...form, admin: password ? { ...admin, password } : admin },
      });
      setForm(null);
      setSecret({
        title: t('tenantCreated'),
        password: result.temporary_password,
        note: result.admin_created ? t('temporaryPasswordNote') : t('existingUserAdded'),
      });
      await tenants.refetch();
    });

  const saveEdit = () =>
    run(async () => {
      if (!edit) return;
      const { id, ...body } = edit;
      await api(`/platform/tenants/${id}`, { method: 'PATCH', body });
      notifySuccess(t('saved'));
      setEdit(null);
      await tenants.refetch();
    });

  const setActive = (tenant: Tenant, active: boolean) =>
    run(async () => {
      if (!active && !window.confirm(`${t('confirmSuspend')}\n${tenant.name}`)) return;
      await api(`/platform/tenants/${tenant.id}`, { method: 'PATCH', body: { is_active: active } });
      notifySuccess(t('saved'));
      await tenants.refetch();
    });

  const resetCredentials = (userId: string, resetMfa: boolean) =>
    run(async () => {
      if (!detailId || !window.confirm(t('confirmResetPassword'))) return;
      const result = await api<{ temporary_password: string | null }>(`/platform/tenants/${detailId}/users/${userId}/reset-credentials`, {
        method: 'POST',
        body: { reset_mfa: resetMfa },
      });
      setSecret({ title: resetMfa ? t('resetPasswordAndMfa') : t('resetPassword'), password: result.temporary_password, note: t('temporaryPasswordNote') });
      await detail.refetch();
    });

  const setCompany = <K extends keyof NewTenant['company']>(key: K, value: NewTenant['company'][K]) =>
    setForm((f) => (f ? { ...f, company: { ...f.company, [key]: value } } : f));
  const setAdmin = <K extends keyof NewTenant['admin']>(key: K, value: NewTenant['admin'][K]) =>
    setForm((f) => (f ? { ...f, admin: { ...f.admin, [key]: value } } : f));

  return (
    <>
      <PageHeader
        title={t('tenants')}
        actions={
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              const plan = planOf(null);
              setForm({ ...emptyTenant(), plan_code: plan?.code ?? null, max_companies: plan?.max_companies ?? 3, max_users: plan?.max_users ?? 25 });
            }}
          >
            {t('newTenant')}
          </Button>
        }
      />
      <Paper withBorder p="sm">
        <Table.ScrollContainer minWidth={900}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('organisation')}</Table.Th>
                <Table.Th>{t('plan')}</Table.Th>
                <Table.Th>{t('companiesUsed')}</Table.Th>
                <Table.Th>{t('usersUsed')}</Table.Th>
                <Table.Th>{t('createdOn')}</Table.Th>
                <Table.Th>{t('lastLogin')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
                <Table.Th>{t('actions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tenants.isLoading && (
                <TableSkeletonRows cols={8} />
              )}
              {tenants.data?.length === 0 && (
                <EmptyRow cols={8} />
              )}
              {(tenants.data ?? []).map((tenant) => (
                <Table.Tr key={tenant.id}>
                  <Table.Td>
                    <Button variant="subtle" size="compact-sm" onClick={() => setDetailId(tenant.id)}>
                      {tenant.name}
                    </Button>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color="gray">
                      {(locale === 'ar' ? tenant.plan_name_ar : tenant.plan_name_en) ?? tenant.plan_code}
                    </Badge>
                  </Table.Td>
                  <Table.Td className="num">
                    {tenant.company_count} / {tenant.max_companies}
                  </Table.Td>
                  <Table.Td className="num">
                    {tenant.user_count} / {tenant.max_users}
                  </Table.Td>
                  <Table.Td className="num">{day(tenant.created_at)}</Table.Td>
                  <Table.Td className="num">{when(tenant.last_login_at)}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={tenant.is_active ? 'teal' : 'red'}>
                      {tenant.is_active ? t('active') : t('suspended')}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon variant="subtle" aria-label={t('actions')}>
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => setDetailId(tenant.id)}>{t('details')}</Menu.Item>
                        <Menu.Item onClick={() => setEdit({ id: tenant.id, name: tenant.name, plan_code: tenant.plan_code, max_companies: tenant.max_companies, max_users: tenant.max_users })}>
                          {t('edit')}
                        </Menu.Item>
                        {tenant.is_active ? (
                          <Menu.Item color="red" onClick={() => setActive(tenant, false)}>
                            {t('suspend')}
                          </Menu.Item>
                        ) : (
                          <Menu.Item onClick={() => setActive(tenant, true)}>{t('reactivate')}</Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Modal opened={!!form} onClose={() => setForm(null)} title={t('newTenant')} size="xl">
        {form && (
          <Stack>
            <Title order={5}>{t('organisation')}</Title>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label={t('tenantName')} required value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
              <Select
                label={t('plan')}
                data={planOptions()}
                value={form.plan_code}
                onChange={(v) => {
                  const plan = planOf(v);
                  setForm({ ...form, plan_code: v, max_companies: plan?.max_companies ?? form.max_companies, max_users: plan?.max_users ?? form.max_users });
                }}
                allowDeselect={false}
              />
              <NumberInput label={t('maxCompanies')} min={1} max={1000} value={form.max_companies} onChange={(v) => setForm({ ...form, max_companies: Number(v) || 1 })} />
              <NumberInput label={t('maxUsers')} min={1} max={10000} value={form.max_users} onChange={(v) => setForm({ ...form, max_users: Number(v) || 1 })} />
            </SimpleGrid>
            <Divider />
            <Title order={5}>{t('firstCompany')}</Title>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('companyCode')} required value={form.company.code} onChange={(e) => setCompany('code', e.currentTarget.value)} classNames={{ input: 'ltr' }} />
              <TextInput label={t('companyNameAr')} value={form.company.name_ar} onChange={(e) => setCompany('name_ar', e.currentTarget.value)} dir="rtl" />
              <TextInput label={t('companyNameEn')} value={form.company.name_en} onChange={(e) => setCompany('name_en', e.currentTarget.value)} dir="ltr" />
              <Select label={t('baseCurrency')} data={CURRENCIES} value={form.company.base_currency} onChange={(v) => setCompany('base_currency', v ?? 'KWD')} allowDeselect={false} />
              <NumberInput label={t('firstFiscalYear')} min={2000} max={2100} value={form.company.first_fiscal_year} onChange={(v) => setCompany('first_fiscal_year', Number(v))} />
              <NumberInput label={t('fiscalYearStartMonth')} min={1} max={12} value={form.company.fiscal_year_start_month} onChange={(v) => setCompany('fiscal_year_start_month', Number(v) || 1)} />
            </SimpleGrid>
            <Checkbox label={t('seedCoa')} checked={form.company.seed_chart_of_accounts} onChange={(e) => setCompany('seed_chart_of_accounts', e.currentTarget.checked)} />
            <Divider />
            <Title order={5}>{t('tenantAdministrator')}</Title>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label={t('fullName')} required value={form.admin.full_name} onChange={(e) => setAdmin('full_name', e.currentTarget.value)} />
              <TextInput label={t('email')} type="email" required value={form.admin.email} onChange={(e) => setAdmin('email', e.currentTarget.value)} classNames={{ input: 'ltr' }} />
              <PasswordInput label={t('passwordOptional')} value={form.admin.password} onChange={(e) => setAdmin('password', e.currentTarget.value)} autoComplete="new-password" />
              <Select
                label={t('language')}
                data={[
                  { value: 'ar', label: t('arabic') },
                  { value: 'en', label: t('english') },
                ]}
                value={form.admin.locale}
                onChange={(v) => setAdmin('locale', v === 'en' ? 'en' : 'ar')}
                allowDeselect={false}
              />
            </SimpleGrid>
            <Text size="sm" c="dimmed">
              {t('existingUserNote')}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setForm(null)}>
                {t('cancel')}
              </Button>
              <Button onClick={create} loading={busy} disabled={!form.name || !form.company.code || !form.admin.email || !form.admin.full_name}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!edit} onClose={() => setEdit(null)} title={t('editTenant')}>
        {edit && (
          <Stack>
            <TextInput label={t('tenantName')} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.currentTarget.value })} />
            <Select
              label={t('plan')}
              description={t('planChangeHint')}
              data={planOptions(edit.plan_code)}
              value={edit.plan_code}
              onChange={(v) => {
                const plan = planOf(v);
                if (!v || !plan) return;
                setEdit({ ...edit, plan_code: v, max_companies: plan.max_companies, max_users: plan.max_users });
              }}
              allowDeselect={false}
            />
            <NumberInput label={t('maxCompanies')} min={1} max={1000} value={edit.max_companies} onChange={(v) => setEdit({ ...edit, max_companies: Number(v) || 1 })} />
            <NumberInput label={t('maxUsers')} min={1} max={10000} value={edit.max_users} onChange={(v) => setEdit({ ...edit, max_users: Number(v) || 1 })} />
            <Group justify="flex-end">
              <Button onClick={saveEdit} loading={busy}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!secret} onClose={() => setSecret(null)} title={secret?.title}>
        {secret && (
          <Stack>
            {secret.password ? (
              <>
                <Text size="sm">{t('temporaryPassword')}</Text>
                <Group wrap="nowrap">
                  <Code fz="lg" className="ltr" style={{ flex: 1 }}>
                    {secret.password}
                  </Code>
                  <CopyButton value={secret.password}>
                    {({ copied, copy }) => (
                      <Button size="xs" variant="light" onClick={copy}>
                        {copied ? t('copied') : t('copy')}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
              </>
            ) : null}
            <Alert variant="light">{secret.note}</Alert>
            <Group justify="flex-end">
              <Button onClick={() => setSecret(null)}>{t('close')}</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Drawer opened={!!detailId} onClose={() => setDetailId(null)} title={detail.data?.tenant.name} position={locale === 'ar' ? 'left' : 'right'} size="xl">
        {detail.data && (
          <Stack>
            <Title order={5}>{t('navCompanies')}</Title>
            <Table striped>
              <Table.Tbody>
                {detail.data.companies.map((c) => (
                  <Table.Tr key={c.id}>
                    <Table.Td className="ltr">{c.code}</Table.Td>
                    <Table.Td>{name(c)}</Table.Td>
                    <Table.Td className="ltr">{c.base_currency}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={c.is_active ? 'teal' : 'gray'}>
                        {c.is_active ? t('active') : t('inactive')}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Title order={5}>{t('tenantMembers')}</Title>
            <Table.ScrollContainer minWidth={600}>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('fullName')}</Table.Th>
                    <Table.Th>{t('role')}</Table.Th>
                    <Table.Th>{t('lastLogin')}</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {detail.data.members.map((m) => (
                    <Table.Tr key={m.user_id}>
                      <Table.Td>
                        <Text size="sm">{m.full_name}</Text>
                        <Text size="xs" c="dimmed" className="ltr">
                          {m.email}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {locale === 'ar' ? m.role_name_ar : m.role_name_en}
                        {m.mfa_enabled && (
                          <Badge size="xs" ms={6} variant="light">
                            2FA
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td className="num">{when(m.last_login_at)}</Table.Td>
                      <Table.Td>
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" aria-label={t('actions')}>
                              <IconDots size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item onClick={() => resetCredentials(m.user_id, false)}>{t('resetPassword')}</Menu.Item>
                            <Menu.Item onClick={() => resetCredentials(m.user_id, true)}>{t('resetPasswordAndMfa')}</Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        )}
      </Drawer>
    </>
  );
};

export default PlatformPage;
