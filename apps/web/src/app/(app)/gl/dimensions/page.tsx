'use client';

import { ActionIcon, Badge, Button, Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconPencil, IconPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { EMPTY_NAMED, NamedFormModal, type NamedValues } from '@/components/NamedForm';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useDimensions } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Editing = { kind: 'type' | 'value'; id?: string; typeId?: string; values: NamedValues };

const DimensionsPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const { data = [] } = useDimensions();
  const [editing, setEditing] = useState<Editing | null>(null);
  const canManage = can('gl.master.manage');

  const save = async (values: NamedValues) => {
    if (!editing) return;
    try {
      if (editing.kind === 'type') {
        await api(editing.id ? `/gl/dimensions/${editing.id}` : '/gl/dimensions', { method: editing.id ? 'PUT' : 'POST', body: values });
      } else {
        await api(editing.id ? `/gl/dimension-values/${editing.id}` : '/gl/dimension-values', {
          method: editing.id ? 'PUT' : 'POST',
          body: { ...values, dimension_type_id: editing.typeId },
        });
      }
      notifySuccess(t('saved'));
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: [company?.id, 'dimensions'] });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title={t('navDimensions')}
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ kind: 'type', values: EMPTY_NAMED })}>
              {t('add')}
            </Button>
          )
        }
      />
      {data.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {data.map((d) => (
          <Card key={d.id} withBorder>
            <Group justify="space-between" mb="sm">
              <Group gap="xs">
                <Text fw={700}>{name(d)}</Text>
                <Badge variant="light" className="ltr">
                  {d.code}
                </Badge>
              </Group>
              {canManage && (
                <Group gap={4}>
                  <ActionIcon variant="subtle" aria-label={t('edit')} onClick={() => setEditing({ kind: 'type', id: d.id, values: { code: d.code, name_ar: d.name_ar, name_en: d.name_en, is_active: d.is_active } })}>
                    <IconPencil size={16} />
                  </ActionIcon>
                  <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEditing({ kind: 'value', typeId: d.id, values: EMPTY_NAMED })}>
                    {t('newValue')}
                  </Button>
                </Group>
              )}
            </Group>
            <Stack gap={4}>
              {d.values.map((v) => (
                <Group key={v.id} justify="space-between">
                  <Text size="sm" c={v.is_active ? undefined : 'dimmed'}>
                    <span className="ltr">{v.code}</span> — {name(v)}
                  </Text>
                  {canManage && (
                    <ActionIcon size="sm" variant="subtle" aria-label={t('edit')} onClick={() => setEditing({ kind: 'value', id: v.id, typeId: d.id, values: { code: v.code, name_ar: v.name_ar, name_en: v.name_en, is_active: v.is_active } })}>
                      <IconPencil size={14} />
                    </ActionIcon>
                  )}
                </Group>
              ))}
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      {editing && <NamedFormModal opened title={editing.id ? t('edit') : t('add')} initial={editing.values} onClose={() => setEditing(null)} onSave={save} />}
    </>
  );
};

export default DimensionsPage;
