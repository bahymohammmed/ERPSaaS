'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';
import type { Account, CostCenter, Currency, DimensionType, FiscalYear, JournalType, Period, Template } from './types';

/** Company-scoped query: keyed by company and disabled until a company is selected. */
export const useCompanyQuery = <T,>(key: readonly unknown[], path: string, query?: Record<string, string | number | boolean | undefined>) => {
  const { company } = useSession();
  return useQuery({
    queryKey: [company?.id, ...key, query],
    queryFn: () => api<T>(path, { query }),
    enabled: !!company,
  });
};

export const useAccounts = () => useCompanyQuery<Account[]>(['accounts'], '/gl/accounts');
export const useCostCenters = () => useCompanyQuery<CostCenter[]>(['cost-centers'], '/gl/cost-centers');
export const useJournalTypes = () => useCompanyQuery<JournalType[]>(['journal-types'], '/gl/journal-types');
export const usePeriods = () => useCompanyQuery<Period[]>(['periods'], '/gl/periods');
export const useFiscalYears = () => useCompanyQuery<FiscalYear[]>(['fiscal-years'], '/gl/fiscal-years');
export const useCurrencies = () => useCompanyQuery<Currency[]>(['currencies'], '/gl/currencies');
export const useDimensions = () => useCompanyQuery<DimensionType[]>(['dimensions'], '/gl/dimensions');
export const useTemplates = () => useCompanyQuery<Template[]>(['templates'], '/gl/distribution-templates');
