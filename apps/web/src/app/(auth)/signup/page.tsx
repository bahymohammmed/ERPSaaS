'use client';

import { Anchor, Button, Checkbox, Group, NumberInput, Paper, PasswordInput, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { notifyError } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';

const CURRENCIES = ['KWD', 'SAR', 'AED', 'BHD', 'QAR', 'OMR', 'EGP', 'JOD', 'USD', 'EUR'];

const SignupPage = () => {
  const { t, locale, errorText } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    tenantName: '',
    companyCode: 'C01',
    companyNameAr: '',
    companyNameEn: '',
    baseCurrency: 'KWD',
    fiscalYearStartMonth: 1,
    firstFiscalYear: new Date().getFullYear(),
    seedChartOfAccounts: true,
    fullName: '',
    email: '',
    password: '',
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/auth/signup', { method: 'POST', body: { ...form, locale } });
      queryClient.clear();
      router.replace('/dashboard');
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper withBorder shadow="sm" p="xl" radius="md">
      <form onSubmit={submit}>
        <Stack gap="sm">
          <Title order={2}>{t('signUp')}</Title>
          <TextInput label={t('tenantName')} required value={form.tenantName} onChange={(e) => set('tenantName', e.currentTarget.value)} />
          <Group grow>
            <TextInput label={t('companyNameAr')} value={form.companyNameAr} onChange={(e) => set('companyNameAr', e.currentTarget.value)} dir="rtl" />
            <TextInput label={t('companyNameEn')} value={form.companyNameEn} onChange={(e) => set('companyNameEn', e.currentTarget.value)} dir="ltr" />
          </Group>
          <Group grow>
            <TextInput label={t('companyCode')} required value={form.companyCode} onChange={(e) => set('companyCode', e.currentTarget.value)} classNames={{ input: 'ltr' }} />
            <Select label={t('baseCurrency')} data={CURRENCIES} value={form.baseCurrency} onChange={(v) => set('baseCurrency', v ?? 'KWD')} allowDeselect={false} />
          </Group>
          <Group grow>
            <NumberInput label={t('firstFiscalYear')} min={2000} max={2100} value={form.firstFiscalYear} onChange={(v) => set('firstFiscalYear', Number(v))} />
            <NumberInput label={t('fiscalYearStartMonth')} min={1} max={12} value={form.fiscalYearStartMonth} onChange={(v) => set('fiscalYearStartMonth', Number(v))} />
          </Group>
          <Checkbox label={t('seedCoa')} checked={form.seedChartOfAccounts} onChange={(e) => set('seedChartOfAccounts', e.currentTarget.checked)} />
          <TextInput label={t('fullName')} required value={form.fullName} onChange={(e) => set('fullName', e.currentTarget.value)} />
          <TextInput label={t('email')} type="email" required value={form.email} onChange={(e) => set('email', e.currentTarget.value)} classNames={{ input: 'ltr' }} />
          <PasswordInput label={t('password')} required minLength={10} value={form.password} onChange={(e) => set('password', e.currentTarget.value)} autoComplete="new-password" />
          <Button type="submit" loading={busy}>{t('signUp')}</Button>
          <Text size="sm">
            <Anchor component={Link} href="/login">{t('haveAccount')}</Anchor>
          </Text>
        </Stack>
      </form>
    </Paper>
  );
};

export default SignupPage;
