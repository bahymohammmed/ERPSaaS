import { Injectable } from '@nestjs/common';
import { sumAmounts, toStorage } from '@erp/shared';
import { DbService } from '../db/db.service';
import type { CompanyContext } from '../common/request-context';
import { OPERATING_BALANCES } from './reports.service';

type MonthRow = { period_id: string; code: string; name_ar: string; name_en: string; start_date: string; revenue: string; expense: string };

/** Headline figures for the dashboard, in the company base currency, from posted balances. */
@Injectable()
export class DashboardService {
  constructor(private readonly db: DbService) {}

  financials(ctx: CompanyContext, today: string) {
    // Aggregates over the whole company would bypass a user's cost center restriction.
    if (ctx.costCenterScope) return Promise.resolve({ available: false as const });
    return this.db.withTenant(ctx, async (tx) => {
      const year = await tx.maybeOne<{ id: string; code: string }>(
        `SELECT id, code FROM gl.fiscal_years WHERE company_id = $1
         ORDER BY (start_date <= $2::date AND end_date >= $2::date) DESC, start_date DESC LIMIT 1`,
        [ctx.companyId, today],
      );
      if (!year) return { available: false as const };
      const months = await tx.query<MonthRow>(
        `SELECT p.id AS period_id, p.code, p.name_ar, p.name_en, p.start_date,
                COALESCE(sum(CASE WHEN a.account_type = 'REVENUE' THEN b.credit_base - b.debit_base END), 0)::text AS revenue,
                COALESCE(sum(CASE WHEN a.account_type = 'EXPENSE' THEN b.debit_base - b.credit_base END), 0)::text AS expense
         FROM gl.fiscal_periods p
         LEFT JOIN ${OPERATING_BALANCES} b ON b.period_id = p.id AND b.company_id = p.company_id
         LEFT JOIN gl.accounts a ON a.id = b.account_id
         WHERE p.company_id = $1 AND p.fiscal_year_id = $2 AND NOT p.is_adjustment
         GROUP BY p.id, p.code, p.name_ar, p.name_en, p.start_date, p.period_no ORDER BY p.period_no`,
        [ctx.companyId, year.id],
      );
      const cash = await tx.one<{ balance: string }>(
        `SELECT COALESCE(sum(b.debit_base - b.credit_base), 0)::text AS balance
         FROM gl.account_balances b JOIN gl.accounts a ON a.id = b.account_id JOIN gl.fiscal_periods p ON p.id = b.period_id
         WHERE b.company_id = $1 AND a.cash_flow_category = 'CASH' AND p.start_date <= $2::date`,
        [ctx.companyId, today],
      );
      const toDate = months.filter((m) => m.start_date <= today);
      const revenue = sumAmounts(toDate.map((m) => m.revenue));
      const expense = sumAmounts(toDate.map((m) => m.expense));
      return {
        available: true as const,
        fiscal_year: year.code,
        months,
        cash_balance: cash.balance,
        revenue_ytd: toStorage(revenue),
        expense_ytd: toStorage(expense),
        net_profit_ytd: toStorage(revenue.minus(expense)),
      };
    });
  }
}
