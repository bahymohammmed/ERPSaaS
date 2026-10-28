import { Injectable } from '@nestjs/common';
import { Money, type RateType, roundToMinor, toMoney, toStorage } from '@erp/shared';
import { AppError } from '../common/app-error';
import { addDays } from '../common/dates';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { FiscalService } from './fiscal.service';
import { findRate } from './masters.service';
import { type CompanyInfo, loadCompany, PostingEngine } from './posting.engine';

export type RevaluationLine = {
  account_id: string;
  account_code: string;
  account_name_ar: string;
  account_name_en: string;
  cost_center_id: string | null;
  cost_center_code: string | null;
  currency_code: string;
  foreign_balance: string;
  base_balance: string;
  rate: string;
  revalued_balance: string;
  difference: string;
};

/**
 * Period-end revaluation of foreign-currency monetary balances (accounts flagged `revalue`).
 * Adjustments are base-currency-only lines on the original currency, so the next revaluation
 * sees the adjusted carrying amount. The entry normally auto-reverses the next day.
 */
@Injectable()
export class FxRevaluationService {
  constructor(
    private readonly db: DbService,
    private readonly fiscal: FiscalService,
    private readonly engine: PostingEngine,
  ) {}

  preview(ctx: CompanyContext, input: { revaluation_date: string; rate_type: RateType }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      return this.compute(tx, ctx, company, input.revaluation_date, input.rate_type);
    });
  }

  post(ctx: CompanyContext, input: { revaluation_date: string; rate_type: RateType; auto_reverse: boolean }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      if (!company.fx_gain_account_id || !company.fx_loss_account_id) throw new AppError('FX_ACCOUNTS_MISSING');
      const result = await this.compute(tx, ctx, company, input.revaluation_date, input.rate_type);
      if (result.lines.length === 0) throw new AppError('NOTHING_TO_PROCESS');

      const period = await this.fiscal.resolvePeriod(tx, ctx.companyId, input.revaluation_date);
      const type = await tx.one<{ id: string }>("SELECT id FROM gl.journal_types WHERE company_id = $1 AND code = 'FXR'", [ctx.companyId]);
      const entry = await tx.one<{ id: string }>(
        `INSERT INTO gl.journal_entries (tenant_id, company_id, journal_type_id, fiscal_year_id, period_id, entry_date, description,
           source_module, source_doc_type, source_doc_id, created_by, auto_reverse_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'GL', 'FX_REVALUATION', $8, $9, $10) RETURNING id`,
        [
          ctx.tenantId,
          ctx.companyId,
          type.id,
          period.fiscal_year_id,
          period.id,
          input.revaluation_date,
          `إعادة تقييم العملات الأجنبية ${input.revaluation_date} / FX revaluation ${input.revaluation_date}`,
          input.revaluation_date,
          ctx.userId,
          input.auto_reverse ? addDays(input.revaluation_date, 1) : null,
        ],
      );
      let lineNo = 0;
      const insert = async (accountId: string, costCenterId: string | null, currency: string, rate: string, diff: InstanceType<typeof Money>, description: string) => {
        lineNo++;
        await tx.query(
          `INSERT INTO gl.journal_lines (tenant_id, company_id, entry_id, line_no, account_id, cost_center_id, description, currency_code,
             exchange_rate, debit, credit, debit_base, credit_base)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 0, $10, $11)`,
          [
            ctx.tenantId,
            ctx.companyId,
            entry.id,
            lineNo,
            accountId,
            costCenterId,
            description,
            currency,
            rate,
            toStorage(diff.isPositive() ? diff : '0'),
            toStorage(diff.isNegative() ? diff.abs() : '0'),
          ],
        );
      };
      for (const line of result.lines) {
        await insert(line.account_id, line.cost_center_id, line.currency_code, line.rate, toMoney(line.difference), `${line.currency_code} @ ${line.rate}`);
      }
      const net = toMoney(result.net_difference);
      // A net increase in carrying amounts is an unrealised gain (credit); a decrease is a loss (debit).
      await insert(
        net.isPositive() ? company.fx_gain_account_id : company.fx_loss_account_id,
        null,
        company.base_currency,
        '1',
        net.negated(),
        net.isPositive() ? 'Unrealised FX gain / أرباح فروقات عملة غير محققة' : 'Unrealised FX loss / خسائر فروقات عملة غير محققة',
      );
      const locked = await this.engine.lockEntry(tx, ctx.companyId, entry.id);
      await this.engine.post(tx, ctx, company, locked, { preserveBase: true, allowZeroTx: true, systemEntry: true });
      return { entry_id: entry.id, ...result };
    });
  }

  private async compute(tx: Tx, ctx: CompanyContext, company: CompanyInfo, date: string, rateType: RateType) {
    const balances = await tx.query<{
      account_id: string;
      account_code: string;
      account_name_ar: string;
      account_name_en: string;
      cost_center_id: string | null;
      cost_center_code: string | null;
      currency_code: string;
      foreign_balance: string;
      base_balance: string;
    }>(
      `SELECT l.account_id, a.code AS account_code, a.name_ar AS account_name_ar, a.name_en AS account_name_en,
              l.cost_center_id, c.code AS cost_center_code, l.currency_code,
              sum(l.debit - l.credit) AS foreign_balance, sum(l.debit_base - l.credit_base) AS base_balance
       FROM gl.journal_lines l
       JOIN gl.journal_entries e ON e.id = l.entry_id
       JOIN gl.accounts a ON a.id = l.account_id
       LEFT JOIN gl.cost_centers c ON c.id = l.cost_center_id
       WHERE l.company_id = $1 AND a.revalue AND l.currency_code <> $2 AND e.status IN ('POSTED', 'REVERSED') AND e.entry_date <= $3
       GROUP BY l.account_id, a.code, a.name_ar, a.name_en, l.cost_center_id, c.code, l.currency_code
       ORDER BY a.code, l.currency_code`,
      [ctx.companyId, company.base_currency, date],
    );
    const rates = new Map<string, string>();
    const lines: RevaluationLine[] = [];
    let net = new Money(0);
    for (const b of balances) {
      if (!rates.has(b.currency_code)) {
        const rate = await findRate(tx, ctx.companyId, b.currency_code, date, rateType).catch(async (error: unknown) => {
          if (rateType === 'SPOT') throw error;
          return findRate(tx, ctx.companyId, b.currency_code, date, 'SPOT');
        });
        rates.set(b.currency_code, rate);
      }
      const rate = rates.get(b.currency_code) ?? '1';
      const revalued = roundToMinor(toMoney(b.foreign_balance).times(rate), company.base_minor_units);
      const diff = revalued.minus(b.base_balance);
      if (diff.isZero()) continue;
      net = net.plus(diff);
      lines.push({
        ...b,
        foreign_balance: toMoney(b.foreign_balance).toFixed(4),
        base_balance: toMoney(b.base_balance).toFixed(company.base_minor_units),
        rate: toMoney(rate).toString(),
        revalued_balance: revalued.toFixed(company.base_minor_units),
        difference: diff.toFixed(company.base_minor_units),
      });
    }
    return { revaluation_date: date, rate_type: rateType, lines, net_difference: net.toFixed(company.base_minor_units) };
  }
}
