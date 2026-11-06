'use client';

import { Alert, Anchor, Button, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconMailCheck } from '@tabler/icons-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { notifyError } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';

const ForgotPasswordPage = () => {
  const { t, locale, errorText } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { email, locale } });
      setSent(true);
    } catch (error) {
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
              {t('forgotPasswordTitle')}
            </Title>
            <Text c="dimmed" size="sm" mt={4}>
              {t('forgotPasswordSubtitle')}
            </Text>
          </div>
          {sent ? (
            <Alert variant="light" color="teal" icon={<IconMailCheck size={18} />}>
              {t('resetLinkSent')}
            </Alert>
          ) : (
            <>
              <TextInput label={t('email')} type="email" required autoFocus value={email} onChange={(e) => setEmail(e.currentTarget.value)} classNames={{ input: 'ltr' }} autoComplete="username" />
              <Button type="submit" size="md" loading={busy}>
                {t('sendResetLink')}
              </Button>
            </>
          )}
          <Text size="sm">
            <Anchor component={Link} href="/login">{t('backToSignIn')}</Anchor>
          </Text>
        </Stack>
      </form>
    </Paper>
  );
};

export default ForgotPasswordPage;
