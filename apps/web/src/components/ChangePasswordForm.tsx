'use client';

import { Alert, Button, Modal, PasswordInput, Progress, Stack, Text } from '@mantine/core';
import { type FormEvent, useState } from 'react';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';

/** 0–4 from length and character variety; only a hint, the server enforces the minimum. */
export const passwordStrength = (value: string): number => {
  if (value.length < 10) return value.length ? 1 : 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(value)).length;
  return Math.min(4, 1 + (value.length >= 14 ? 1 : 0) + (kinds >= 2 ? 1 : 0) + (kinds >= 3 ? 1 : 0));
};

export const NewPasswordFields = ({ value, confirm, onChange, onConfirm }: { value: string; confirm: string; onChange: (v: string) => void; onConfirm: (v: string) => void }) => {
  const { t } = useI18n();
  const strength = passwordStrength(value);
  const mismatch = confirm.length > 0 && confirm !== value;
  return (
    <>
      <div>
        <PasswordInput label={t('newPassword')} description={t('passwordRule')} required value={value} onChange={(e) => onChange(e.currentTarget.value)} autoComplete="new-password" />
        <Progress value={strength * 25} size={4} mt={6} color={strength <= 1 ? 'red' : strength === 2 ? 'yellow' : 'teal'} aria-label={t('passwordStrength')} />
      </div>
      <PasswordInput
        label={t('confirmPassword')}
        required
        value={confirm}
        onChange={(e) => onConfirm(e.currentTarget.value)}
        error={mismatch ? t('passwordsDoNotMatch') : undefined}
        autoComplete="new-password"
      />
    </>
  );
};

export const validNewPassword = (value: string, confirm: string) => value.length >= 10 && value === confirm;

/** Current password plus a new one; the server ends other sessions and renews this one. */
export const ChangePasswordForm = ({ path, onDone, forced = false }: { path: '/auth/password' | '/platform/password'; onDone: () => void; forced?: boolean }) => {
  const { t, errorText } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api(path, { method: 'POST', body: { current_password: current, new_password: next } });
      notifySuccess(t('passwordChanged'));
      onDone();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack>
        {forced ? <Alert variant="light" color="yellow">{t('passwordChangeRequiredHint')}</Alert> : <Text size="sm" c="dimmed">{t('changePasswordHint')}</Text>}
        <PasswordInput label={forced ? t('yourTemporaryPassword') : t('currentPassword')} required value={current} onChange={(e) => setCurrent(e.currentTarget.value)} autoComplete="current-password" />
        <NewPasswordFields value={next} confirm={confirm} onChange={setNext} onConfirm={setConfirm} />
        <Button type="submit" loading={busy} disabled={!current || !validNewPassword(next, confirm)}>
          {t('changePassword')}
        </Button>
      </Stack>
    </form>
  );
};

export const ChangePasswordModal = ({ opened, onClose, path }: { opened: boolean; onClose: () => void; path: '/auth/password' | '/platform/password' }) => {
  const { t } = useI18n();
  return (
    <Modal opened={opened} onClose={onClose} title={t('changePassword')}>
      {opened && <ChangePasswordForm path={path} onDone={onClose} />}
    </Modal>
  );
};
