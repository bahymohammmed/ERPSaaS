'use client';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import type { Locale } from '@erp/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { I18nProvider } from '@/i18n/i18n';
import { theme } from './theme';

export const Providers = ({ locale, children }: { locale: Locale; children: ReactNode }) => {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale={locale}>
        <MantineProvider theme={theme} defaultColorScheme="light">
          <Notifications position="top-center" />
          {children}
        </MantineProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
};
