export const PERMISSIONS = [
  'admin.tenant',
  'admin.users',
  'admin.audit',
  'gl.master.view',
  'gl.master.manage',
  'gl.rates.manage',
  'gl.period.manage',
  'gl.period.unlock',
  'gl.journal.view',
  'gl.journal.create',
  'gl.journal.approve',
  'gl.journal.post',
  'gl.journal.reverse',
  'gl.report.view',
  'gl.budget.manage',
  'gl.close.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type SystemRoleCode = 'ADMIN' | 'CHIEF_ACCOUNTANT' | 'ACCOUNTANT' | 'VIEWER';

export const SYSTEM_ROLES: Record<SystemRoleCode, { name_ar: string; name_en: string; permissions: readonly Permission[] }> = {
  ADMIN: { name_ar: 'مدير النظام', name_en: 'Administrator', permissions: PERMISSIONS },
  CHIEF_ACCOUNTANT: {
    name_ar: 'رئيس الحسابات',
    name_en: 'Chief Accountant',
    permissions: [
      'gl.master.view',
      'gl.master.manage',
      'gl.rates.manage',
      'gl.period.manage',
      'gl.journal.view',
      'gl.journal.create',
      'gl.journal.approve',
      'gl.journal.post',
      'gl.journal.reverse',
      'gl.report.view',
      'gl.budget.manage',
      'gl.close.manage',
      'admin.audit',
    ],
  },
  ACCOUNTANT: {
    name_ar: 'محاسب',
    name_en: 'Accountant',
    permissions: ['gl.master.view', 'gl.rates.manage', 'gl.journal.view', 'gl.journal.create', 'gl.report.view'],
  },
  VIEWER: {
    name_ar: 'مستعرض',
    name_en: 'Viewer',
    permissions: ['gl.master.view', 'gl.journal.view', 'gl.report.view'],
  },
};
