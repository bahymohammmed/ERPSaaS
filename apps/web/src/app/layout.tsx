import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './globals.css';
import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata: Metadata = { title: 'ERP — General Ledger', description: 'Multi-tenant ERP general ledger' };

const RootLayout = async ({ children }: { children: ReactNode }) => {
  const locale = (await cookies()).get('erp_locale')?.value === 'en' ? 'en' : 'ar';
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="light" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
};

export default RootLayout;
