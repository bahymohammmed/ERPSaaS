/**
 * Every business failure is returned as { error: { code, params } }.
 * Clients translate the code; the API never sends hard-coded prose.
 */
export const ERROR_MESSAGES = {
  VALIDATION_FAILED: { en: 'Some fields are invalid', ar: 'بعض الحقول غير صحيحة' },
  UNAUTHENTICATED: { en: 'Please sign in', ar: 'يرجى تسجيل الدخول' },
  FORBIDDEN: { en: 'You do not have permission for this action', ar: 'ليس لديك صلاحية لتنفيذ هذا الإجراء' },
  NOT_FOUND: { en: '{entity} not found', ar: '{entity} غير موجود' },
  INVALID_CREDENTIALS: { en: 'Invalid email or password', ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' },
  EMAIL_TAKEN: { en: 'This email is already registered', ar: 'هذا البريد الإلكتروني مسجل مسبقاً' },
  DUPLICATE_CODE: { en: 'Code {code} already exists', ar: 'الرمز {code} موجود مسبقاً' },
  COMPANY_REQUIRED: { en: 'Select a company first', ar: 'يرجى اختيار الشركة أولاً' },
  COMPANY_INACTIVE: { en: 'The company is inactive', ar: 'الشركة غير نشطة' },
  PLAN_LIMIT_REACHED: { en: 'Your plan limit for {resource} has been reached', ar: 'تم بلوغ الحد المسموح في الباقة لـ {resource}' },
  CONCURRENT_MODIFICATION: { en: 'The record was changed by another user; reload and retry', ar: 'تم تعديل السجل من مستخدم آخر، يرجى إعادة التحميل والمحاولة' },

  ACCOUNT_PARENT_TYPE_MISMATCH: { en: 'Account type must match the parent account type', ar: 'نوع الحساب يجب أن يطابق نوع الحساب الأب' },
  ACCOUNT_PARENT_NOT_HEADER: { en: 'The parent account must be a header account', ar: 'الحساب الأب يجب أن يكون حساباً تجميعياً' },
  ACCOUNT_HAS_TRANSACTIONS: { en: 'Account {code} has transactions; this change is not allowed', ar: 'الحساب {code} عليه حركات؛ لا يمكن إجراء هذا التعديل' },
  ACCOUNT_HAS_CHILDREN: { en: 'Account {code} has sub-accounts', ar: 'الحساب {code} له حسابات فرعية' },
  HIERARCHY_CYCLE: { en: 'A record cannot be its own ancestor', ar: 'لا يمكن أن يكون السجل أباً لنفسه' },
  COST_CENTER_PARENT_NOT_HEADER: { en: 'The parent cost center must be a header', ar: 'مركز التكلفة الأب يجب أن يكون تجميعياً' },
  COST_CENTER_HAS_TRANSACTIONS: { en: 'Cost center {code} has transactions; this change is not allowed', ar: 'مركز التكلفة {code} عليه حركات؛ لا يمكن إجراء هذا التعديل' },
  COST_CENTER_HAS_CHILDREN: { en: 'Cost center {code} has sub cost centers', ar: 'مركز التكلفة {code} له مراكز فرعية' },
  DISTRIBUTION_NOT_100: { en: 'Distribution percentages must total 100%', ar: 'يجب أن يكون مجموع نسب التوزيع 100%' },
  DISTRIBUTION_AMOUNTS_MISMATCH: { en: 'Line {line}: distributed amounts must equal the line amount', ar: 'السطر {line}: مجموع المبالغ الموزعة يجب أن يساوي مبلغ السطر' },

  FISCAL_YEAR_OVERLAP: { en: 'The fiscal year overlaps an existing year', ar: 'السنة المالية تتداخل مع سنة موجودة' },
  FISCAL_YEAR_HAS_ENTRIES: { en: 'The fiscal year has journal entries', ar: 'السنة المالية عليها قيود' },
  PERIOD_NOT_FOUND: { en: 'No fiscal period exists for {date}', ar: 'لا توجد فترة مالية للتاريخ {date}' },
  PERIOD_NOT_OPEN: { en: 'Period {period} is {status} for {module}', ar: 'الفترة {period} حالتها {status} لوحدة {module}' },
  PERIOD_LOCKED: { en: 'Period {period} is locked', ar: 'الفترة {period} مقفلة نهائياً' },
  PERIOD_HAS_UNPOSTED: { en: 'Period {period} has {count} unposted entries', ar: 'الفترة {period} عليها {count} قيود غير مرحلة' },
  ADJUSTMENT_PERIOD_DATE: { en: 'Entries in an adjustment period must be dated on the fiscal year end', ar: 'قيود فترة التسويات يجب أن تكون بتاريخ نهاية السنة المالية' },

  RATE_NOT_FOUND: { en: 'No exchange rate for {currency} on or before {date}', ar: 'لا يوجد سعر صرف للعملة {currency} في أو قبل {date}' },
  CURRENCY_INACTIVE: { en: 'Currency {currency} is not active', ar: 'العملة {currency} غير مفعلة' },

  JOURNAL_NOT_EDITABLE: { en: 'Only draft entries can be edited', ar: 'يمكن تعديل القيود المسودة فقط' },
  JOURNAL_INVALID_TRANSITION: { en: 'Cannot {action} an entry with status {status}', ar: 'لا يمكن تنفيذ {action} على قيد حالته {status}' },
  JOURNAL_SELF_APPROVAL: { en: 'The creator of an entry cannot approve it', ar: 'لا يمكن لمنشئ القيد اعتماده' },
  JOURNAL_APPROVAL_REQUIRED: { en: 'This entry must be approved before posting', ar: 'يجب اعتماد القيد قبل الترحيل' },
  JOURNAL_TOO_FEW_LINES: { en: 'An entry needs at least two lines', ar: 'القيد يحتاج سطرين على الأقل' },
  JOURNAL_UNBALANCED: { en: 'Entry is not balanced: debit {debit}, credit {credit}', ar: 'القيد غير متوازن: مدين {debit}، دائن {credit}' },
  JOURNAL_LINE_AMOUNT: { en: 'Line {line}: enter either a debit or a credit greater than zero', ar: 'السطر {line}: أدخل مبلغاً مديناً أو دائناً أكبر من صفر' },
  JOURNAL_LINE_PRECISION: { en: 'Line {line}: {currency} allows {minor} decimal places', ar: 'السطر {line}: العملة {currency} تسمح بـ {minor} منازل عشرية' },
  JOURNAL_SYSTEM_TYPE: { en: 'Journal type {code} is reserved for system postings', ar: 'نوع القيد {code} مخصص للترحيل الآلي' },
  JOURNAL_ALREADY_REVERSED: { en: 'This entry has already been reversed', ar: 'تم عكس هذا القيد مسبقاً' },
  POSTED_IMMUTABLE: { en: 'Posted entries cannot be changed; reverse them instead', ar: 'لا يمكن تعديل القيود المرحلة؛ استخدم القيد العكسي' },

  LINE_ACCOUNT_INVALID: { en: 'Line {line}: account {code} is inactive or not a posting account', ar: 'السطر {line}: الحساب {code} غير نشط أو ليس حساب ترحيل' },
  LINE_ACCOUNT_CURRENCY: { en: 'Line {line}: account {code} does not accept {currency}', ar: 'السطر {line}: الحساب {code} لا يقبل العملة {currency}' },
  LINE_CONTROL_ACCOUNT: { en: 'Line {line}: account {code} is a control account for {module}', ar: 'السطر {line}: الحساب {code} حساب مراقبة خاص بوحدة {module}' },
  LINE_COST_CENTER_REQUIRED: { en: 'Line {line}: account {code} requires a cost center', ar: 'السطر {line}: الحساب {code} يتطلب مركز تكلفة' },
  LINE_COST_CENTER_NOT_ALLOWED: { en: 'Line {line}: account {code} does not accept a cost center', ar: 'السطر {line}: الحساب {code} لا يقبل مركز تكلفة' },
  LINE_COST_CENTER_INVALID: { en: 'Line {line}: cost center {code} is inactive, a header, or outside its validity dates', ar: 'السطر {line}: مركز التكلفة {code} غير نشط أو تجميعي أو خارج فترة صلاحيته' },
  LINE_COST_CENTER_RESTRICTED: { en: 'Line {line}: cost center {code} is not allowed for account {account}', ar: 'السطر {line}: مركز التكلفة {code} غير مسموح للحساب {account}' },
  LINE_DIMENSION_REQUIRED: { en: 'Line {line}: account {code} requires {dimension}', ar: 'السطر {line}: الحساب {code} يتطلب {dimension}' },
  LINE_DIMENSION_NOT_ALLOWED: { en: 'Line {line}: account {code} does not accept {dimension}', ar: 'السطر {line}: الحساب {code} لا يقبل {dimension}' },
  LINE_DIMENSION_INVALID: { en: 'Line {line}: dimension value is inactive or invalid', ar: 'السطر {line}: قيمة البعد غير نشطة أو غير صحيحة' },
  ROUNDING_ACCOUNT_MISSING: { en: 'Set a rounding account on the company to post currency rounding differences', ar: 'حدد حساب فروقات التقريب في إعدادات الشركة' },
  OUT_OF_SCOPE: { en: 'This record is outside your cost center access', ar: 'هذا السجل خارج صلاحيات مراكز التكلفة الخاصة بك' },
  INTERNAL: { en: 'Unexpected error', ar: 'حدث خطأ غير متوقع' },
} as const satisfies Record<string, { en: string; ar: string }>;

export type ErrorCode = keyof typeof ERROR_MESSAGES;
export type ErrorParams = Record<string, string | number>;

export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    params?: ErrorParams;
    /** Field-level issues for VALIDATION_FAILED. */
    issues?: { path: string; message: string }[];
  };
};

export const translateError = (code: ErrorCode, locale: 'ar' | 'en', params: ErrorParams = {}): string => {
  const template: string = ERROR_MESSAGES[code]?.[locale] ?? code;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`));
};
