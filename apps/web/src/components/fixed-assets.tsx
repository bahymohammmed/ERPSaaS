'use client';

import { Badge } from '@mantine/core';
import { type AssetStatus, DEPRECIATION_METHODS } from '@erp/shared';
import { useI18n } from '@/i18n/i18n';
import { useCompanyQuery } from '@/lib/queries';
import type { FaCategory } from '@/lib/types';

const STATUS_COLORS: Record<AssetStatus, string> = { DRAFT: 'gray', ACTIVE: 'teal', FULLY_DEPRECIATED: 'blue', DISPOSED: 'red' };

export const AssetStatusBadge = ({ status }: { status: AssetStatus }) => {
  const { t } = useI18n();
  return (
    <Badge variant="light" color={STATUS_COLORS[status]}>
      {t(`assetStatus${status}`)}
    </Badge>
  );
};

export const useFaCategories = () => useCompanyQuery<FaCategory[]>(['fa-categories'], '/fa/categories');

export const useMethodOptions = () => {
  const { t } = useI18n();
  return DEPRECIATION_METHODS.map((m) => ({ value: m, label: t(`method${m}`) }));
};
