import { Center, Stack } from '@mantine/core';
import type { ReactNode } from 'react';
import { LanguageToggle } from '@/components/LanguageToggle';

const AuthLayout = ({ children }: { children: ReactNode }) => (
  <Center mih="100vh" p="md">
    <Stack w="100%" maw={520} gap="md">
      <LanguageToggle />
      {children}
    </Stack>
  </Center>
);

export default AuthLayout;
