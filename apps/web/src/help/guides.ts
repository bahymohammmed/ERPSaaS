/**
 * In-app user guide: one entry per screen, in Arabic and English. HelpButton shows the entry
 * matching the current route; /help lists them all.
 */
export type GuideSection = 'start' | 'trade' | 'ledger' | 'periodEnd' | 'assets' | 'group' | 'reports' | 'admin' | 'platform';

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
  trade: { en: 'Sales, purchases and bank', ar: 'المبيعات والمشتريات والبنوك' },
  ledger: { en: 'General ledger', ar: 'الأستاذ العام' },
  periodEnd: { en: 'Period-end', ar: 'نهاية الفترة' },
  assets: { en: 'Fixed assets', ar: 'الأصول الثابتة' },
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

  // ---------------------------------------------------------------- sales, purchases and bank
  {
    id: 'parties',
    section: 'trade',
    paths: ['/ar/customers', '/ap/suppliers'],
    en: {
      title: 'Customers and suppliers',
      summary: 'The people and companies you sell to and buy from, with their currency, payment terms and current balance.',
      steps: [
        'Choose New customer / New supplier and enter a code, names, currency and payment terms (days until an invoice is due).',
        'Optionally set a default revenue or expense account, which is filled into new invoice lines, plus contact details, tax number and commercial registration.',
        'The Balance column shows what the customer owes you, or what you owe the supplier. The statement icon opens their statement of account.',
      ],
      tips: [
        'Each customer or supplier uses one currency; their invoices, notes and receipts or payments are in that currency.',
        'The currency cannot change once documents exist. Make the record inactive instead of deleting it.',
        'Amounts post to the receivable or payable control account, so manual journals cannot put the ledger out of step with the sub-ledger.',
      ],
    },
    ar: {
      title: 'العملاء والموردون',
      summary: 'الجهات التي تبيع لها وتشتري منها، بعملتها ومدة السداد ورصيدها الحالي.',
      steps: [
        'اضغط «عميل جديد» أو «مورد جديد» وأدخل الرمز والاسمين والعملة ومدة السداد (عدد الأيام حتى استحقاق الفاتورة).',
        'يمكنك تحديد حساب إيراد أو مصروف افتراضي يُعبأ تلقائياً في أسطر الفواتير، وبيانات الاتصال والرقم الضريبي والسجل التجاري.',
        'عمود «الرصيد» يوضح ما يدين به العميل لك أو ما تدين به للمورد، وأيقونة الكشف تفتح كشف حسابه.',
      ],
      tips: [
        'لكل عميل أو مورد عملة واحدة، وتكون فواتيره وإشعاراته وسنداته بهذه العملة.',
        'لا يمكن تغيير العملة بعد وجود مستندات؛ اجعل السجل غير نشط بدلاً من حذفه.',
        'تُرحّل المبالغ إلى حساب المراقبة للذمم المدينة أو الدائنة، فلا تؤثر القيود اليدوية على تطابق الدفاتر المساعدة مع الأستاذ العام.',
      ],
    },
  },
  {
    id: 'invoices',
    section: 'trade',
    paths: ['/ar/invoices', '/ap/invoices'],
    en: {
      title: 'Invoices and credit / debit notes',
      summary: 'All sales or purchase documents with their open balance. Overdue due dates are shown in red.',
      steps: [
        'Filter by customer / supplier or status, or search by number or reference.',
        'Choose New invoice, or New credit note (sales) / New debit note (purchases) for returns and discounts.',
        'Select a document to view, print, post or void it.',
      ],
      tips: ['Open is what remains after receipts, payments and notes have been applied.', 'Numbers are given when a document is posted: SI / CN for sales, PI / DN for purchases.'],
    },
    ar: {
      title: 'الفواتير والإشعارات الدائنة والمدينة',
      summary: 'جميع مستندات المبيعات أو المشتريات مع الرصيد المتبقي. تظهر تواريخ الاستحقاق المتأخرة باللون الأحمر.',
      steps: [
        'صفِّ حسب العميل أو المورد أو الحالة، أو ابحث بالرقم أو المرجع.',
        'اضغط «فاتورة جديدة»، أو «إشعار دائن جديد» (للمبيعات) أو «إشعار مدين جديد» (للمشتريات) للمرتجعات والخصومات.',
        'افتح أي مستند لعرضه أو طباعته أو ترحيله أو إلغائه.',
      ],
      tips: ['«المتبقي» هو ما يبقى بعد تخصيص التحصيلات أو المدفوعات والإشعارات.', 'يُعطى الرقم عند الترحيل: SI وCN للمبيعات، وPI وDN للمشتريات.'],
    },
  },
  {
    id: 'invoice-editor',
    section: 'trade',
    paths: ['/ar/invoices/', '/ap/invoices/'],
    en: {
      title: 'Creating an invoice or note',
      summary: 'Enter the lines, save as a draft, then post. Posting creates the journal entry on the control account automatically.',
      steps: [
        'Choose the customer or supplier, the date and, if needed, a due date (otherwise their payment terms apply).',
        'Add lines: description, revenue or expense account, cost center, quantity and unit price, and a tax code if tax applies. Subtotal, tax and total update as you type.',
        'For a foreign-currency customer or supplier, the exchange rate is taken from Currencies & rates unless you enter one.',
        'Save draft, then Post. For a credit or debit note you can choose which open invoices it settles.',
        'Print PDF gives a bilingual document with the amount in words. Void reverses a posted document if nothing has been applied to it.',
        'A posted note with an open amount shows Apply to invoices. Applied receipts and notes are listed at the bottom; the undo icon takes one back off on a date you choose.',
      ],
      tips: ['Tax goes to the tax code’s sales account on sales and its purchase account on purchases.', 'Cost center rules and budget control apply to the lines, as in manual journals.', 'To change a posted invoice, void it and enter a new one, or issue a credit / debit note.'],
    },
    ar: {
      title: 'إنشاء فاتورة أو إشعار',
      summary: 'أدخل الأسطر واحفظ كمسودة ثم رحّل. يُنشئ الترحيل قيد اليومية على حساب المراقبة تلقائياً.',
      steps: [
        'اختر العميل أو المورد والتاريخ، وتاريخ الاستحقاق عند الحاجة (وإلا تُطبق مدة السداد الخاصة به).',
        'أضف الأسطر: البيان وحساب الإيراد أو المصروف ومركز التكلفة والكمية وسعر الوحدة، ورمز الضريبة إن وُجدت. يتحدث المجموع والضريبة والإجمالي أثناء الكتابة.',
        'للعميل أو المورد بعملة أجنبية يؤخذ سعر الصرف من شاشة العملات وأسعار الصرف ما لم تُدخل سعراً.',
        'احفظ كمسودة ثم اضغط «ترحيل». وفي الإشعار الدائن أو المدين يمكنك اختيار الفواتير المفتوحة التي يسويها.',
        '«طباعة PDF» تنتج مستنداً باللغتين مع المبلغ كتابةً. و«إلغاء» يعكس المستند المرحّل إذا لم يُخصص عليه شيء.',
        'الإشعار المرحّل الذي له رصيد متبقٍ يظهر فيه زر «تخصيص على الفواتير». وتظهر التخصيصات في الأسفل، وأيقونة التراجع تلغي أي تخصيص بتاريخ تختاره.',
      ],
      tips: ['تُرحّل الضريبة إلى حساب ضريبة المبيعات لرمز الضريبة في المبيعات، وإلى حساب ضريبة المشتريات في المشتريات.', 'تُطبق قواعد مراكز التكلفة ورقابة الموازنة على الأسطر كما في القيود اليدوية.', 'لتعديل فاتورة مرحلة ألغِها وأدخل فاتورة جديدة، أو أصدر إشعاراً دائناً أو مديناً.'],
    },
  },
  {
    id: 'settlements',
    section: 'trade',
    paths: ['/ar/receipts', '/ap/payments'],
    en: {
      title: 'Receipts and payments',
      summary: 'Money received from customers or paid to suppliers, applied to their open invoices.',
      steps: [
        'Choose New receipt / New payment, then the customer or supplier; a bank account in their currency is selected for you.',
        'Enter the date and amount. Their open invoices are listed: type the amount for each, or choose Apply oldest first.',
        'Post. Anything not applied stays on their account as a credit.',
        'Open a receipt or payment to see what it settled. If part is unapplied, Apply to invoices settles more invoices later; the undo icon removes an allocation. Void reverses it and reopens the invoices.',
      ],
      tips: [
        'Paid through an account in another currency (a USD supplier from a KWD account)? Also enter the bank amount: what actually left or reached the bank fixes the rate.',
        'Applying later realises the exchange difference on the allocation date; removing or voiding undoes it.',
        'For foreign currencies, the difference between the invoice rate and today’s rate is posted automatically as a realised exchange gain or loss.',
      ],
    },
    ar: {
      title: 'سندات القبض والصرف',
      summary: 'المبالغ المستلمة من العملاء أو المدفوعة للموردين، مخصصة على فواتيرهم المفتوحة.',
      steps: [
        'اضغط «سند قبض جديد» أو «سند صرف جديد» ثم اختر العميل أو المورد؛ يُختار تلقائياً حساب بنكي بنفس عملته.',
        'أدخل التاريخ والمبلغ. تظهر فواتيره المفتوحة: أدخل المبلغ لكل فاتورة أو اضغط «التخصيص للأقدم أولاً».',
        'اضغط «ترحيل». ويبقى أي مبلغ غير مخصص رصيداً دائناً لصالحه.',
        'افتح السند لعرض ما سدده. إن بقي جزء غير مخصص فزر «تخصيص على الفواتير» يسوي فواتير أخرى لاحقاً، وأيقونة التراجع تلغي أي تخصيص. و«إلغاء» يعكس السند ويعيد فتح الفواتير.',
      ],
      tips: ['عند السداد من حساب بعملة أخرى (مورد بالدولار من حساب بالدينار) أدخل أيضاً مبلغ البنك: ما خرج من البنك أو دخله فعلاً يحدد سعر الصرف.', 'التخصيص اللاحق يحقق فرق العملة بتاريخ التخصيص، وإلغاء التخصيص أو السند يعكسه.', 'في العملات الأجنبية يُرحّل الفرق بين سعر الفاتورة وسعر السداد تلقائياً كربح أو خسارة فروقات عملة محققة.'],
    },
  },
  {
    id: 'bank-accounts',
    section: 'trade',
    paths: ['/cb/accounts'],
    en: {
      title: 'Bank and cash accounts',
      summary: 'Your bank accounts and cash boxes, each linked to a ledger account, with its balance and the date it was last reconciled.',
      steps: [
        'Choose Add: code, names, bank or cash, currency and the ledger account it uses; for banks, the bank name, account number and IBAN.',
        'Transfer moves money between two accounts. Between different currencies, also enter the amount received.',
        'Select an account to reconcile it with the bank statement.',
      ],
      tips: ['A cash box and a bank current account are created with each new company.', 'Use one ledger account per bank account so its balance and reconciliation stay clear.'],
    },
    ar: {
      title: 'حسابات البنوك والنقدية',
      summary: 'حساباتك البنكية وصناديق النقدية، كل منها مرتبط بحساب في الأستاذ العام، مع رصيده وتاريخ آخر تسوية.',
      steps: [
        'اضغط «إضافة»: الرمز والاسمان والنوع (بنك أو نقدية) والعملة والحساب المرتبط، وللبنوك اسم البنك ورقم الحساب والآيبان.',
        '«تحويل» ينقل المبالغ بين حسابين. وعند اختلاف العملة أدخل أيضاً المبلغ المستلم.',
        'افتح الحساب لإجراء التسوية البنكية مع كشف البنك.',
      ],
      tips: ['يُنشأ صندوق نقدية وحساب بنكي جاري مع كل شركة جديدة.', 'استخدم حساب أستاذ مستقلاً لكل حساب بنكي ليبقى رصيده وتسويته واضحين.'],
    },
  },
  {
    id: 'reconciliation',
    section: 'trade',
    paths: ['/cb/accounts/'],
    en: {
      title: 'Bank reconciliation',
      summary: 'Match the ledger to the bank statement: tick every movement that appears on the statement until the difference is zero.',
      steps: [
        'Choose Start reconciliation and enter the statement date and closing balance.',
        'Import statement (CSV or Excel from your bank) matches each statement line to a ledger movement of the same amount within five days and ticks it.',
        'For statement lines with no ledger entry (bank charges, interest), choose Book, pick the account, and it is posted and ticked.',
        'Tick any remaining items that are on the statement. The totals at the top update as you tick.',
        'Save to continue later, or Complete when the difference is zero.',
      ],
      tips: ['The file needs a date column and either an amount column (negative = money out) or separate debit / credit (withdrawal / deposit) columns; Arabic headers work too.', 'Items cleared by earlier reconciliations are not shown again.', 'Items not on the statement (cheques not yet presented, deposits in transit) stay unticked and appear next time.'],
    },
    ar: {
      title: 'التسوية البنكية',
      summary: 'طابق الدفاتر مع كشف البنك: حدد كل حركة ظاهرة في الكشف حتى يصبح الفرق صفراً.',
      steps: [
        'اضغط «بدء تسوية» وأدخل تاريخ الكشف ورصيده الختامي.',
        '«استيراد كشف» (CSV أو Excel من البنك) يطابق كل سطر في الكشف مع حركة في الدفاتر بنفس المبلغ خلال خمسة أيام ويحددها.',
        'لأسطر الكشف التي ليس لها قيد (عمولات بنكية، فوائد) اضغط «تسجيل» واختر الحساب، فيُرحّل القيد ويُحدد.',
        'حدد أي حركة متبقية موجودة في الكشف، وتتحدث الإجماليات في الأعلى أثناء التحديد.',
        'احفظ للمتابعة لاحقاً، أو اضغط «إتمام التسوية» عندما يصبح الفرق صفراً.',
      ],
      tips: ['يحتاج الملف عمود تاريخ، وعمود مبلغ (السالب = سحب) أو عمودي مدين ودائن (سحب وإيداع)؛ والعناوين العربية مقبولة.', 'الحركات التي سُويت سابقاً لا تظهر مرة أخرى.', 'الحركات غير الظاهرة في الكشف (شيكات لم تُصرف أو إيداعات في الطريق) تبقى دون تحديد وتظهر في التسوية التالية.'],
    },
  },

  {
    id: 'tax-codes',
    section: 'trade',
    paths: ['/gl/tax-codes'],
    en: {
      title: 'Tax codes',
      summary: 'Rates applied to invoice lines, such as VAT or a zero rate, with the accounts their tax posts to.',
      steps: [
        'Choose Add: code, names and rate in percent.',
        'Sales tax account: where tax on sales invoices is credited (a liability). Purchase tax account: where recoverable tax on purchases is debited (an asset).',
        'Pick the code on invoice lines. Reports → Tax report totals net amounts and tax per code for any date range.',
      ],
      tips: ['A code used on documents cannot be deleted; deactivate it instead.', 'Changing a rate affects new and re-saved drafts only; posted documents keep their tax.'],
    },
    ar: {
      title: 'رموز الضريبة',
      summary: 'النسب التي تُطبق على أسطر الفواتير، مثل ضريبة القيمة المضافة أو النسبة الصفرية، مع الحسابات التي تُرحّل إليها.',
      steps: [
        'اضغط «إضافة»: الرمز والاسمان والنسبة المئوية.',
        'حساب ضريبة المبيعات: يُقيد فيه دائناً ضريبة فواتير المبيعات (التزام). حساب ضريبة المشتريات: يُقيد فيه مديناً الضريبة القابلة للاسترداد (أصل).',
        'اختر الرمز في أسطر الفواتير. و«التقارير ← تقرير الضريبة» يجمع الصافي والضريبة لكل رمز لأي فترة.',
      ],
      tips: ['لا يمكن حذف رمز مستخدم في مستندات؛ أوقفه بدلاً من ذلك.', 'تغيير النسبة يؤثر على المسودات الجديدة أو المحفوظة مجدداً فقط؛ المستندات المرحّلة تحتفظ بضريبتها.'],
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
      summary: 'Import the chart of accounts, journal entries or an opening fixed asset register from Excel.',
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
      summary: 'استيراد دليل الحسابات أو القيود أو سجل افتتاحي للأصول الثابتة من ملف Excel.',
      steps: [
        'اضغط «تنزيل القالب» للحسابات أو القيود واملأه.',
        'اختر الملف واضغط «معاينة»: يُفحص كل سطر وتظهر الأخطاء برقم السطر.',
        'صحح الأخطاء في Excel وأعد المعاينة حتى تصبح جميع الأسطر سليمة.',
        'اضغط «استيراد». للقيود اختر «ترحيل القيود المستوردة» لترحيلها في الخطوة نفسها.',
      ],
      tips: ['الاستيراد كامل أو لا شيء: إذا فشل أي سطر لا يُحفظ شيء.'],
    },
  },

  // ---------------------------------------------------------------- fixed assets
  {
    id: 'asset-register',
    section: 'assets',
    paths: ['/fa/assets'],
    en: {
      title: 'Asset register',
      summary: 'Every fixed asset of the company with its cost, accumulated depreciation, net book value and status. The totals at the top cover assets in service.',
      steps: [
        'Search by code, name, serial number, location or custodian, and filter by category or status.',
        'Choose New asset to register a purchase, or Excel import to load an existing register.',
        'Select an asset to see its details, depreciation history and actions.',
      ],
      tips: [
        'Statuses: Draft (not yet in service), In service, Fully depreciated (book value has reached residual value) and Disposed.',
        'Run Reports → PP&E movement schedule at period end; it checks the register against the ledger.',
      ],
    },
    ar: {
      title: 'سجل الأصول',
      summary: 'جميع الأصول الثابتة للشركة بتكلفتها ومجمع استهلاكها وصافي قيمتها الدفترية وحالتها. الإجماليات في الأعلى تخص الأصول قيد الاستخدام.',
      steps: [
        'ابحث بالرمز أو الاسم أو الرقم التسلسلي أو الموقع أو المسؤول، وصفِّ حسب الفئة أو الحالة.',
        'اضغط «أصل جديد» لتسجيل شراء، أو «الاستيراد من Excel» لتحميل سجل قائم.',
        'افتح أي أصل لعرض تفاصيله وسجل استهلاكه والإجراءات المتاحة.',
      ],
      tips: [
        'الحالات: مسودة (لم يبدأ استخدامه)، قيد الاستخدام، مستهلك بالكامل (بلغت قيمته الدفترية القيمة التخريدية)، ومستبعد.',
        'شغّل التقارير ← جدول حركة الممتلكات والمعدات في نهاية الفترة؛ فهو يطابق السجل مع الأستاذ العام.',
      ],
    },
  },
  {
    id: 'asset-detail',
    section: 'assets',
    paths: ['/fa/assets/'],
    en: {
      title: 'Registering and managing an asset',
      summary: 'Create an asset, put it into service, and later transfer or dispose of it. Every step posts to the ledger automatically.',
      steps: [
        'Enter code, names, category, cost center, acquisition date and cost. Depreciation method, useful life and residual value come from the category unless you change them. Save.',
        'Choose Put in service. "Post the purchase now" debits the asset account and credits the account it was paid from. "The cost is already in the ledger" posts nothing; use it for opening balances, with the depreciation already charged.',
        'Transfer moves the asset to another cost center; later depreciation is charged there.',
        'Dispose / sell: enter the date and any proceeds. Depreciation is brought up to that date, cost and accumulated depreciation are removed, and the gain or loss is posted.',
        'Reverse disposal returns the asset to service if the disposal was a mistake.',
      ],
      tips: [
        'Depreciation starts on the in-service date and is pro rata by days in the first month.',
        'Draft assets can be edited or deleted. Once in service, only descriptive fields (names, location, custodian, serial number, notes) can change.',
        'The Depreciation history and History tabs link to each journal entry.',
      ],
    },
    ar: {
      title: 'تسجيل الأصل وإدارته',
      summary: 'أنشئ أصلاً وابدأ استخدامه، ثم انقله أو استبعده لاحقاً. كل خطوة تُرحّل إلى الأستاذ العام تلقائياً.',
      steps: [
        'أدخل الرمز والاسمين والفئة ومركز التكلفة وتاريخ الاقتناء والتكلفة. تؤخذ طريقة الاستهلاك والعمر الإنتاجي والقيمة التخريدية من الفئة ما لم تغيّرها. ثم احفظ.',
        'اضغط «بدء الاستخدام». خيار «ترحيل قيد الشراء الآن» يجعل حساب الأصل مديناً والحساب الذي تم الدفع منه دائناً. وخيار «التكلفة مسجلة في الدفاتر مسبقاً» لا يرحّل شيئاً؛ استخدمه للأرصدة الافتتاحية مع الاستهلاك المحتسب حتى تاريخه.',
        '«نقل» ينقل الأصل إلى مركز تكلفة آخر، ويُحمّل الاستهلاك اللاحق عليه.',
        '«استبعاد / بيع»: أدخل التاريخ والمتحصلات إن وجدت. يُحتسب الاستهلاك حتى ذلك التاريخ، ثم تُستبعد التكلفة ومجمع الاستهلاك ويُرحّل الربح أو الخسارة.',
        '«عكس الاستبعاد» يعيد الأصل إلى الاستخدام إذا تم الاستبعاد بالخطأ.',
      ],
      tips: [
        'يبدأ الاستهلاك من تاريخ بداية الاستخدام ويُحتسب في الشهر الأول بنسبة الأيام.',
        'يمكن تعديل الأصل المسودة أو حذفه. بعد بدء الاستخدام يمكن تعديل البيانات الوصفية فقط (الاسمان والموقع والمسؤول والرقم التسلسلي والملاحظات).',
        'تبويبا «سجل الاستهلاك» و«السجل» يرتبطان بكل قيد يومية.',
      ],
    },
  },
  {
    id: 'asset-categories',
    section: 'assets',
    paths: ['/fa/categories'],
    en: {
      title: 'Asset categories',
      summary: 'Categories hold the accounts and default depreciation rules for a group of assets. Land, buildings, machinery, vehicles, furniture and computers are created with the chart of accounts.',
      steps: [
        'Choose Add, or edit an existing category.',
        'Choose the depreciation method: straight line (useful life in months), declining balance (annual % of book value) or not depreciated (e.g. land). Optionally set a residual value as a percentage of cost.',
        'Choose the asset, accumulated depreciation, depreciation expense and gain/loss on disposal accounts.',
        'Tick the lock option so that only the fixed asset module can post to the asset and accumulated depreciation accounts; this keeps the register and the ledger in agreement.',
      ],
      tips: ['Changing a category affects new assets only; existing assets keep their own settings.', 'A category with assets cannot be deleted; make it inactive.'],
    },
    ar: {
      title: 'فئات الأصول',
      summary: 'تحدد الفئات الحسابات وقواعد الاستهلاك الافتراضية لمجموعة من الأصول. تُنشأ فئات الأراضي والمباني والآلات والسيارات والأثاث والحاسبات مع دليل الحسابات.',
      steps: [
        'اضغط «إضافة» أو عدّل فئة قائمة.',
        'اختر طريقة الاستهلاك: القسط الثابت (العمر الإنتاجي بالأشهر)، أو القسط المتناقص (نسبة سنوية من القيمة الدفترية)، أو لا يستهلك (مثل الأراضي). ويمكن تحديد قيمة تخريدية كنسبة من التكلفة.',
        'اختر حسابات الأصل ومجمع الاستهلاك ومصروف الاستهلاك وأرباح / خسائر الاستبعاد.',
        'فعّل خيار القفل ليقتصر الترحيل إلى حسابي الأصل ومجمع الاستهلاك على وحدة الأصول الثابتة؛ وبذلك يبقى السجل مطابقاً للأستاذ العام.',
      ],
      tips: ['تعديل الفئة يؤثر على الأصول الجديدة فقط؛ تحتفظ الأصول القائمة بإعداداتها.', 'لا يمكن حذف فئة مرتبطة بأصول؛ اجعلها غير نشطة.'],
    },
  },
  {
    id: 'depreciation',
    section: 'assets',
    paths: ['/fa/depreciation'],
    en: {
      title: 'Monthly depreciation',
      summary: 'Calculates depreciation for every asset in service for a period and posts one journal entry, split by expense account and cost center.',
      steps: [
        'Choose the period and Preview: each asset shows the dates covered and the amount.',
        'Choose Post depreciation. The entry is dated on the last day of the period.',
        'If a mistake is found, Reverse the latest run, correct the assets, and post it again.',
      ],
      tips: [
        'Run periods in order. If a month was skipped, the next run catches it up automatically.',
        'Only the latest run can be reversed, and only while its period is open.',
        'Assets reach Fully depreciated status automatically when book value reaches residual value.',
      ],
    },
    ar: {
      title: 'الاستهلاك الشهري',
      summary: 'يحتسب الاستهلاك لكل أصل قيد الاستخدام عن الفترة ويرحّل قيداً واحداً موزعاً حسب حساب المصروف ومركز التكلفة.',
      steps: [
        'اختر الفترة واضغط «معاينة»: يظهر لكل أصل الفترة المغطاة والمبلغ.',
        'اضغط «ترحيل الاستهلاك». يكون القيد بتاريخ آخر يوم في الفترة.',
        'عند اكتشاف خطأ، اعكس آخر عملية، وصحّح الأصول، ثم رحّلها مجدداً.',
      ],
      tips: [
        'رحّل الفترات بالترتيب. إذا تم تخطي شهر فإن العملية التالية تحتسبه تلقائياً.',
        'يمكن عكس آخر عملية فقط، وما دامت فترتها مفتوحة.',
        'تتحول الأصول تلقائياً إلى «مستهلك بالكامل» عندما تبلغ قيمتها الدفترية القيمة التخريدية.',
      ],
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
        'Receivables and payables ageing, customer and supplier statements, tax report, trial balance, account statement, journal register, income statement, balance sheet, cash flow, cost center analysis and summary, budget vs actual, designed statements, intercompany reconciliation, consolidated reports, and the fixed asset register, PP&E movement schedule and depreciation forecast.',
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
        'أعمار ديون العملاء والموردين، وكشوف حسابات العملاء والموردين، وتقرير الضريبة، وميزان المراجعة، وكشف الحساب، ودفتر اليومية، وقائمة الدخل، والمركز المالي، والتدفقات النقدية، وتحليل مراكز التكلفة وملخصها، والموازنة مقابل الفعلي، والقوائم المصممة، ومطابقة الحسابات بين الشركات، والتقارير الموحدة، وسجل الأصول الثابتة وجدول حركة الممتلكات والمعدات وتوقعات الاستهلاك.',
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
  {
    id: 'platform-plans',
    section: 'platform',
    paths: ['/platform/plans'],
    en: {
      title: 'Subscription plans',
      summary: 'Plans decide which modules a tenant can open, and the default number of companies and users.',
      steps: [
        'Choose New plan: code, Arabic and English names, description, monthly price, and default company and user limits.',
        'Tick the modules the plan includes. Each module opens or closes all of its screens, reports and actions together, so a tenant never sees half a module.',
        'Modules a module needs are ticked with it (sales and purchases need bank and cash), and unticking a module also unticks the modules that depend on it. The general ledger is always included.',
        'Mark one plan as the default: it is used for self-service sign-up and for new tenants created without a plan.',
        'On the Tenants tab, edit a tenant to move it to another plan. The change applies on the tenant\'s next request; hidden modules keep their data and reappear when the plan includes them again.',
      ],
      tips: ['A plan in use, or the default plan, cannot be deleted. Deactivate a plan to stop offering it; tenants already on it keep it.', 'Users on a tenant see only the modules of their plan in the menu, reports list and search.'],
    },
    ar: {
      title: 'باقات الاشتراك',
      summary: 'تحدد الباقات الوحدات التي يمكن للمؤسسة استخدامها، والعدد الافتراضي للشركات والمستخدمين.',
      steps: [
        'اضغط «باقة جديدة»: الرمز والاسمان والوصف والسعر الشهري وحدود الشركات والمستخدمين الافتراضية.',
        'حدد الوحدات المشمولة. كل وحدة تفتح أو تغلق جميع شاشاتها وتقاريرها وإجراءاتها معاً، فلا ترى المؤسسة نصف وحدة.',
        'الوحدات التي تحتاجها الوحدة تُحدد معها (المبيعات والمشتريات تحتاجان البنوك والنقدية)، وإلغاء وحدة يلغي الوحدات المعتمدة عليها. الأستاذ العام مشمول دائماً.',
        'اجعل إحدى الباقات افتراضية: تُستخدم للتسجيل الذاتي وللمؤسسات الجديدة التي تُنشأ دون باقة.',
        'من تبويب «المؤسسات» عدّل المؤسسة لنقلها إلى باقة أخرى. يسري التغيير من الطلب التالي، والوحدات المخفية تحتفظ ببياناتها وتعود عند إعادة إدراجها في الباقة.',
      ],
      tips: ['لا يمكن حذف باقة مستخدمة أو الباقة الافتراضية. أوقف الباقة لإيقاف عرضها، وتبقى المؤسسات المشتركة فيها عليها.', 'يرى مستخدمو المؤسسة وحدات باقتهم فقط في القائمة وقائمة التقارير والبحث.'],
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
