/**
 * In-app user guide: one entry per screen, in Arabic and English. HelpButton shows the entry
 * matching the current route; /help lists them all.
 */
export type GuideSection = 'start' | 'ledger' | 'periodEnd' | 'group' | 'reports' | 'admin' | 'platform';

type GuideText = { title: string; summary: string; steps: string[]; tips: string[] };

export type Guide = {
  id: string;
  section: GuideSection;
  /** Route prefixes this guide covers; the longest match wins. */
  paths: string[];
  en: GuideText;
  ar: GuideText;
};

export const SECTION_TITLES: Record<GuideSection, { en: string; ar: string }> = {
  start: { en: 'Getting started', ar: 'البداية' },
  ledger: { en: 'General ledger', ar: 'الأستاذ العام' },
  periodEnd: { en: 'Period-end', ar: 'نهاية الفترة' },
  group: { en: 'Group companies', ar: 'شركات المجموعة' },
  reports: { en: 'Reports', ar: 'التقارير' },
  admin: { en: 'Administration', ar: 'الإدارة' },
  platform: { en: 'Platform administration', ar: 'إدارة المنصة' },
};

export const GUIDES: Guide[] = [
  // ---------------------------------------------------------------- getting started
  {
    id: 'sign-in',
    section: 'start',
    paths: ['/login', '/signup'],
    en: {
      title: 'Signing in and your account',
      summary: 'Sign in with your email and password. If your organisation has more than one tenant or company, you can switch between them after signing in.',
      steps: [
        'Enter your email and password, then choose Sign in.',
        'If two-factor authentication is on, enter the 6-digit code from your authenticator app when asked.',
        'Pick the company you want to work in from the selector at the top of the screen.',
        'Open the menu under your name to switch organisation, change digits (123 or ١٢٣), turn on two-factor authentication, or sign out.',
        'Use the language button (ع / EN) to switch the whole application between Arabic and English.',
      ],
      tips: [
        'If you were given a temporary password, keep it private and ask your administrator to reset it if it is lost.',
        'Self-service sign-up may be closed by the service provider; in that case your account is created by them.',
        'After 20 failed attempts in one minute, sign-in is paused briefly for your network address.',
      ],
    },
    ar: {
      title: 'تسجيل الدخول وحسابك',
      summary: 'سجّل الدخول ببريدك الإلكتروني وكلمة المرور. إذا كان لديك أكثر من مؤسسة أو شركة يمكنك التنقل بينها بعد الدخول.',
      steps: [
        'أدخل البريد الإلكتروني وكلمة المرور ثم اضغط «تسجيل الدخول».',
        'إذا كان التحقق بخطوتين مفعلاً، أدخل الرمز المكون من 6 أرقام من تطبيق المصادقة عند طلبه.',
        'اختر الشركة التي تريد العمل عليها من القائمة في أعلى الشاشة.',
        'من القائمة أسفل اسمك يمكنك تبديل المؤسسة، واختيار شكل الأرقام (123 أو ١٢٣)، وتفعيل التحقق بخطوتين، وتسجيل الخروج.',
        'استخدم زر اللغة (ع / EN) لتحويل النظام بالكامل بين العربية والإنجليزية.',
      ],
      tips: [
        'إذا استلمت كلمة مرور مؤقتة فاحتفظ بها بسرية، واطلب من مدير النظام إعادة تعيينها إذا فقدتها.',
        'قد يغلق مزود الخدمة التسجيل الذاتي، وفي هذه الحالة يتم إنشاء حسابك من قِبله.',
        'بعد 20 محاولة دخول فاشلة خلال دقيقة يتم إيقاف الدخول مؤقتاً لعنوان شبكتك.',
      ],
    },
  },
  {
    id: 'two-factor',
    section: 'start',
    paths: [],
    en: {
      title: 'Two-factor authentication (2FA)',
      summary: 'Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…) to every sign-in.',
      steps: [
        'Open the menu under your name and choose Two-factor authentication.',
        'Choose Enable. A QR code and a secret key appear.',
        'Scan the QR code with your authenticator app (or type the secret key into it).',
        'Enter the 6-digit code the app shows and choose Enable.',
        'To turn it off later, open the same window, enter a current code and choose Disable.',
      ],
      tips: [
        'If you lose your phone, ask your administrator to reset your 2FA from the Users screen.',
        'Codes change every 30 seconds; make sure your phone clock is set automatically.',
      ],
    },
    ar: {
      title: 'التحقق بخطوتين',
      summary: 'يضيف رمزاً من 6 أرقام من تطبيق مصادقة (Google Authenticator أو Microsoft Authenticator أو Authy…) إلى كل عملية دخول.',
      steps: [
        'افتح القائمة أسفل اسمك واختر «التحقق بخطوتين».',
        'اضغط «تفعيل»، فيظهر رمز QR ومفتاح سري.',
        'امسح رمز QR بتطبيق المصادقة (أو أدخل المفتاح السري يدوياً).',
        'أدخل الرمز المكون من 6 أرقام الظاهر في التطبيق ثم اضغط «تفعيل».',
        'لإيقافه لاحقاً افتح النافذة نفسها وأدخل رمزاً حالياً ثم اضغط «إيقاف».',
      ],
      tips: [
        'إذا فقدت هاتفك اطلب من مدير النظام إعادة ضبط التحقق بخطوتين من شاشة المستخدمين.',
        'تتغير الرموز كل 30 ثانية؛ تأكد من أن ساعة الهاتف مضبوطة تلقائياً.',
      ],
    },
  },
  {
    id: 'dashboard',
    section: 'start',
    paths: ['/dashboard'],
    en: {
      title: 'Dashboard',
      summary: 'A summary of the selected company: draft entries, entries awaiting approval, entries posted this month and the current period.',
      steps: [
        'Check the selected company at the top of the screen; every figure belongs to that company.',
        'Select a counter (drafts or awaiting approval) to open the journal list filtered by that status.',
        'Use the quick actions to create a new entry or open the trial balance and income statement.',
      ],
      tips: ['The menu only shows the screens your role allows.'],
    },
    ar: {
      title: 'لوحة المعلومات',
      summary: 'ملخص للشركة المختارة: القيود المسودة، والقيود بانتظار الاعتماد، والقيود المرحلة هذا الشهر، والفترة الحالية.',
      steps: [
        'تأكد من الشركة المختارة في أعلى الشاشة؛ جميع الأرقام تخص هذه الشركة.',
        'اضغط على أحد العدادات (المسودات أو بانتظار الاعتماد) لفتح قائمة القيود مصفاة بتلك الحالة.',
        'استخدم الإجراءات السريعة لإنشاء قيد جديد أو فتح ميزان المراجعة وقائمة الدخل.',
      ],
      tips: ['تعرض القائمة الجانبية فقط الشاشات التي يسمح بها دورك.'],
    },
  },

  // ---------------------------------------------------------------- general ledger
  {
    id: 'journals',
    section: 'ledger',
    paths: ['/gl/journals'],
    en: {
      title: 'Journal entries',
      summary: 'Lists every entry of the company with its number, date, type, status and amount. Entries move Draft → Submitted → Approved → Posted; posted entries can only be corrected by reversal.',
      steps: [
        'Use the search box and the status, type and date filters to find entries.',
        'Choose New entry to open the journal editor.',
        'Select an entry to open it, see its history and attachments, and act on it (submit, approve, post, reverse).',
      ],
      tips: [
        'Entry numbers are given at posting, without gaps, per journal type and year.',
        'If you have a cost center restriction, you only see entries that touch your cost centers.',
      ],
    },
    ar: {
      title: 'القيود اليومية',
      summary: 'تعرض جميع قيود الشركة برقمها وتاريخها ونوعها وحالتها ومبلغها. يمر القيد بالمراحل: مسودة ← مرسل ← معتمد ← مرحّل؛ ولا يُصحح القيد المرحّل إلا بعكسه.',
      steps: [
        'استخدم البحث وفلاتر الحالة والنوع والتاريخ للوصول إلى القيود.',
        'اضغط «قيد جديد» لفتح شاشة إدخال القيد.',
        'افتح أي قيد لعرض سجله ومرفقاته واتخاذ الإجراء (إرسال، اعتماد، ترحيل، عكس).',
      ],
      tips: [
        'يُعطى رقم القيد عند الترحيل بتسلسل دون فجوات لكل نوع قيد وسنة.',
        'إذا كانت صلاحيتك مقيدة بمراكز تكلفة فلن ترى إلا القيود التي تخص مراكزك.',
      ],
    },
  },
  {
    id: 'journal-editor',
    section: 'ledger',
    paths: ['/gl/journals/new', '/gl/journals/'],
    en: {
      title: 'Entering a journal entry',
      summary: 'Create or edit a draft entry, then submit, approve and post it. Debits must equal credits in the company base currency.',
      steps: [
        'Choose the journal type and entry date; the period is found from the date.',
        'Add lines: account, debit or credit, description, and a cost center where the account requires one.',
        'For a foreign-currency line, choose the currency; the rate is taken from Currencies & rates and the base amount is calculated.',
        'To spread a line over several cost centers, choose a distribution template or Manual split and enter the percentages.',
        'Save draft. Then Submit for approval, or Post directly if your company does not require approval.',
        'Optional: set Auto-reverse on (for accruals), attach documents, print the voucher PDF, or Make recurring.',
      ],
      tips: [
        'A rounding line is added automatically for tiny foreign-currency differences.',
        'If budget control is on, posting may warn or be blocked when an expense exceeds the approved budget.',
        'To correct a posted entry choose Reverse: a mirror entry is posted on the date you choose.',
        'Tick “Post to the adjustment period” for year-end adjustments dated on the last day of the year.',
      ],
    },
    ar: {
      title: 'إدخال قيد يومية',
      summary: 'أنشئ قيداً مسودة أو عدّله ثم أرسله واعتمده ورحّله. يجب أن يتساوى المدين والدائن بالعملة الأساسية للشركة.',
      steps: [
        'اختر نوع القيد وتاريخه؛ تُحدد الفترة تلقائياً من التاريخ.',
        'أضف الأسطر: الحساب، والمبلغ مديناً أو دائناً، والبيان، ومركز التكلفة إذا كان الحساب يتطلبه.',
        'للسطر بعملة أجنبية اختر العملة؛ يؤخذ السعر من شاشة العملات وأسعار الصرف ويُحسب المبلغ بالعملة الأساسية.',
        'لتوزيع السطر على عدة مراكز تكلفة اختر قالب توزيع أو «توزيع يدوي» وأدخل النسب.',
        'اضغط «حفظ كمسودة»، ثم «إرسال للاعتماد» أو «ترحيل» مباشرة إذا كانت الشركة لا تتطلب الاعتماد.',
        'اختيارياً: حدّد تاريخ العكس التلقائي (للمستحقات)، أو أرفق مستندات، أو اطبع سند القيد PDF، أو اجعله قيداً متكرراً.',
      ],
      tips: [
        'يُضاف سطر تقريب تلقائياً لفروقات العملات الأجنبية الصغيرة.',
        'إذا كانت رقابة الموازنة مفعلة فقد يظهر تحذير أو يُمنع الترحيل عند تجاوز المصروف للموازنة المعتمدة.',
        'لتصحيح قيد مرحّل اضغط «عكس»، فيُرحّل قيد معاكس بالتاريخ الذي تختاره.',
        'اختر «الترحيل إلى فترة التسويات» لقيود التسوية بتاريخ آخر يوم في السنة.',
      ],
    },
  },
  {
    id: 'accounts',
    section: 'ledger',
    paths: ['/gl/accounts'],
    en: {
      title: 'Chart of accounts',
      summary: 'The tree of accounts. Header accounts group others; only posting accounts accept entries.',
      steps: [
        'Search by code or name in either language.',
        'Choose Add, or the + next to a header account to add a child under it.',
        'Set the type (asset, liability, equity, revenue, expense) and whether it is a posting account.',
        'Set the cost center rule: Required, Optional or Not allowed, and optionally a default or allowed cost centers.',
        'For balance-sheet accounts, set the cash flow category used by the cash flow statement; tick Revalue for foreign-currency accounts revalued at period end.',
      ],
      tips: [
        'An account with transactions cannot be deleted or change type; make it inactive instead.',
        'Control accounts accept entries only from their owning module (for example receivables).',
      ],
    },
    ar: {
      title: 'دليل الحسابات',
      summary: 'شجرة الحسابات. الحسابات التجميعية تجمع غيرها، والحسابات التفصيلية فقط تقبل القيود.',
      steps: [
        'ابحث بالرمز أو الاسم بأي من اللغتين.',
        'اضغط «إضافة» أو علامة + بجانب حساب تجميعي لإضافة حساب فرعي تحته.',
        'حدد النوع (أصول، خصوم، حقوق ملكية، إيرادات، مصروفات) وهل الحساب تفصيلي يقبل القيود.',
        'حدد قاعدة مركز التكلفة: إلزامي أو اختياري أو غير مسموح، ويمكن تحديد مركز افتراضي أو مراكز مسموحة.',
        'لحسابات المركز المالي حدد فئة التدفق النقدي المستخدمة في قائمة التدفقات النقدية، واختر «إعادة التقييم» للحسابات بالعملات الأجنبية.',
      ],
      tips: [
        'لا يمكن حذف حساب عليه حركات أو تغيير نوعه؛ اجعله غير نشط بدلاً من ذلك.',
        'حسابات المراقبة تقبل القيود من وحدتها فقط (مثل المدينين).',
      ],
    },
  },
  {
    id: 'cost-centers',
    section: 'ledger',
    paths: ['/gl/cost-centers'],
    en: {
      title: 'Cost centers',
      summary: 'The tree of departments, branches or projects that expenses and revenues are charged to.',
      steps: [
        'Choose Add, or the + next to a header to add a child.',
        'Set the type, manager and validity dates; only posting cost centers accept entries.',
        'Under Hierarchy versions, choose Save current hierarchy to keep a dated snapshot of the tree.',
        'Cost center reports can then be run against the current tree or any saved version.',
      ],
      tips: [
        'A cost center with transactions cannot be deleted; make it inactive.',
        'Users can be restricted to part of the tree from Administration → Users.',
      ],
    },
    ar: {
      title: 'مراكز التكلفة',
      summary: 'شجرة الإدارات أو الفروع أو المشاريع التي تُحمّل عليها المصروفات والإيرادات.',
      steps: [
        'اضغط «إضافة» أو علامة + بجانب مركز تجميعي لإضافة مركز فرعي.',
        'حدد النوع والمسؤول وتواريخ الصلاحية؛ المراكز التفصيلية فقط تقبل القيود.',
        'في قسم «نسخ الهيكل» اضغط «حفظ الهيكل الحالي» للاحتفاظ بنسخة مؤرخة من الشجرة.',
        'يمكن بعدها تشغيل تقارير مراكز التكلفة على الهيكل الحالي أو أي نسخة محفوظة.',
      ],
      tips: [
        'لا يمكن حذف مركز عليه حركات؛ اجعله غير نشط.',
        'يمكن تقييد المستخدمين بجزء من الشجرة من الإدارة ← المستخدمون.',
      ],
    },
  },
  {
    id: 'dimensions',
    section: 'ledger',
    paths: ['/gl/dimensions'],
    en: {
      title: 'Dimensions',
      summary: 'Extra analysis tags on journal lines, such as project, contract or vehicle, in addition to cost centers.',
      steps: ['Add a dimension type (for example Project).', 'Add its values (for example each project).', 'In the chart of accounts, set dimension rules on accounts that must carry the dimension.'],
      tips: ['Values can be deactivated when a project ends; past entries keep them.'],
    },
    ar: {
      title: 'الأبعاد التحليلية',
      summary: 'وسوم تحليل إضافية على أسطر القيود مثل المشروع أو العقد أو المركبة، إلى جانب مراكز التكلفة.',
      steps: ['أضف نوع بُعد (مثل: المشروع).', 'أضف قيمه (مثل: كل مشروع).', 'في دليل الحسابات حدد قواعد الأبعاد للحسابات التي يجب أن تحمل هذا البعد.'],
      tips: ['يمكن إيقاف القيم عند انتهاء المشروع، وتبقى في القيود السابقة.'],
    },
  },
  {
    id: 'journal-types',
    section: 'ledger',
    paths: ['/gl/journal-types'],
    en: {
      title: 'Journal types',
      summary: 'Types such as general journal, receipts or payments. Each type has its own entry number sequence.',
      steps: ['Choose Add to create a type with a code and names.', 'Deactivate types you no longer use.'],
      tips: ['System types (year-end, revaluation, allocation, intercompany) are used by the system and cannot be removed.'],
    },
    ar: {
      title: 'أنواع القيود',
      summary: 'أنواع مثل قيد يومية عام أو سند قبض أو سند صرف، ولكل نوع تسلسل أرقام خاص به.',
      steps: ['اضغط «إضافة» لإنشاء نوع برمز واسمين.', 'أوقف الأنواع التي لم تعد تستخدمها.'],
      tips: ['أنواع النظام (إقفال السنة، إعادة التقييم، التوزيع، القيود بين الشركات) يستخدمها النظام ولا يمكن حذفها.'],
    },
  },
  {
    id: 'distribution-templates',
    section: 'ledger',
    paths: ['/gl/distribution-templates'],
    en: {
      title: 'Distribution templates',
      summary: 'Saved percentage splits across cost centers, for example rent shared 50/30/20 between three branches.',
      steps: ['Choose Add and enter a code and names.', 'Add lines with a cost center and percentage; the total must be 100%.', 'In the journal editor, pick the template on a line to split it.'],
      tips: ['Rounding of the split amounts is placed on the last line so the total is exact.'],
    },
    ar: {
      title: 'قوالب التوزيع',
      summary: 'نسب توزيع محفوظة على مراكز التكلفة، مثل توزيع الإيجار 50/30/20 بين ثلاثة فروع.',
      steps: ['اضغط «إضافة» وأدخل الرمز والاسمين.', 'أضف أسطراً بمركز التكلفة والنسبة؛ يجب أن يكون المجموع 100%.', 'في شاشة القيد اختر القالب على السطر لتوزيعه.'],
      tips: ['يوضع فرق التقريب على السطر الأخير ليكون المجموع دقيقاً.'],
    },
  },
  {
    id: 'currencies',
    section: 'ledger',
    paths: ['/gl/currencies'],
    en: {
      title: 'Currencies and exchange rates',
      summary: 'Exchange rates against the company base currency (KWD), by date and type.',
      steps: [
        'Choose the currency, date and rate type, enter the rate and save.',
        'SPOT rates are used for daily entries; CLOSING rates for period-end revaluation and consolidation; AVERAGE rates for consolidating profit and loss.',
      ],
      tips: ['When no rate exists for a date, the latest earlier rate is used; if there is none, the entry is rejected.'],
    },
    ar: {
      title: 'العملات وأسعار الصرف',
      summary: 'أسعار الصرف مقابل العملة الأساسية للشركة (الدينار الكويتي) حسب التاريخ والنوع.',
      steps: [
        'اختر العملة والتاريخ ونوع السعر وأدخل السعر ثم احفظ.',
        'سعر SPOT للقيود اليومية، وسعر CLOSING لإعادة التقييم والتوحيد في نهاية الفترة، وسعر AVERAGE لتوحيد قائمة الدخل.',
      ],
      tips: ['إذا لم يوجد سعر لتاريخ ما يُستخدم أحدث سعر سابق، وإذا لم يوجد يُرفض القيد.'],
    },
  },
  {
    id: 'periods',
    section: 'ledger',
    paths: ['/gl/periods'],
    en: {
      title: 'Fiscal years and periods',
      summary: 'Fiscal years with 12 monthly periods and an optional adjustment period (13). Each period has a status per module.',
      steps: [
        'Choose New fiscal year, enter the start date and tick the adjustment period if you want one.',
        'Change a period status for a module: Open (entries allowed), Closed (no new entries, can be reopened) or Locked (final).',
        'Close periods each month after review to protect the reported figures.',
      ],
      tips: ['Closing a period with unposted entries shows a warning listing them.', 'Reopening a closed period needs a special permission.'],
    },
    ar: {
      title: 'السنوات والفترات المالية',
      summary: 'سنوات مالية من 12 فترة شهرية وفترة تسويات اختيارية (13). لكل فترة حالة لكل وحدة.',
      steps: [
        'اضغط «سنة مالية جديدة» وأدخل تاريخ البداية واختر إضافة فترة التسويات إذا رغبت.',
        'غيّر حالة الفترة لكل وحدة: مفتوحة (تقبل القيود)، أو مقفلة (لا قيود جديدة ويمكن إعادة فتحها)، أو مقفلة نهائياً.',
        'أقفل الفترات شهرياً بعد المراجعة لحماية الأرقام المعلنة.',
      ],
      tips: ['إقفال فترة عليها قيود غير مرحلة يُظهر تحذيراً بها.', 'إعادة فتح فترة مقفلة تتطلب صلاحية خاصة.'],
    },
  },

  // ---------------------------------------------------------------- period-end
  {
    id: 'recurring',
    section: 'periodEnd',
    paths: ['/gl/recurring'],
    en: {
      title: 'Recurring entries',
      summary: 'Entries that repeat on a schedule, such as monthly rent or depreciation.',
      steps: [
        'Open an entry and choose Make recurring, or edit an existing schedule here.',
        'Set the frequency (monthly, quarterly, semi-annual, yearly), day of month, start and end dates.',
        'Tick Post automatically to post each run; otherwise each run is created as a draft for review.',
        'Choose Run now to generate any due runs immediately.',
      ],
      tips: ['Runs are generated hourly in the background. If a run fails, the error is shown and the schedule waits until it succeeds.', 'Day 31 falls on the last day of shorter months.'],
    },
    ar: {
      title: 'القيود المتكررة',
      summary: 'قيود تتكرر بجدول زمني مثل الإيجار الشهري أو الاستهلاك.',
      steps: [
        'افتح قيداً واضغط «جعله متكرراً»، أو عدّل جدولاً موجوداً من هذه الشاشة.',
        'حدد التكرار (شهري، ربع سنوي، نصف سنوي، سنوي) ويوم الشهر وتاريخ البداية والنهاية.',
        'اختر «ترحيل تلقائي» لترحيل كل دورة، وإلا يُنشأ كل قيد كمسودة للمراجعة.',
        'اضغط «تشغيل الآن» لإنشاء القيود المستحقة فوراً.',
      ],
      tips: ['تُنشأ القيود كل ساعة في الخلفية، وإذا فشلت دورة يظهر الخطأ ولا يتقدم الجدول حتى تنجح.', 'اليوم 31 يقع في آخر يوم من الأشهر الأقصر.'],
    },
  },
  {
    id: 'fx-revaluation',
    section: 'periodEnd',
    paths: ['/gl/fx-revaluation'],
    en: {
      title: 'FX revaluation',
      summary: 'Restates foreign-currency balances at the closing rate and posts the unrealised gain or loss.',
      steps: [
        'Make sure CLOSING rates exist for the revaluation date (Currencies & rates).',
        'Choose the revaluation date and Preview: each account shows its foreign balance, carrying amount, revalued amount and difference.',
        'Choose Post entry. By default the entry reverses automatically the next day.',
      ],
      tips: ['Only accounts with Revalue ticked in the chart of accounts are included.', 'Set the unrealised gain and loss accounts on the company first.'],
    },
    ar: {
      title: 'إعادة تقييم العملات',
      summary: 'تعيد تقييم الأرصدة بالعملات الأجنبية بسعر الإقفال وترحّل الربح أو الخسارة غير المحققة.',
      steps: [
        'تأكد من وجود أسعار CLOSING لتاريخ إعادة التقييم (شاشة العملات وأسعار الصرف).',
        'اختر تاريخ إعادة التقييم واضغط «معاينة»: يظهر لكل حساب الرصيد الأجنبي والقيمة الدفترية والقيمة المعاد تقييمها والفرق.',
        'اضغط «ترحيل القيد». افتراضياً يُعكس القيد تلقائياً في اليوم التالي.',
      ],
      tips: ['تشمل فقط الحسابات المحدد عليها «إعادة التقييم» في دليل الحسابات.', 'حدد حسابي أرباح وخسائر فروق العملة غير المحققة في بيانات الشركة أولاً.'],
    },
  },
  {
    id: 'allocation',
    section: 'periodEnd',
    paths: ['/gl/allocation'],
    en: {
      title: 'Cost allocation',
      summary: 'Moves costs from service cost centers to the cost centers that use them, by fixed percentages or by a statistical driver.',
      steps: [
        'Under Statistical drivers, define drivers (headcount, area…) and enter their values per period and cost center.',
        'Under Rules, set the step number, source accounts and cost centers, method, and target cost centers (percentages or driver).',
        'Choose Preview for a period to see the entries without posting.',
        'Choose Run allocation to post. A run can be reversed from Runs.',
      ],
      tips: ['Rules run in step order, so a later step allocates what earlier steps moved (step-down).', 'Each rule set can be posted once per period.'],
    },
    ar: {
      title: 'توزيع التكاليف',
      summary: 'تنقل التكاليف من مراكز الخدمات إلى المراكز المستفيدة بنسب ثابتة أو بمحرك إحصائي.',
      steps: [
        'في «المحركات الإحصائية» عرّف المحركات (عدد الموظفين، المساحة…) وأدخل قيمها لكل فترة ومركز.',
        'في «القواعد» حدد رقم الخطوة والحسابات والمراكز المصدر والطريقة والمراكز المستهدفة (نسب أو محرك).',
        'اضغط «معاينة» لفترة لعرض القيود دون ترحيل.',
        'اضغط «تشغيل التوزيع» للترحيل، ويمكن عكس التشغيل من قسم «عمليات التشغيل».',
      ],
      tips: ['تُنفذ القواعد بترتيب الخطوات، فتوزع الخطوة اللاحقة ما نقلته الخطوات السابقة (التوزيع التنازلي).', 'يمكن ترحيل التوزيع مرة واحدة لكل فترة.'],
    },
  },
  {
    id: 'budgets',
    section: 'periodEnd',
    paths: ['/gl/budgets'],
    en: {
      title: 'Budgets',
      summary: 'Budget versions per fiscal year, entered as an account × month grid at company level or per cost center.',
      steps: [
        'Choose Add, pick the fiscal year and give the version a code and name.',
        'Open the budget, choose company level or a cost center, and type amounts in the grid; Save.',
        'Or choose Generate from actuals: pick a source year and an adjustment % (for example +5%).',
        'Choose Approve when final. Approved budgets are used by budget control and the budget vs actual report.',
      ],
      tips: ['Reopen an approved budget to change it.', 'Turn on budget control for a company from Administration → Companies.'],
    },
    ar: {
      title: 'الموازنات',
      summary: 'نسخ موازنة لكل سنة مالية تُدخل كجدول حسابات × أشهر على مستوى الشركة أو لكل مركز تكلفة.',
      steps: [
        'اضغط «إضافة» واختر السنة المالية وأعطِ النسخة رمزاً واسماً.',
        'افتح الموازنة واختر مستوى الشركة أو مركز تكلفة، وأدخل المبالغ في الجدول ثم احفظ.',
        'أو اضغط «إنشاء من الفعلي» واختر سنة المصدر ونسبة التعديل (مثل +5%).',
        'اضغط «اعتماد» عند الانتهاء. تستخدم الموازنات المعتمدة في رقابة الموازنة وتقرير الموازنة مقابل الفعلي.',
      ],
      tips: ['أعد فتح الموازنة المعتمدة لتعديلها.', 'فعّل رقابة الموازنة للشركة من الإدارة ← الشركات.'],
    },
  },
  {
    id: 'year-end',
    section: 'periodEnd',
    paths: ['/gl/year-end'],
    en: {
      title: 'Year-end close',
      summary: 'Posts statutory appropriations (KFAS, NLST, Zakat, statutory reserve), closes revenue and expenses to retained earnings and closes the year.',
      steps: [
        'Review the appropriation rules: percentage, base, debit and credit accounts, and cap for reserves.',
        'Choose the fiscal year to see the preview: profit, each contribution, net profit and reserve transfers.',
        'Choose Post statutory appropriations, then Close year.',
        'If a correction is needed, Reopen year reverses all year-end entries.',
      ],
      tips: ['All entries of the year must be posted or deleted before closing.', 'The closing entry is dated in the adjustment period; P&L reports still show full-year figures after closing.'],
    },
    ar: {
      title: 'إقفال السنة المالية',
      summary: 'ترحيل الاستقطاعات القانونية (مؤسسة الكويت للتقدم العلمي، دعم العمالة الوطنية، الزكاة، الاحتياطي الإجباري)، وإقفال الإيرادات والمصروفات في الأرباح المرحلة وإقفال السنة.',
      steps: [
        'راجع قواعد الاستقطاعات: النسبة والأساس والحساب المدين والدائن والحد الأقصى للاحتياطيات.',
        'اختر السنة المالية لعرض المعاينة: الربح وكل استقطاع وصافي الربح والتحويلات للاحتياطيات.',
        'اضغط «ترحيل الاستقطاعات القانونية» ثم «إقفال السنة».',
        'عند الحاجة للتصحيح اضغط «إعادة فتح السنة» فتُعكس جميع قيود الإقفال.',
      ],
      tips: ['يجب ترحيل جميع قيود السنة أو حذفها قبل الإقفال.', 'يكون قيد الإقفال في فترة التسويات، وتبقى تقارير الأرباح والخسائر تعرض أرقام السنة كاملة بعد الإقفال.'],
    },
  },
  {
    id: 'statements',
    section: 'periodEnd',
    paths: ['/gl/statements'],
    en: {
      title: 'Statement designer',
      summary: 'Build your own financial statements from rows that sum accounts or combine other rows.',
      steps: [
        'Choose Add, give the statement a code and name and choose the basis: period movements (P&L) or position (balance sheet).',
        'Add rows. An account row sums codes and ranges such as 41,4201-4204. A formula row combines row keys such as REV-COS.',
        'Set sign, bold, indent and detail for presentation, and reorder rows with Up and Down.',
        'Choose View, or run it from Reports → Designed statement.',
      ],
      tips: ['The report warns about accounts with balances that no row covers, or that two rows both cover.'],
    },
    ar: {
      title: 'مصمم القوائم المالية',
      summary: 'صمم قوائمك المالية من أسطر تجمع الحسابات أو تجمع أسطراً أخرى.',
      steps: [
        'اضغط «إضافة» وأعطِ القائمة رمزاً واسماً واختر الأساس: حركة الفترة (قائمة الدخل) أو المركز المالي.',
        'أضف الأسطر: سطر حسابات يجمع رموزاً ونطاقات مثل 41,4201-4204، وسطر معادلة يجمع مفاتيح أسطر مثل REV-COS.',
        'حدد الإشارة والخط العريض والإزاحة والتفاصيل، ورتّب الأسطر بالأسهم.',
        'اضغط «عرض» أو شغّلها من التقارير ← قائمة مصممة.',
      ],
      tips: ['ينبهك التقرير إلى الحسابات ذات الأرصدة غير المشمولة بأي سطر أو المشمولة بسطرين.'],
    },
  },
  {
    id: 'import',
    section: 'periodEnd',
    paths: ['/gl/import'],
    en: {
      title: 'Excel import',
      summary: 'Import the chart of accounts or journal entries from Excel.',
      steps: [
        'Choose Download template for accounts or journals and fill it in.',
        'Choose the file and Preview: every row is checked and errors are listed by row.',
        'Fix the errors in Excel and preview again until all rows are OK.',
        'Choose Import. For journals, tick Post imported entries to post them in the same step.',
      ],
      tips: ['Import is all-or-nothing: if any row fails, nothing is saved.'],
    },
    ar: {
      title: 'الاستيراد من Excel',
      summary: 'استيراد دليل الحسابات أو القيود من ملف Excel.',
      steps: [
        'اضغط «تنزيل القالب» للحسابات أو القيود واملأه.',
        'اختر الملف واضغط «معاينة»: يُفحص كل سطر وتظهر الأخطاء برقم السطر.',
        'صحح الأخطاء في Excel وأعد المعاينة حتى تصبح جميع الأسطر سليمة.',
        'اضغط «استيراد». للقيود اختر «ترحيل القيود المستوردة» لترحيلها في الخطوة نفسها.',
      ],
      tips: ['الاستيراد كامل أو لا شيء: إذا فشل أي سطر لا يُحفظ شيء.'],
    },
  },

  // ---------------------------------------------------------------- group
  {
    id: 'intercompany',
    section: 'group',
    paths: ['/gl/intercompany'],
    en: {
      title: 'Intercompany transactions',
      summary: 'Record a transaction between two companies of your organisation in one step: both entries are posted together and linked.',
      steps: [
        'Under Partner companies, set for each partner the due-from (asset) and due-to (liability) accounts. Do the same in the partner company for this company.',
        'Choose New intercompany transaction, pick the partner, date and description.',
        'Enter this company’s lines and the partner’s lines; each side is balanced automatically through its intercompany account.',
        'Choose Post both entries.',
      ],
      tips: ['Both companies must use the same base currency.', 'Reversing either entry reverses the other.', 'Check balances with Reports → Intercompany reconciliation.'],
    },
    ar: {
      title: 'المعاملات بين الشركات',
      summary: 'سجل معاملة بين شركتين في مؤسستك بخطوة واحدة: يُرحّل القيدان معاً ويُربطان.',
      steps: [
        'في «الشركات الشريكة» حدد لكل شريك حساب «مستحق من» (أصل) و«مستحق إلى» (التزام)، وافعل الشيء نفسه في الشركة الشريكة.',
        'اضغط «معاملة جديدة بين الشركات» واختر الشريك والتاريخ والبيان.',
        'أدخل أسطر هذه الشركة وأسطر الشريك؛ يتوازن كل طرف تلقائياً عبر حساب الشركة الشريكة.',
        'اضغط «ترحيل القيدين».',
      ],
      tips: ['يجب أن تكون العملة الأساسية للشركتين واحدة.', 'عكس أي من القيدين يعكس الآخر.', 'راجع الأرصدة من التقارير ← مطابقة الحسابات بين الشركات.'],
    },
  },
  {
    id: 'consolidation',
    section: 'group',
    paths: ['/consolidation'],
    en: {
      title: 'Consolidation',
      summary: 'Combine the companies of a group into consolidated statements, with intercompany balances eliminated.',
      steps: [
        'Choose Add to create a group: parent company, member companies and presentation currency (the parent’s base currency).',
        'Optionally add consolidation adjustments by account code and date.',
        'Open the consolidation worksheet, consolidated balance sheet or consolidated income statement.',
      ],
      tips: [
        'Members in other currencies are translated at the parent’s CLOSING rate (balance sheet) and AVERAGE rate (income statement).',
        'Any intercompany mismatch appears on its own line so you can investigate it.',
      ],
    },
    ar: {
      title: 'توحيد القوائم المالية',
      summary: 'دمج شركات المجموعة في قوائم موحدة مع استبعاد الأرصدة بين الشركات.',
      steps: [
        'اضغط «إضافة» لإنشاء مجموعة: الشركة الأم والشركات الأعضاء وعملة العرض (عملة الشركة الأم).',
        'يمكنك إضافة قيود تسويات التوحيد برمز الحساب والتاريخ.',
        'افتح ورقة عمل التوحيد أو المركز المالي الموحد أو قائمة الدخل الموحدة.',
      ],
      tips: ['تُترجم الشركات بعملات أخرى بسعر الإقفال لدى الشركة الأم للمركز المالي وبالسعر المتوسط لقائمة الدخل.', 'أي فرق في الأرصدة بين الشركات يظهر في سطر مستقل لمراجعته.'],
    },
  },

  // ---------------------------------------------------------------- reports
  {
    id: 'reports',
    section: 'reports',
    paths: ['/reports/'],
    en: {
      title: 'Reports',
      summary:
        'Trial balance, account statement, journal register, income statement, balance sheet, cash flow, cost center analysis and summary, budget vs actual, designed statements, intercompany reconciliation and consolidated reports.',
      steps: [
        'Pick the report from Reports in the menu.',
        'Set the filters: periods or dates, account level, cost center, comparison with the prior year, and so on.',
        'Choose Run report to view it on screen.',
        'Choose the report language (Arabic, English or both) and export to PDF or Excel.',
      ],
      tips: [
        'Cost center analysis shows accounts against the children of the cost center you pick; each column includes its whole subtree.',
        'The cash flow statement uses the indirect method and checks itself against the movement in cash accounts.',
        'Reports only include posted entries.',
      ],
    },
    ar: {
      title: 'التقارير',
      summary:
        'ميزان المراجعة، وكشف الحساب، ودفتر اليومية، وقائمة الدخل، والمركز المالي، والتدفقات النقدية، وتحليل مراكز التكلفة وملخصها، والموازنة مقابل الفعلي، والقوائم المصممة، ومطابقة الحسابات بين الشركات، والتقارير الموحدة.',
      steps: [
        'اختر التقرير من قسم التقارير في القائمة.',
        'حدد الفلاتر: الفترات أو التواريخ، ومستوى الحساب، ومركز التكلفة، والمقارنة بالسنة السابقة وغيرها.',
        'اضغط «عرض التقرير» لعرضه على الشاشة.',
        'اختر لغة التقرير (عربي أو إنجليزي أو الاثنين) وصدّره إلى PDF أو Excel.',
      ],
      tips: [
        'تحليل مراكز التكلفة يعرض الحسابات مقابل المراكز الفرعية للمركز المختار، وكل عمود يشمل كل ما تحته.',
        'قائمة التدفقات النقدية بالطريقة غير المباشرة وتتحقق من نفسها مقابل حركة حسابات النقدية.',
        'تشمل التقارير القيود المرحلة فقط.',
      ],
    },
  },

  // ---------------------------------------------------------------- administration
  {
    id: 'companies',
    section: 'admin',
    paths: ['/admin/companies'],
    en: {
      title: 'Companies',
      summary: 'The legal entities of your organisation and their accounting settings.',
      steps: [
        'Choose New company: code, names, base currency, first fiscal year, and whether to load the Kuwait IFRS chart of accounts.',
        'Edit a company to set approval rules, rounding, retained earnings and FX gain/loss accounts.',
        'Set Budget control to Warn or Block and choose the approved budget used for control.',
        'Choose Export all data to download a complete copy of your organisation’s data as JSON.',
      ],
      tips: ['The number of companies is limited by your plan.', 'The base currency cannot change once entries exist.'],
    },
    ar: {
      title: 'الشركات',
      summary: 'الكيانات القانونية في مؤسستك وإعداداتها المحاسبية.',
      steps: [
        'اضغط «شركة جديدة»: الرمز والاسمان والعملة الأساسية وأول سنة مالية، واختر تحميل دليل الحسابات الكويتي وفق المعايير الدولية.',
        'عدّل الشركة لتحديد قواعد الاعتماد وحسابات التقريب والأرباح المرحلة وفروق العملة.',
        'اضبط «رقابة الموازنة» على تحذير أو منع، واختر الموازنة المعتمدة المستخدمة للرقابة.',
        'اضغط «تصدير جميع البيانات» لتنزيل نسخة كاملة من بيانات مؤسستك بصيغة JSON.',
      ],
      tips: ['عدد الشركات محدود حسب باقتك.', 'لا يمكن تغيير العملة الأساسية بعد وجود قيود.'],
    },
  },
  {
    id: 'users',
    section: 'admin',
    paths: ['/admin/users'],
    en: {
      title: 'Users',
      summary: 'People who can sign in to your organisation, their roles and cost center access.',
      steps: [
        'Choose Add user: email, full name and role. Leave the password empty to get a temporary one to hand over.',
        'Optionally limit the user to some cost centers; they will only see those subtrees.',
        'Edit a user to change role or deactivate them; Reset 2FA if they lost their phone.',
      ],
      tips: ['A user can belong to several organisations with the same email.', 'You cannot change your own role or deactivate yourself.'],
    },
    ar: {
      title: 'المستخدمون',
      summary: 'الأشخاص المسموح لهم بالدخول إلى مؤسستك وأدوارهم وصلاحيات مراكز التكلفة.',
      steps: [
        'اضغط «إضافة مستخدم»: البريد والاسم الكامل والدور. اترك كلمة المرور فارغة للحصول على كلمة مؤقتة تسلمها له.',
        'يمكنك تقييد المستخدم ببعض مراكز التكلفة فلا يرى إلا ما تحتها.',
        'عدّل المستخدم لتغيير دوره أو إيقافه، واضغط «إعادة ضبط التحقق بخطوتين» إذا فقد هاتفه.',
      ],
      tips: ['يمكن للمستخدم الانتماء لأكثر من مؤسسة بالبريد نفسه.', 'لا يمكنك تغيير دورك أو إيقاف نفسك.'],
    },
  },
  {
    id: 'roles',
    section: 'admin',
    paths: ['/admin/roles'],
    en: {
      title: 'Roles and permissions',
      summary: 'Roles group permissions. Four system roles exist: Administrator, Chief Accountant, Accountant and Viewer.',
      steps: ['Choose Add to create a custom role.', 'Tick the permissions it grants (view, create, approve, post, reports, close, administration…).', 'Assign the role to users in the Users screen.'],
      tips: ['The Administrator role cannot be changed. Other system roles keep their code, but their names and permissions can be edited.'],
    },
    ar: {
      title: 'الأدوار والصلاحيات',
      summary: 'الأدوار تجمع الصلاحيات. توجد أربعة أدوار نظام: مدير النظام، ورئيس الحسابات، والمحاسب، والمطلع.',
      steps: ['اضغط «إضافة» لإنشاء دور مخصص.', 'اختر الصلاحيات التي يمنحها (عرض، إنشاء، اعتماد، ترحيل، تقارير، إقفال، إدارة…).', 'أسند الدور للمستخدمين من شاشة المستخدمين.'],
      tips: ['لا يمكن تعديل دور مدير النظام. أدوار النظام الأخرى تحتفظ برمزها لكن يمكن تعديل اسميها وصلاحياتها.'],
    },
  },
  {
    id: 'audit',
    section: 'admin',
    paths: ['/admin/audit'],
    en: {
      title: 'Audit log',
      summary: 'A permanent record of who did what and when: sign-ins, changes to master data, every step of each entry, and actions by the service provider.',
      steps: ['Browse the latest actions, newest first.', 'Select a row to see the old and new values.'],
      tips: ['The audit log cannot be edited or deleted by anyone in the application.'],
    },
    ar: {
      title: 'سجل التدقيق',
      summary: 'سجل دائم لمن فعل ماذا ومتى: عمليات الدخول، وتعديلات البيانات الأساسية، وكل مرحلة من مراحل القيود، وإجراءات مزود الخدمة.',
      steps: ['تصفح الإجراءات بدءاً بالأحدث.', 'اضغط على أي سطر لعرض القيم القديمة والجديدة.'],
      tips: ['لا يمكن لأحد تعديل سجل التدقيق أو حذفه من داخل النظام.'],
    },
  },

  // ---------------------------------------------------------------- platform
  {
    id: 'platform',
    section: 'platform',
    paths: ['/platform'],
    en: {
      title: 'Platform administration (service provider)',
      summary: 'For the SaaS operator: create customer organisations (tenants), set their plan limits, suspend or reactivate them, and help locked-out users.',
      steps: [
        'Choose New tenant. Enter the organisation name, plan and limits (companies, users).',
        'Enter the first company: code, names, currency, first fiscal year, and whether to load the Kuwait chart of accounts.',
        'Enter the tenant administrator’s name and email. Leave the password empty to generate a temporary one, shown once, to hand over securely.',
        'Use the ⋯ menu on a tenant to edit its plan and limits, or Suspend it (its users are signed out and cannot sign in) and Reactivate it later.',
        'Select a tenant name to see its companies and users; reset a user’s password, or password and 2FA, when they are locked out.',
      ],
      tips: [
        'Platform administrator accounts are separate from customer accounts and cannot belong to a tenant.',
        'If the administrator email is already registered, that user is added as administrator and keeps their password.',
        'Every action you take on a tenant is written to that tenant’s audit log.',
        'Turn on two-factor authentication for your platform account from the menu under your name.',
      ],
    },
    ar: {
      title: 'إدارة المنصة (مزود الخدمة)',
      summary: 'لمشغل الخدمة: إنشاء مؤسسات العملاء (المشتركين)، وتحديد حدود باقاتهم، وإيقافها أو إعادة تفعيلها، ومساعدة المستخدمين الذين لا يستطيعون الدخول.',
      steps: [
        'اضغط «مؤسسة جديدة» وأدخل اسم المؤسسة والباقة والحدود (عدد الشركات والمستخدمين).',
        'أدخل بيانات الشركة الأولى: الرمز والاسمين والعملة وأول سنة مالية، واختر تحميل دليل الحسابات الكويتي.',
        'أدخل اسم مدير المؤسسة وبريده. اترك كلمة المرور فارغة لإنشاء كلمة مؤقتة تظهر مرة واحدة لتسليمها بأمان.',
        'من قائمة ⋯ بجانب المؤسسة يمكنك تعديل الباقة والحدود، أو «إيقاف» المؤسسة (يُسجل خروج مستخدميها ولا يستطيعون الدخول) ثم «إعادة تفعيلها» لاحقاً.',
        'اضغط اسم المؤسسة لعرض شركاتها ومستخدميها، وأعد تعيين كلمة المرور أو كلمة المرور والتحقق بخطوتين لمن لا يستطيع الدخول.',
      ],
      tips: [
        'حسابات مدير المنصة منفصلة عن حسابات العملاء ولا يمكن أن تنتمي لأي مؤسسة.',
        'إذا كان بريد المدير مسجلاً مسبقاً يُضاف ذلك المستخدم كمدير ويحتفظ بكلمة مروره.',
        'كل إجراء تقوم به على مؤسسة يُسجل في سجل التدقيق الخاص بها.',
        'فعّل التحقق بخطوتين لحساب المنصة من القائمة أسفل اسمك.',
      ],
    },
  },
];

/** The guide for a route: the longest matching path prefix. */
export const guideForPath = (pathname: string): Guide | undefined => {
  let best: { guide: Guide; length: number } | undefined;
  for (const guide of GUIDES) {
    for (const path of guide.paths) {
      const matches = path.endsWith('/') ? pathname.startsWith(path) : pathname === path || pathname.startsWith(`${path}/`);
      if (matches && path.length > (best?.length ?? -1)) best = { guide, length: path.length };
    }
  }
  return best?.guide;
};
