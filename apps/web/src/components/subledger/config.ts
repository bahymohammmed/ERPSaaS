import type { LedgerSide, Permission } from '@erp/shared';
import type { MessageKey } from '@/i18n/messages';

/** Routes and wording for each side; screens are shared between customers and suppliers. */
export const SIDE_UI: Record<
  LedgerSide,
  {
    parties: string;
    documents: string;
    settlements: string;
    party: MessageKey;
    partiesTitle: MessageKey;
    newParty: MessageKey;
    documentsTitle: MessageKey;
    settlementsTitle: MessageKey;
    newSettlement: MessageKey;
    note: 'CREDIT_NOTE' | 'DEBIT_NOTE';
    newNote: MessageKey;
    view: Permission;
    manage: Permission;
    lineAccountType: 'REVENUE' | 'EXPENSE';
  }
> = {
  AR: {
    parties: '/ar/customers',
    documents: '/ar/invoices',
    settlements: '/ar/receipts',
    party: 'customer',
    partiesTitle: 'navCustomers',
    newParty: 'newCustomer',
    documentsTitle: 'navSalesInvoices',
    settlementsTitle: 'navReceipts',
    newSettlement: 'newReceipt',
    note: 'CREDIT_NOTE',
    newNote: 'newCreditNote',
    view: 'ar.view',
    manage: 'ar.manage',
    lineAccountType: 'REVENUE',
  },
  AP: {
    parties: '/ap/suppliers',
    documents: '/ap/invoices',
    settlements: '/ap/payments',
    party: 'supplier',
    partiesTitle: 'navSuppliers',
    newParty: 'newSupplier',
    documentsTitle: 'navPurchaseInvoices',
    settlementsTitle: 'navPayments',
    newSettlement: 'newPayment',
    note: 'DEBIT_NOTE',
    newNote: 'newDebitNote',
    view: 'ap.view',
    manage: 'ap.manage',
    lineAccountType: 'EXPENSE',
  },
};

export type Party = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  currency_code: string;
  control_account_id: string;
  control_account_code: string;
  default_account_id: string | null;
  payment_terms_days: number;
  credit_limit: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  tax_no: string | null;
  commercial_reg_no: string | null;
  notes: string | null;
  is_active: boolean;
  balance: string;
};

export type PartyDocument = {
  id: string;
  doc_type: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  doc_no: string | null;
  party_id: string;
  party_code: string;
  party_name_ar: string;
  party_name_en: string;
  doc_date: string;
  due_date: string;
  currency_code: string;
  exchange_rate: string;
  reference: string | null;
  description: string | null;
  total: string;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  open_amount: string;
};

export type BankAccount = { id: string; code: string; name_ar: string; name_en: string; kind: 'BANK' | 'CASH'; currency_code: string; account_id: string; is_active: boolean; balance: string; balance_base: string };

export const DOC_STATUS_COLORS = { DRAFT: 'gray', POSTED: 'teal', VOID: 'red' } as const;
