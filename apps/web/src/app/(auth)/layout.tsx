import { Center, Group, Stack } from '@mantine/core';
import type { ReactNode } from 'react';
import { HelpButton } from '@/components/HelpButton';
import { LanguageToggle } from '@/components/LanguageToggle';

const AuthLayout = ({ children }: { children: ReactNode }) => (
  <Center mih="100vh" p="md">
    <Stack w="100%" maw={520} gap="md">
      <Group gap="xs">
        <LanguageToggle />
        <HelpButton />
      </Group>
      {children}
    </Stack>
  </Center>
);

export default AuthLayout;
