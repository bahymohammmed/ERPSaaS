'use client';

import { Box, Group, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconChartPie, IconLanguage, IconShieldLock } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { Brand } from '@/components/Brand';
import { HelpButton } from '@/components/HelpButton';
import { LanguageToggle } from '@/components/LanguageToggle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useI18n } from '@/i18n/i18n';

/** Split screen: brand story on one side (desktop), the form on the other. */
const AuthLayout = ({ children }: { children: ReactNode }) => {
  const { t } = useI18n();
  const features = [
    { icon: IconLanguage, text: t('loginFeature1') },
    { icon: IconChartPie, text: t('loginFeature2') },
    { icon: IconShieldLock, text: t('loginFeature3') },
  ];
  return (
    <Box mih="100vh" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' }} className="auth-grid">
      <Box className="auth-hero" visibleFrom="md" p={56}>
        <Stack justify="space-between" h="100%" style={{ position: 'relative', zIndex: 1 }}>
          <Stack gap={4}>
            <Brand inverse />
            <Text size="sm" style={{ opacity: 0.85 }}>
              {t('appTagline')}
            </Text>
          </Stack>
          <Stack gap="xl" maw={460} className="stagger">
            <Title order={1} fz={38} lh={1.2} style={{ letterSpacing: '-0.02em' }}>
              {t('loginTagline')}
            </Title>
            {features.map(({ icon: Icon, text }) => (
              <Group key={text} gap="md" wrap="nowrap" align="flex-start">
                <ThemeIcon size={40} radius="md" variant="white" color="brand" style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }}>
                  <Icon size={20} />
                </ThemeIcon>
                <Text size="md" style={{ opacity: 0.92 }}>
                  {text}
                </Text>
              </Group>
            ))}
          </Stack>
          <Box className="float" style={{ alignSelf: 'flex-end', opacity: 0.9 }} aria-hidden>
            <svg width="220" height="120" viewBox="0 0 220 120">
              {[38, 64, 52, 80, 70, 96].map((h, i) => (
                <rect key={i} className="bar" x={10 + i * 34} y={110 - h} width="20" height={h} rx="5" fill="rgba(255,255,255,0.35)" style={{ animationDelay: `${300 + i * 80}ms` }} />
              ))}
              <path d="M20 70 L54 52 L88 60 L122 34 L156 42 L190 18" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Box>
        </Stack>
      </Box>
      <Stack justify="center" align="center" p="md" style={{ position: 'relative' }}>
        <Group gap={4} style={{ position: 'absolute', top: 16, insetInlineEnd: 16 }}>
          <HelpButton />
          <ThemeToggle />
          <LanguageToggle />
        </Group>
        <Box hiddenFrom="md" mb="md">
          <Brand name={t('appName')} />
        </Box>
        <Box w="100%" maw={440} className="page-enter">
          {children}
        </Box>
      </Stack>
    </Box>
  );
};

export default AuthLayout;
