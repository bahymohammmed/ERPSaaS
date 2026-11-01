'use client';

import { ActionIcon, SegmentedControl, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import { useI18n } from '@/i18n/i18n';

/** One-click light / dark switch; the icon spins in on change. */
export const ThemeToggle = () => {
  const { t } = useI18n();
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const dark = computed === 'dark';
  return (
    <Tooltip label={t('toggleTheme')}>
      <ActionIcon variant="subtle" color="gray" size="lg" aria-label={t('toggleTheme')} onClick={() => setColorScheme(dark ? 'light' : 'dark')}>
        {dark ? <IconSun key="sun" size={19} className="icon-swap" /> : <IconMoon key="moon" size={19} className="icon-swap" />}
      </ActionIcon>
    </Tooltip>
  );
};

/** Light / dark / follow the operating system. */
export const ThemePicker = () => {
  const { t } = useI18n();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <SegmentedControl
      size="xs"
      fullWidth
      value={colorScheme}
      onChange={(v) => setColorScheme(v === 'dark' ? 'dark' : v === 'light' ? 'light' : 'auto')}
      data={[
        { value: 'light', label: <IconSun size={14} aria-label={t('themeLight')} /> },
        { value: 'dark', label: <IconMoon size={14} aria-label={t('themeDark')} /> },
        { value: 'auto', label: <IconDeviceDesktop size={14} aria-label={t('themeAuto')} /> },
      ]}
    />
  );
};
