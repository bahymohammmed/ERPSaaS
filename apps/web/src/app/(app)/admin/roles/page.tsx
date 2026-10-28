'use client';

import { ActionIcon, Badge, Button, Checkbox, Group, Modal, Paper, SimpleGrid, Stack, Table, TextInput } from '@mantine/core';
import { type Permission, PERMISSIONS } from '@erp/shared';
import { IconPencil, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';

type Role = { id?: string; code: string; name_ar: string; name_en: string; permissions: Permission[]; is_system?: boolean };

const RolesPage = () => {
  const { t, name, errorText } = useI18n();
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/admin/roles') });
  const [form, setForm] = useState<Role | null>(null);

  const save = async () => {
    if (!form) return;
    try {
      const { id, code, name_ar, name_en, permissions } = form;
      await api(id ? `/admin/roles/${id}` : '/admin/roles', { method: id ? 'PUT' : 'POST', body: { code, name_ar, name_en, permissions } });
      notifySuccess(t('saved'));
      setForm(null);
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title={t('navRoles')}
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setForm({ code: '', name_ar: '', name_en: '', permissions: [] })}>
            {t('add')}
          </Button>
        }
      />
      <Paper withBorder p="sm">
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('code')}</Table.Th>
              <Table.Th>{t('name')}</Table.Th>
              <Table.Th>{t('permissions')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td className="ltr">{r.code}</Table.Td>
                <Table.Td>
                  {name(r)}{' '}
                  {r.is_system && (
                    <Badge size="xs" variant="outline">
                      {t('systemType')}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {r.permissions.map((p) => (
                      <Badge key={p} size="xs" variant="light" className="ltr">
                        {p}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td>
                  {r.code !== 'ADMIN' && (
                    <ActionIcon variant="subtle" aria-label={t('edit')} onClick={() => setForm({ ...r })}>
                      <IconPencil size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? t('edit') : t('add')} size="lg">
        {form && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('code')} disabled={form.is_system} value={form.code} onChange={(e) => setForm({ ...form, code: e.currentTarget.value })} classNames={{ input: 'ltr' }} />
              <TextInput label={t('nameAr')} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.currentTarget.value })} dir="rtl" />
              <TextInput label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.currentTarget.value })} dir="ltr" />
            </SimpleGrid>
            <Checkbox.Group label={t('permissions')} value={form.permissions} onChange={(v) => setForm({ ...form, permissions: v as Permission[] })}>
              <SimpleGrid cols={{ base: 1, sm: 2 }} mt="xs">
                {PERMISSIONS.map((p) => (
                  <Checkbox key={p} value={p} label={<span className="ltr">{p}</span>} />
                ))}
              </SimpleGrid>
            </Checkbox.Group>
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

export default RolesPage;
