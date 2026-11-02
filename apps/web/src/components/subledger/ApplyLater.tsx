'use client';

import { ActionIcon, Button, Group, Modal, Stack, TextInput, Tooltip } from '@mantine/core';
import type { LedgerSide } from '@erp/shared';
import { IconArrowBackUp, IconLink } from '@tabler/icons-react';
import { useState } from 'react';
import { notifyError, notifySuccess } from '@/components/notify';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { AllocationTable, type AllocationMap, toAllocations } from './AllocationTable';

const today = () => new Date().toISOString().slice(0, 10);

/** Applies the unapplied part of a posted receipt / payment or note to open invoices. */
export const ApplyButton = ({
  side,
  partyId,
  sourceType,
  sourceId,
  open,
  minor,
  onDone,
}: {
  side: LedgerSide;
  partyId: string;
  sourceType: 'SETTLEMENT' | 'DOCUMENT';
  sourceId: string;
  open: number;
  minor: number;
  onDone: () => Promise<unknown>;
}) => {
  const { t, errorText } = useI18n();
  const [opened, setOpened] = useState(false);
  const [value, setValue] = useState<AllocationMap>({});
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    setBusy(true);
    try {
      const result = await api<{ fx_difference: string }>(`/sl/${side}/allocations`, { method: 'POST', body: { source_type: sourceType, source_id: sourceId, date, allocations: toAllocations(value) } });
      notifySuccess(Number(result.fx_difference) !== 0 ? `${t('saved')} · ${t('fxDifference')}: ${result.fx_difference}` : t('saved'));
      setOpened(false);
      setValue({});
      await onDone();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="light" leftSection={<IconLink size={16} />} onClick={() => setOpened(true)}>
        {t('applyToInvoices')}
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title={t('applyToInvoices')} size="xl">
        <Stack>
          <TextInput type="date" label={t('allocationDate')} description={t('allocationDateHint')} value={date} onChange={(e) => setDate(e.currentTarget.value)} maw={220} />
          <AllocationTable side={side} partyId={partyId} total={open} value={value} onChange={setValue} minor={minor} />
          <Group justify="flex-end">
            <Button onClick={apply} loading={busy} disabled={toAllocations(value).length === 0}>
              {t('apply')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

/** Takes one allocation back off its invoice. */
export const RemoveAllocationButton = ({ side, allocationId, onDone }: { side: LedgerSide; allocationId: string; onDone: () => Promise<unknown> }) => {
  const { t, errorText } = useI18n();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    const date = window.prompt(t('unallocatePrompt'), today());
    if (!date) return;
    setBusy(true);
    try {
      await api(`/sl/${side}/allocations/${allocationId}/remove`, { method: 'POST', body: { date } });
      notifySuccess(t('saved'));
      await onDone();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tooltip label={t('unallocate')}>
      <ActionIcon variant="subtle" color="red" onClick={remove} loading={busy} aria-label={t('unallocate')}>
        <IconArrowBackUp size={16} />
      </ActionIcon>
    </Tooltip>
  );
};
