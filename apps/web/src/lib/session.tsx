'use client';

import { featureForReport, featureForScreen, type FeatureKey, type Permission } from '@erp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/i18n';
import { api, setApiCompany } from './api';
import type { Me } from './types';

type Session = {
  me: Me | undefined;
  isLoading: boolean;
  error: unknown;
  company: Me['companies'][number] | undefined;
  selectCompany: (id: string) => void;
  can: (permission: Permission) => boolean;
  /** The module is in the tenant's subscription plan. */
  has: (feature: FeatureKey) => boolean;
  /** The screen (route) belongs to a module in the plan, or to no module. */
  screenOpen: (pathname: string) => boolean;
  reportOpen: (key: string) => boolean;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);
const COMPANY_KEY = 'erp_company';

const readStoredCompany = (): string | null => {
  try {
    return localStorage.getItem(COMPANY_KEY);
  } catch {
    return null;
  }
};

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const { setDigits, setLocale, locale } = useI18n();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false, staleTime: 60_000 });
  const [companyId, setCompanyId] = useState<string | null>(null);

  const me = meQuery.data;
  const company = me?.companies.find((c) => c.id === companyId) ?? me?.companies[0];

  // Keep the API header in sync before any company-scoped query runs.
  if (company) setApiCompany(company.id);

  useEffect(() => {
    if (!me) return;
    setDigits(me.user.digit_style);
    const stored = readStoredCompany();
    setCompanyId(me.companies.some((c) => c.id === stored) ? stored : (me.companies[0]?.id ?? null));
  }, [me, setDigits]);

  useEffect(() => {
    if (me && me.user.preferred_locale !== locale) {
      void api('/auth/preferences', { method: 'PATCH', body: { preferred_locale: locale } }).catch(() => undefined);
    }
  }, [locale, me]);

  useEffect(() => {
    if (me && !document.cookie.includes('erp_locale=')) setLocale(me.user.preferred_locale);
  }, [me, setLocale]);

  const selectCompany = useCallback(
    (id: string) => {
      try {
        localStorage.setItem(COMPANY_KEY, id);
      } catch {
        // storage unavailable: selection lasts for this page only
      }
      setApiCompany(id);
      setCompanyId(id);
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
    [queryClient],
  );

  const value = useMemo<Session>(
    () => ({
      me,
      isLoading: meQuery.isLoading,
      error: meQuery.error,
      company,
      selectCompany,
      can: (permission) => !!me?.permissions.includes(permission),
      has: (feature) => !!me?.features?.includes(feature),
      screenOpen: (pathname) => {
        const report = /^\/reports\/([^/]+)/.exec(pathname);
        const feature = report ? featureForReport(report[1] ?? '') : featureForScreen(pathname);
        return !feature || !!me?.features?.includes(feature);
      },
      reportOpen: (key) => {
        const feature = featureForReport(key);
        return !feature || !!me?.features?.includes(feature);
      },
      refresh: async () => {
        await queryClient.invalidateQueries();
      },
    }),
    [me, meQuery.isLoading, meQuery.error, company, selectCompany, queryClient],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = (): Session => {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
};
