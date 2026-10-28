'use client';

import { Alert, Button, Code, Group, Image, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useState } from 'react';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { notifyError, notifySuccess } from './notify';

/** Enrol or remove TOTP two-factor authentication for the signed-in user. */
export const MfaModal = ({ opened, enabled, onClose }: { opened: boolean; enabled: boolean; onClose: () => void }) => {
  const { t, errorText } = useI18n();
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const call = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    call(async () => {
      const result = await api<{ secret: string; otpauth_url: string }>('/auth/mfa/setup', { method: 'POST' });
      setSetup({ secret: result.secret, qr: await QRCode.toDataURL(result.otpauth_url, { margin: 1, width: 220 }) });
    });

  const finish = (action: 'enable' | 'disable') =>
    call(async () => {
      await api(`/auth/mfa/${action}`, { method: 'POST', body: { code } });
      notifySuccess(t('saved'));
      setSetup(null);
      setCode('');
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      onClose();
    });

  return (
    <Modal opened={opened} onClose={onClose} title={t('twoFactor')}>
      <Stack>
        <Alert color={enabled ? 'teal' : 'gray'} variant="light">
          {enabled ? t('twoFactorEnabled') : t('twoFactorDisabled')}
        </Alert>
        {!enabled && !setup && (
          <Button onClick={start} loading={busy}>
            {t('enable')}
          </Button>
        )}
        {setup && (
          <>
            <Text size="sm">{t('scanQr')}</Text>
            <Group justify="center">
              <Image src={setup.qr} alt="QR" w={220} h={220} />
            </Group>
            <Code ta="center" className="ltr">
              {setup.secret}
            </Code>
          </>
        )}
        {(setup || enabled) && (
          <>
            <TextInput label={t('verificationCode')} inputMode="numeric" maxLength={6} classNames={{ input: 'ltr' }} value={code} onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))} />
            <Button color={enabled ? 'red' : undefined} disabled={code.length !== 6} loading={busy} onClick={() => finish(enabled ? 'disable' : 'enable')}>
              {enabled ? t('disable') : t('enable')}
            </Button>
          </>
        )}
      </Stack>
    </Modal>
  );
};
