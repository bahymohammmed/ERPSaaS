'use client';

import { Alert, Anchor, Button, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { NewPasswordFields, validNewPassword } from '@/components/ChangePasswordForm';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';

const ResetPasswordForm = () => {
  const { t, errorText } = useI18n();
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const check = useQuery({
    queryKey: ['reset-check', token],
    queryFn: () => api<{ valid: boolean }>('/auth/password/check', { method: 'POST', body: { token } }),
    enabled: token.length >= 20,
    retry: false,
  });
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const invalid = token.length < 20 || check.data?.valid === false || check.isError;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token, new_password: next } });
      notifySuccess(t('passwordChanged'));
      router.replace('/login');
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack>
        <div>
          <Title order={2} style={{ letterSpacing: '-0.02em' }}>
            {t('resetPasswordTitle')}
          </Title>
          <Text c="dimmed" size="sm" mt={4}>
            {t('resetPasswordSubtitle')}
          </Text>
        </div>
        {check.isLoading ? (
          <Loader size="sm" />
        ) : invalid ? (
          <Alert variant="light" color="red">
            {t('resetLinkInvalid')}{' '}
            <Anchor component={Link} href="/forgot-password">
              {t('requestNewLink')}
            </Anchor>
          </Alert>
        ) : (
          <>
            <NewPasswordFields value={next} confirm={confirm} onChange={setNext} onConfirm={setConfirm} />
            <Button type="submit" size="md" loading={busy} disabled={!validNewPassword(next, confirm)}>
              {t('setNewPassword')}
            </Button>
          </>
        )}
        <Text size="sm">
          <Anchor component={Link} href="/login">{t('backToSignIn')}</Anchor>
        </Text>
      </Stack>
    </form>
  );
};

const ResetPasswordPage = () => (
  <Paper withBorder shadow="md" p={{ base: 'lg', sm: 36 }} radius="lg">
    <Suspense fallback={<Loader size="sm" />}>
      <ResetPasswordForm />
    </Suspense>
  </Paper>
);

export default ResetPasswordPage;
