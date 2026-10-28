'use client';

import { ActionIcon, Alert, Badge, Button, Checkbox, Code, Group, Modal, MultiSelect, Paper, PasswordInput, Select, Stack, Table, TextInput } from '@mantine/core';
import { IconPencil, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useCostCenters } from '@/lib/queries';

type Member = {
  user_id: string;
  email: string;
  full_name: string;
  last_login_at: string | null;
  is_active: boolean;
  role_id: string;
  role_name_ar: string;
  role_name_en: string;
  cost_center_scope: string[] | null;
  mfa_enabled: boolean;
};
type Role = { id: string; code: string; name_ar: string; name_en: string };
type Form = { user_id?: string; email: string; full_name: string; password: string; role_id: string | null; is_active: boolean; cost_center_scope: string[] };

const UsersPage = () => {
  const { t, name, errorText, locale } = useI18n();
  const queryClient = useQueryClient();
  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: () => api<Member[]>('/admin/users') });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/admin/roles') });
  const { data: costCenters = [] } = useCostCenters();
  const [form, setForm] = useState<Form | null>(null);
  const [temporary, setTemporary] = useState<string | null>(null);

  const resetMfa = async (userId: string) => {
    if (!window.confirm(t('resetMfa'))) return;
    try {
      await api(`/admin/users/${userId}/mfa-reset`, { method: 'POST' });
      notifySuccess(t('saved'));
      await queryClient.invalidateQueries({ queryKey: ['members'] });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const save = async () => {
    if (!form) return;
    try {
      if (form.user_id) {
        await api(`/admin/users/${form.user_id}`, { method: 'PATCH', body: { role_id: form.role_id, is_active: form.is_active, cost_center_scope: form.cost_center_scope } });
      } else {
        const result = await api<{ temporary_password: string | null }>('/admin/users', {
          method: 'POST',
          body: { email: form.email, full_name: form.full_name, password: form.password || undefined, role_id: form.role_id, cost_center_scope: form.cost_center_scope },
        });
        setTemporary(result.temporary_password);
      }
      notifySuccess(t('saved'));
      setForm(null);
      await queryClient.invalidateQueries({ queryKey: ['members'] });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title={t('navUsers')}
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setForm({ email: '', full_name: '', password: '', role_id: roles.find((r) => r.code === 'ACCOUNTANT')?.id ?? null, is_active: true, cost_center_scope: [] })}>
            {t('inviteUser')}
          </Button>
        }
      />
      {temporary && (
        <Alert color="yellow" withCloseButton onClose={() => setTemporary(null)} mb="md" title={t('temporaryPassword')}>
          <Code>{temporary}</Code>
        </Alert>
      )}
      <Paper withBorder p="sm">
        <Table.ScrollContainer minWidth={700}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('fullName')}</Table.Th>
                <Table.Th>{t('email')}</Table.Th>
                <Table.Th>{t('role')}</Table.Th>
                <Table.Th>{t('costCenterScope')}</Table.Th>
                <Table.Th>{t('lastLogin')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {members.map((m) => (
                <Table.Tr key={m.user_id}>
                  <Table.Td>{m.full_name}</Table.Td>
                  <Table.Td className="ltr">{m.email}</Table.Td>
                  <Table.Td>{locale === 'ar' ? m.role_name_ar : m.role_name_en}</Table.Td>
                  <Table.Td>{m.cost_center_scope?.map((id) => costCenters.find((c) => c.id === id)?.code ?? '?').join(', ') ?? t('all')}</Table.Td>
                  <Table.Td className="num">{m.last_login_at ? new Date(m.last_login_at).toLocaleString(locale === 'ar' ? 'ar-KW' : 'en-GB') : '—'}</Table.Td>
                  <Table.Td>
                    {m.is_active ? t('active') : t('inactive')}
                    {m.mfa_enabled && (
                      <Badge size="xs" ms={6} color="teal" variant="light">
                        2FA
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      aria-label={t('edit')}
                      onClick={() => setForm({ user_id: m.user_id, email: m.email, full_name: m.full_name, password: '', role_id: m.role_id, is_active: m.is_active, cost_center_scope: m.cost_center_scope ?? [] })}
                    >
                      <IconPencil size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.user_id ? t('edit') : t('inviteUser')}>
        {form && (
          <Stack>
            <TextInput label={t('email')} type="email" required disabled={!!form.user_id} value={form.email} onChange={(e) => setForm({ ...form, email: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
            <TextInput label={t('fullName')} required disabled={!!form.user_id} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.currentTarget.value })} />
            {!form.user_id && <PasswordInput label={t('password')} description={t('temporaryPassword')} value={form.password} onChange={(e) => setForm({ ...form, password: e.currentTarget.value })} />}
            <Select label={t('role')} data={roles.map((r) => ({ value: r.id, label: name(r) }))} value={form.role_id} onChange={(v) => setForm({ ...form, role_id: v })} allowDeselect={false} />
            <MultiSelect
              label={t('costCenterScope')}
              searchable
              clearable
              data={costCenters.map((c) => ({ value: c.id, label: `${c.code} — ${name(c)}` }))}
              value={form.cost_center_scope}
              onChange={(v) => setForm({ ...form, cost_center_scope: v })}
            />
            {form.user_id && members.find((m) => m.user_id === form.user_id)?.mfa_enabled && (
              <Button variant="light" color="orange" onClick={() => resetMfa(form.user_id as string)}>
                {t('resetMfa')}
              </Button>
            )}
            {form.user_id && <Checkbox label={t('active')} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })} />}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setForm(null)}>
                {t('cancel')}
              </Button>
              <Button onClick={save}>{t('save')}</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
};

export default UsersPage;
