'use client';

import { Code, Paper, Select, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { PageHeader } from '@/components/common';
import { useI18n } from '@/i18n/i18n';
import { auditActionLabel } from '@/i18n/messages';
import { api } from '@/lib/api';

type AuditRow = { id: number; occurred_at: string; action: string; entity_type: string; entity_id: string | null; ip: string | null; user_name: string | null; old_data: unknown; new_data: unknown };

const ENTITY_TYPES = ['journal_entry', 'account', 'cost_center', 'fiscal_period', 'fiscal_year', 'exchange_rate', 'company', 'user', 'role', 'tenant'];

const AuditPage = () => {
  const { t, locale } = useI18n();
  const [entityType, setEntityType] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { data = [] } = useQuery({
    queryKey: ['audit', entityType],
    queryFn: () => api<AuditRow[]>('/admin/audit', { query: { entity_type: entityType ?? undefined, limit: 300 } }),
  });

  return (
    <>
      <PageHeader title={t('navAudit')} actions={<Select clearable placeholder={t('entity')} data={ENTITY_TYPES} value={entityType} onChange={setEntityType} w={200} />} />
      <Paper withBorder p="sm">
        <Table.ScrollContainer minWidth={800}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('time')}</Table.Th>
                <Table.Th>{t('user')}</Table.Th>
                <Table.Th>{t('action')}</Table.Th>
                <Table.Th>{t('entity')}</Table.Th>
                <Table.Th>IP</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((row) => (
                <Fragment key={row.id}>
                  <Table.Tr className="clickable" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                    <Table.Td className="num">{new Date(row.occurred_at).toLocaleString(locale === 'ar' ? 'ar-KW' : 'en-GB')}</Table.Td>
                    <Table.Td>{row.user_name}</Table.Td>
                    <Table.Td>{auditActionLabel(row.action, locale)}</Table.Td>
                    <Table.Td className="ltr">{row.entity_type}</Table.Td>
                    <Table.Td className="ltr">{row.ip}</Table.Td>
                  </Table.Tr>
                  {expanded === row.id && (
                    <Table.Tr>
                      <Table.Td colSpan={5}>
                        <Code block dir="ltr">
                          {JSON.stringify({ old: row.old_data, new: row.new_data }, null, 2)}
                        </Code>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Fragment>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {data.length === 0 && <Text c="dimmed">{t('noData')}</Text>}
      </Paper>
    </>
  );
};

export default AuditPage;
