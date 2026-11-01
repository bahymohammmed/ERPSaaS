'use client';

import { ActionIcon, Anchor, Drawer, Stack, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconHelpCircle } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { guideForPath } from '@/help/guides';
import { useI18n } from '@/i18n/i18n';
import { GuideView } from './GuideView';

/** Opens the user guide for the current screen. */
export const HelpButton = () => {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const [opened, { open, close }] = useDisclosure();
  const guide = guideForPath(pathname);

  return (
    <>
      <Tooltip label={t('help')}>
        <ActionIcon variant="subtle" size="lg" aria-label={t('help')} onClick={open}>
          <IconHelpCircle size={20} />
        </ActionIcon>
      </Tooltip>
      <Drawer opened={opened} onClose={close} title={t('userGuide')} position={locale === 'ar' ? 'left' : 'right'} size="md">
        <Stack>
          {guide && <GuideView guide={guide} />}
          <Anchor component={Link} href={guide ? `/help#${guide.id}` : '/help'} target="_blank" size="sm">
            {t('openGuide')}
          </Anchor>
        </Stack>
      </Drawer>
    </>
  );
};
