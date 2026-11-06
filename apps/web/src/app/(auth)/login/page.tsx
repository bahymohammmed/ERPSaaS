'use client';

import { Anchor, Box, Button, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { notifyError } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api, ApiError } from '@/lib/api';

const LoginPage = () => {
  const { t, errorText } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState('');
  const [needsOtp, setNeedsOtp] = useState(false);
  const publicConfig = useQuery({ queryKey: ['public-config'], queryFn: () => api<{ signup: boolean; password_reset?: boolean }>('/auth/config') });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const session = await api<{ platform?: boolean; password_change_required?: boolean }>('/auth/login', { method: 'POST', body: { email, password, ...(needsOtp ? { otp } : {}) } });
      queryClient.clear();
      router.replace(session.platform ? '/platform' : session.password_change_required ? '/change-password' : '/dashboard');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'MFA_REQUIRED') {
        setNeedsOtp(true);
        return;
      }
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper withBorder shadow="md" p={{ base: 'lg', sm: 36 }} radius="lg">
      <form onSubmit={submit}>
        <Stack>
          <div>
            <Title order={2} style={{ letterSpacing: '-0.02em' }}>
              {t('welcomeBack')}
            </Title>
            <Text c="dimmed" size="sm" mt={4}>
              {t('signInSubtitle')}
            </Text>
          </div>
          <TextInput label={t('email')} type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} classNames={{ input: 'ltr' }} autoComplete="username" />
          <Box pos="relative">
            <PasswordInput label={t('password')} required value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" />
            {publicConfig.data?.password_reset && (
              <Anchor component={Link} href="/forgot-password" size="xs" pos="absolute" top={2} style={{ insetInlineEnd: 0 }}>
                {t('forgotPassword')}
              </Anchor>
            )}
          </Box>
          {needsOtp && (
            <TextInput
              label={t('verificationCode')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={otp}
              onChange={(e) => setOtp(e.currentTarget.value.replace(/\D/g, ''))}
              classNames={{ input: 'ltr' }}
            />
          )}
          <Button type="submit" size="md" loading={busy} disabled={needsOtp && otp.length !== 6}>
            {t('signIn')}
          </Button>
          {publicConfig.data?.signup && (
            <Text size="sm">
              <Anchor component={Link} href="/signup">{t('noAccount')}</Anchor>
            </Text>
          )}
        </Stack>
      </form>
    </Paper>
  );
};

export default LoginPage;
