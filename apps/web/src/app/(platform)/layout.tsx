'use client';

import { AppShell, Badge, Center, Group, Loader, Menu, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronDown, IconShieldCheck } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { Brand } from '@/components/Brand';
import { HelpButton } from '@/components/HelpButton';
import { LanguageToggle } from '@/components/LanguageToggle';
import { MfaModal } from '@/components/MfaModal';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useI18n } from '@/i18n/i18n';
import { api, ApiError } from '@/lib/api';

export type PlatformMe = { user: { id: string; email: string; full_name: string; mfa_enabled: boolean } };

/** Shell for the SaaS operator's console; it has no tenant or company context. */
const PlatformLayout = ({ children }: { children: ReactNode }) => {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mfaOpened, { open: openMfa, close: closeMfa }] = useDisclosure();
  const me = useQuery({ queryKey: ['platform-me'], queryFn: () => api<PlatformMe>('/platform/me'), retry: false });

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace('/login');
  }, [me.error, router]);

  if (!me.data) {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    );
  }

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    queryClient.clear();
    router.replace('/login');
  };

  return (
    <AppShell header={{ height: 60 }} padding={{ base: 'md', md: 'lg' }}>
      <AppShell.Header className="glass">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Brand name={t('appName')} />
            <Badge variant="light" visibleFrom="sm">
              {t('platformConsole')}
            </Badge>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <HelpButton />
            <ThemeToggle />
            <LanguageToggle />
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <UnstyledButton>
                  <Group gap={4} wrap="nowrap">
                    <Text size="sm" visibleFrom="sm">
                      {me.data.user.full_name}
                    </Text>
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label className="ltr">{me.data.user.email}</Menu.Label>
                <Menu.Item leftSection={<IconShieldCheck size={14} />} onClick={openMfa}>
                  {t('twoFactor')}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" onClick={logout}>
                  {t('signOut')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>
      <MfaModal opened={mfaOpened} enabled={me.data.user.mfa_enabled} onClose={closeMfa} basePath="/platform/mfa" sessionKey="platform-me" />
      <AppShell.Main>
        <div className="page-enter">{children}</div>
      </AppShell.Main>
    </AppShell>
  );
};

export default PlatformLayout;
