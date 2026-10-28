'use client';

import { Anchor, Button, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { notifyError } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';

const LoginPage = () => {
  const { t, errorText } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
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
        <Stack>
          <Title order={2}>{t('appName')}</Title>
          <TextInput label={t('email')} type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} classNames={{ input: 'ltr' }} autoComplete="username" />
          <PasswordInput label={t('password')} required value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" />
          <Button type="submit" loading={busy}>{t('signIn')}</Button>
          <Text size="sm">
            <Anchor component={Link} href="/signup">{t('noAccount')}</Anchor>
          </Text>
        </Stack>
      </form>
    </Paper>
  );
};

export default LoginPage;
