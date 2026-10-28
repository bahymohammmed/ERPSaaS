'use client';

import { ActionIcon, Badge, Button, Paper, Table } from '@mantine/core';
import { IconPencil, IconPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { EMPTY_NAMED, NamedFormModal, type NamedValues } from '@/components/NamedForm';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { useJournalTypes } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { JournalType } from '@/lib/types';

const JournalTypesPage = () => {
  const { t, name, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const { data = [] } = useJournalTypes();
  const [editing, setEditing] = useState<{ id?: string; values: NamedValues; system?: boolean } | null>(null);

  const save = async (values: NamedValues) => {
    try {
      await api(editing?.id ? `/gl/journal-types/${editing.id}` : '/gl/journal-types', { method: editing?.id ? 'PUT' : 'POST', body: values });
      notifySuccess(t('saved'));
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: [company?.id, 'journal-types'] });
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  const edit = (jt: JournalType) => setEditing({ id: jt.id, system: jt.is_system, values: { code: jt.code, name_ar: jt.name_ar, name_en: jt.name_en, is_active: jt.is_active } });

  return (
    <>
      <PageHeader
        title={t('navJournalTypes')}
        actions={
          can('gl.master.manage') && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ values: EMPTY_NAMED })}>
              {t('add')}
            </Button>
          )
        }
      />
      <Paper withBorder p="sm">
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('code')}</Table.Th>
              <Table.Th>{t('name')}</Table.Th>
              <Table.Th>{t('sourceModule')}</Table.Th>
              <Table.Th>{t('status')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.map((jt) => (
              <Table.Tr key={jt.id}>
                <Table.Td className="ltr">{jt.code}</Table.Td>
                <Table.Td>
                  {name(jt)}{' '}
                  {jt.is_system && (
                    <Badge size="xs" variant="outline">
                      {t('systemType')}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{jt.source_module}</Table.Td>
                <Table.Td>{jt.is_active ? t('active') : t('inactive')}</Table.Td>
                <Table.Td>
                  {can('gl.master.manage') && (
                    <ActionIcon variant="subtle" onClick={() => edit(jt)} aria-label={t('edit')}>
                      <IconPencil size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      {editing && (
        <NamedFormModal opened title={editing.id ? t('edit') : t('add')} initial={editing.values} codeLocked={editing.system} onClose={() => setEditing(null)} onSave={save} />
      )}
    </>
  );
};

export default JournalTypesPage;
