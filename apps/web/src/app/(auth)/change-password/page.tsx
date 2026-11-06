'use client';

import { Anchor, Paper, Stack, Text, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ChangePasswordForm } from '@/components/ChangePasswordForm';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';

/** Shown after signing in with a temporary password set by an administrator. */
const ChangePasswordPage = () => {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' });
    queryClient.clear();
    router.replace('/login');
  };
  return (
    <Paper withBorder shadow="md" p={{ base: 'lg', sm: 36 }} radius="lg">
      <Stack>
        <Title order={2} style={{ letterSpacing: '-0.02em' }}>
          {t('chooseNewPassword')}
        </Title>
        <ChangePasswordForm
          path="/auth/password"
          forced
          onDone={() => {
            queryClient.clear();
            router.replace('/dashboard');
          }}
        />
        <Text size="sm">
          <Anchor component="button" type="button" onClick={signOut}>
            {t('signOut')}
          </Anchor>
        </Text>
      </Stack>
    </Paper>
  );
};

export default ChangePasswordPage;
