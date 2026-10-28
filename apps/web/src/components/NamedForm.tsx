'use client';

import { Button, Checkbox, Group, Modal, SimpleGrid, Stack, TextInput } from '@mantine/core';
import { useState } from 'react';
import { useI18n } from '@/i18n/i18n';

export type NamedValues = { code: string; name_ar: string; name_en: string; is_active: boolean };

/** Modal editor for records that are just code + bilingual names + active flag. */
export const NamedFormModal = ({
  opened,
  initial,
  title,
  codeLocked,
  onClose,
  onSave,
}: {
  opened: boolean;
  initial: NamedValues;
  title: string;
  codeLocked?: boolean;
  onClose: () => void;
  onSave: (values: NamedValues) => Promise<void>;
}) => {
  const { t } = useI18n();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof NamedValues>(key: K, value: NamedValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await onSave(values);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label={t('code')} required disabled={codeLocked} value={values.code} onChange={(e) => set('code', e.currentTarget.value)} classNames={{ input: 'ltr' }} />
          <TextInput label={t('nameAr')} value={values.name_ar} onChange={(e) => set('name_ar', e.currentTarget.value)} dir="rtl" />
          <TextInput label={t('nameEn')} value={values.name_en} onChange={(e) => set('name_en', e.currentTarget.value)} dir="ltr" />
        </SimpleGrid>
        <Checkbox label={t('active')} checked={values.is_active} onChange={(e) => set('is_active', e.currentTarget.checked)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={save} loading={saving}>
            {t('save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export const EMPTY_NAMED: NamedValues = { code: '', name_ar: '', name_en: '', is_active: true };
