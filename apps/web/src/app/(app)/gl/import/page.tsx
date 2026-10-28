'use client';

import { Badge, Button, Checkbox, FileButton, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconDownload, IconFileSpreadsheet } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import type { MessageKey } from '@/i18n/messages';
import { download, upload } from '@/lib/api';
import { useSession } from '@/lib/session';

type Result = { committed: boolean; total: number; errors: number; rows: { row: number; key: string; action: string; status: 'ok' | 'error'; message?: string }[] };

const ImportCard = ({ kind, title }: { kind: 'accounts' | 'journals'; title: MessageKey }) => {
  const { t, errorText } = useI18n();
  const { can, company } = useSession();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [post, setPost] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (commit: boolean) => {
    if (!file) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({ commit: String(commit), ...(kind === 'journals' ? { post: String(post) } : {}) });
      const res = await upload<Result>(`/gl/import/${kind}?${params}`, file);
      setResult(res);
      if (res.committed) {
        notifySuccess(t('saved'));
        await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === company?.id });
      }
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Title order={5}>{t(title)}</Title>
        <Button size="xs" variant="subtle" leftSection={<IconDownload size={14} />} onClick={() => download(`/gl/import/templates/${kind}`, undefined, `${kind}-template.xlsx`).catch((e: unknown) => notifyError(errorText(e)))}>
          {t('downloadTemplate')}
        </Button>
      </Group>
      <Stack gap="sm">
        <Group>
          <FileButton onChange={(f) => { setFile(f); setResult(null); }} accept=".xlsx">
            {(props) => (
              <Button variant="default" leftSection={<IconFileSpreadsheet size={16} />} {...props}>
                {t('chooseFile')}
              </Button>
            )}
          </FileButton>
          <Text size="sm">{file?.name}</Text>
        </Group>
        {kind === 'journals' && can('gl.journal.post') && <Checkbox label={t('postImported')} checked={post} onChange={(e) => { setPost(e.currentTarget.checked); setResult(null); }} />}
        <Group>
          <Button variant="light" disabled={!file} loading={busy} onClick={() => send(false)}>
            {t('preview')}
          </Button>
          <Button disabled={!result || result.errors > 0 || result.committed} loading={busy} onClick={() => send(true)}>
            {t('commitImport')}
          </Button>
        </Group>
        {result && (
          <>
            <Group gap="xs">
              <Badge color="teal" variant="light">
                {result.total - result.errors} {t('rowsOk')}
              </Badge>
              {result.errors > 0 && (
                <Badge color="red" variant="light">
                  {result.errors} {t('rowsWithErrors')}
                </Badge>
              )}
            </Group>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('row')}</Table.Th>
                  <Table.Th>{t('code')}</Table.Th>
                  <Table.Th>{t('action')}</Table.Th>
                  <Table.Th>{t('message')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.rows.map((r) => (
                  <Table.Tr key={`${r.row}-${r.key}`}>
                    <Table.Td className="num">{r.row}</Table.Td>
                    <Table.Td className="ltr">{r.key}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={r.status === 'ok' ? 'teal' : 'red'}>
                        {r.action}
                      </Badge>
                    </Table.Td>
                    <Table.Td dir="ltr">{r.message ?? ''}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </>
        )}
      </Stack>
    </Paper>
  );
};

const ImportPage = () => {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('navImport')} />
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <ImportCard kind="accounts" title="importAccounts" />
        <ImportCard kind="journals" title="importJournals" />
      </SimpleGrid>
    </>
  );
};

export default ImportPage;
