import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type IntercompanyTransactionInput, Money, type ReportColumn, type ReportRow, sumAmounts, toMoney, toStorage } from '@erp/shared';
import type { z } from 'zod';
import type { intercompanyPartnerSchema } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { FiscalService } from './fiscal.service';
import { type CompanyInfo, loadCompany, PostingEngine } from './posting.engine';
import { ReportsService, t } from './reports.service';

type Partner = { id: string; company_id: string; partner_company_id: string; due_from_account_id: string; due_to_account_id: string };
type Line = { account_id: string; cost_center_id?: string | null; description?: string | null; debit: string; credit: string };

/**
 * Intercompany transactions: one business event booked in two companies of the same tenant.
 * Each side is balanced automatically by its "due from / due to" account for the other company,
 * both entries post in one transaction, and reversing either reverses both.
 */
@Injectable()
export class IntercompanyService {
  constructor(
    private readonly db: DbService,
    private readonly engine: PostingEngine,
    private readonly fiscal: FiscalService,
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  listPartners(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT p.id, p.partner_company_id, c.code AS partner_code, c.name_ar AS partner_name_ar, c.name_en AS partner_name_en,
                p.due_from_account_id, df.code AS due_from_code, p.due_to_account_id, dt.code AS due_to_code
         FROM gl.intercompany_partners p
         JOIN core.companies c ON c.id = p.partner_company_id
         JOIN gl.accounts df ON df.id = p.due_from_account_id
         JOIN gl.accounts dt ON dt.id = p.due_to_account_id
         WHERE p.company_id = $1 ORDER BY c.code`,
        [ctx.companyId],
      ),
    );
  }

  savePartner(ctx: CompanyContext, input: z.infer<typeof intercompanyPartnerSchema>) {
    return this.db.withTenant(ctx, async (tx) => {
      if (input.partner_company_id === ctx.companyId) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'partner_company_id', message: 'Choose another company' }]);
      for (const accountId of [input.due_from_account_id, input.due_to_account_id]) {
        const account = await tx.maybeOne<{ is_posting: boolean }>('SELECT is_posting FROM gl.accounts WHERE company_id = $1 AND id = $2', [ctx.companyId, accountId]);
        if (!account?.is_posting) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'account', message: 'Must be a posting account of this company' }]);
      }
      const row = await tx.one<{ id: string }>(
        `INSERT INTO gl.intercompany_partners (tenant_id, company_id, partner_company_id, due_from_account_id, due_to_account_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, company_id, partner_company_id) DO UPDATE SET due_from_account_id = EXCLUDED.due_from_account_id, due_to_account_id = EXCLUDED.due_to_account_id
         RETURNING id`,
        [ctx.tenantId, ctx.companyId, input.partner_company_id, input.due_from_account_id, input.due_to_account_id],
      );
      await this.audit.record(tx, ctx, { action: 'save', entityType: 'intercompany_partner', entityId: row.id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  removePartner(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await tx.query('DELETE FROM gl.intercompany_partners WHERE company_id = $1 AND id = $2 RETURNING id', [ctx.companyId, id]);
      if (!rows.length) throw notFound('intercompany partner');
      return { deleted: true };
    });
  }

  create(ctx: CompanyContext, input: IntercompanyTransactionInput) {
    return this.db.withTenant(ctx, async (tx) => {
      const targetCtx: CompanyContext = { ...ctx, companyId: input.target_company_id };
      const target = await tx.maybeOne<{ code: string; is_active: boolean }>('SELECT code, is_active FROM core.companies WHERE id = $1', [input.target_company_id]);
      if (!target?.is_active || input.target_company_id === ctx.companyId) throw notFound('company');
      const source = await tx.one<{ code: string }>('SELECT code FROM core.companies WHERE id = $1', [ctx.companyId]);
      const sourceCompany = await loadCompany(tx, ctx.companyId);
      const targetCompany = await loadCompany(tx, input.target_company_id);
      if (sourceCompany.base_currency !== targetCompany.base_currency) throw new AppError('IC_CURRENCY_MISMATCH');

      const sourcePartner = await this.partner(tx, ctx.companyId, input.target_company_id, source.code, target.code);
      const targetPartner = await this.partner(tx, input.target_company_id, ctx.companyId, target.code, source.code);
      const net = (lines: Line[]) => sumAmounts(lines.map((l) => l.debit)).minus(sumAmounts(lines.map((l) => l.credit)));
      const sourceNet = net(input.source_lines);
      const targetNet = net(input.target_lines);
      if (sourceNet.isZero() || !sourceNet.plus(targetNet).isZero()) {
        throw new AppError('IC_UNBALANCED', { source: sourceNet.toString(), target: targetNet.toString() });
      }

      const linkId = randomUUID();
      const sourceEntry = await this.book(tx, ctx, sourceCompany, input, input.source_lines, sourcePartner, sourceNet, linkId, target.code);
      const targetEntry = await this.book(tx, targetCtx, targetCompany, input, input.target_lines, targetPartner, targetNet, linkId, source.code);
      await tx.query(
        `INSERT INTO gl.intercompany_links (tenant_id, id, source_company_id, source_entry_id, target_company_id, target_entry_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ctx.tenantId, linkId, ctx.companyId, sourceEntry.id, input.target_company_id, targetEntry.id, ctx.userId],
      );
      await this.audit.record(tx, ctx, { action: 'create', entityType: 'intercompany', entityId: linkId, companyId: ctx.companyId, newData: { target: target.code } });
      return { link_id: linkId, source_entry_id: sourceEntry.id, source_entry_no: sourceEntry.entry_no, target_entry_id: targetEntry.id, target_entry_no: targetEntry.entry_no, warnings: [...sourceEntry.warnings, ...targetEntry.warnings] };
    });
  }

  /** If the entry belongs to an intercompany pair, reverses the other side too. */
  async reverseCounterpart(tx: Tx, ctx: CompanyContext, entryId: string, date?: string): Promise<void> {
    const link = await tx.maybeOne<{ source_company_id: string; source_entry_id: string; target_company_id: string; target_entry_id: string }>(
      'SELECT * FROM gl.intercompany_links WHERE source_entry_id = $1 OR target_entry_id = $1',
      [entryId],
    );
    if (!link) return;
    const [otherCompany, otherEntry] = link.source_entry_id === entryId ? [link.target_company_id, link.target_entry_id] : [link.source_company_id, link.source_entry_id];
    const status = await tx.one<{ status: string }>('SELECT status FROM gl.journal_entries WHERE id = $1', [otherEntry]);
    if (status.status !== 'POSTED') return;
    const otherCtx: CompanyContext = { ...ctx, companyId: otherCompany };
    await this.engine.reverse(tx, otherCtx, await loadCompany(tx, otherCompany), otherEntry, { date });
  }

  /** Per partner: what this company carries against what the partner carries, from linked entries. */
  reconciliation(ctx: CompanyContext, asOf: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.reports.company(tx, ctx.companyId);
      const partners = await tx.query<Partner & { code: string; name_ar: string; name_en: string }>(
        `SELECT p.*, c.code, c.name_ar, c.name_en FROM gl.intercompany_partners p JOIN core.companies c ON c.id = p.partner_company_id
         WHERE p.company_id = $1 ORDER BY c.code`,
        [ctx.companyId],
      );
      const balance = async (companyId: string, partnerId: string, accounts: string[]) =>
        toMoney(
          (
            await tx.one<{ net: string }>(
              `SELECT COALESCE(sum(l.debit_base - l.credit_base), 0) AS net
               FROM gl.journal_lines l JOIN gl.journal_entries e ON e.id = l.entry_id
               JOIN gl.intercompany_links k ON k.id::text = e.source_doc_id
               WHERE l.company_id = $1 AND e.source_doc_type = 'INTERCOMPANY' AND e.status IN ('POSTED', 'REVERSED') AND e.entry_date <= $2
                 AND l.account_id = ANY($3::uuid[])
                 AND ((k.source_company_id = $1 AND k.target_company_id = $4) OR (k.target_company_id = $1 AND k.source_company_id = $4))`,
              [companyId, asOf, accounts, partnerId],
            )
          ).net,
        );
      const minor = company.minor_units;
      const columns: ReportColumn[] = [
        { key: 'code', label: t('الشركة', 'Company'), kind: 'text', width: 10 },
        { key: 'name', label: t('الشركة الشريكة', 'Partner company'), kind: 'bilingual', width: 34 },
        { key: 'ours', label: t('رصيدنا (مدين +)', 'Our balance (debit +)'), kind: 'amount' },
        { key: 'theirs', label: t('رصيد الشريك (مدين +)', "Partner's balance (debit +)"), kind: 'amount' },
        { key: 'difference', label: t('الفرق', 'Difference'), kind: 'amount' },
      ];
      const rows: ReportRow[] = [];
      let unreconciled = 0;
      for (const p of partners) {
        const ours = await balance(ctx.companyId, p.partner_company_id, [p.due_from_account_id, p.due_to_account_id]);
        const mirror = await tx.maybeOne<Partner>('SELECT * FROM gl.intercompany_partners WHERE company_id = $1 AND partner_company_id = $2', [p.partner_company_id, ctx.companyId]);
        const theirs = mirror ? await balance(p.partner_company_id, ctx.companyId, [mirror.due_from_account_id, mirror.due_to_account_id]) : new Money(0);
        const difference = ours.plus(theirs);
        if (!difference.isZero()) unreconciled++;
        rows.push({ cells: { code: p.code, name: t(p.name_ar, p.name_en), ours: ours.toFixed(minor), theirs: theirs.toFixed(minor), difference: difference.toFixed(minor) } });
      }
      return this.reports.document('intercompany-reconciliation', t('مطابقة الأرصدة بين الشركات', 'Intercompany reconciliation'), company, columns, rows, [t(`كما في ${asOf}`, `As at ${asOf}`)], [
        unreconciled === 0 ? t('جميع الأرصدة متطابقة', 'All balances agree') : t(`${unreconciled} شركاء بأرصدة غير متطابقة`, `${unreconciled} partners do not agree`),
        t('تتم المطابقة على القيود المنشأة كعمليات بين الشركات', 'Matches entries created as intercompany transactions'),
      ]);
    });
  }

  private async partner(tx: Tx, companyId: string, partnerId: string, code: string, partnerCode: string): Promise<Partner> {
    const row = await tx.maybeOne<Partner>('SELECT * FROM gl.intercompany_partners WHERE company_id = $1 AND partner_company_id = $2', [companyId, partnerId]);
    if (!row) throw new AppError('IC_PARTNER_MISSING', { company: code, partner: partnerCode });
    return row;
  }

  /** Books one side: the user's lines plus the balancing intercompany line, then posts. */
  private async book(
    tx: Tx,
    ctx: CompanyContext,
    company: CompanyInfo,
    input: IntercompanyTransactionInput,
    lines: Line[],
    partner: Partner,
    net: InstanceType<typeof Money>,
    linkId: string,
    partnerCode: string,
  ) {
    const period = await this.fiscal.resolvePeriod(tx, ctx.companyId, input.entry_date);
    const type = await tx.one<{ id: string }>("SELECT id FROM gl.journal_types WHERE company_id = $1 AND code = 'IC'", [ctx.companyId]);
    const entry = await tx.one<{ id: string }>(
      `INSERT INTO gl.journal_entries (tenant_id, company_id, journal_type_id, fiscal_year_id, period_id, entry_date, description, reference,
         source_module, source_doc_type, source_doc_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'GL', 'INTERCOMPANY', $9, $10) RETURNING id`,
      [ctx.tenantId, ctx.companyId, type.id, period.fiscal_year_id, period.id, input.entry_date, input.description ?? null, input.reference ?? null, linkId, ctx.userId],
    );
    // A net debit on the user's lines is owed to the partner (due to); a net credit is owed by it (due from).
    const balancing = {
      account_id: net.isPositive() ? partner.due_to_account_id : partner.due_from_account_id,
      cost_center_id: null,
      description: `Intercompany ${partnerCode} / بين الشركات ${partnerCode}`,
      currency_code: company.base_currency,
      debit: net.isNegative() ? toStorage(net.abs()) : '0',
      credit: net.isPositive() ? toStorage(net) : '0',
      dimensions: [],
    };
    const all = [
      ...lines.map((l) => ({ account_id: l.account_id, cost_center_id: l.cost_center_id ?? null, description: l.description ?? null, currency_code: company.base_currency, debit: l.debit, credit: l.credit, dimensions: [] })),
      balancing,
    ];
    const totals = await this.engine.insertLines(tx, ctx, company, entry.id, input.entry_date, all);
    await tx.query('UPDATE gl.journal_entries SET total_debit = $2, total_credit = $3 WHERE id = $1', [entry.id, totals.debit.toFixed(4), totals.credit.toFixed(4)]);
    const locked = await this.engine.lockEntry(tx, ctx.companyId, entry.id);
    const posted = await this.engine.post(tx, ctx, company, locked);
    return { id: entry.id, entry_no: posted.entry_no, warnings: posted.warnings };
  }
}
