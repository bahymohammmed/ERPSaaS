# ERP — General Ledger module

Multi-tenant SaaS ERP. This first module is the General Ledger. It is built for Kuwait: KWD with 3 decimals, IFRS chart of accounts, and Arabic/English throughout.

| Layer | Technology |
|---|---|
| Database | PostgreSQL 16: row-level security (RLS), `NUMERIC` money, ICU, `pg_trgm` |
| API | NestJS 11 (TypeScript), `pg`, zod, decimal.js |
| Web | Next.js 15 (App Router), React 19, Mantine 7 (RTL), TanStack Query |
| Shared | `@erp/shared`: enums, money math, zod schemas, error catalogue, report model |
| Export | Headless Chromium for PDF (Arabic shaping, bidi), exceljs for Excel (RTL sheets) |

## Quick start

```bash
pnpm install
pnpm build:shared

# PostgreSQL: either a local server (run as a superuser) …
sudo -u postgres bash scripts/db-setup.sh
# … or Docker
docker compose up -d

cp apps/api/.env.example apps/api/.env
pnpm db:migrate          # schema + reference data (currencies)
pnpm db:seed-demo        # optional: demo tenant with 10 months of postings

pnpm dev:api             # http://localhost:4000/api
pnpm dev:web             # http://localhost:3000
```

Demo login: `demo@example.com` / `demo-password-123`.

Tests run against a real PostgreSQL database (`erp_test`). That database is rebuilt from the migrations on every run.

```bash
pnpm test
```

## Deployment

Cloudflare (Workers + Containers, with a managed PostgreSQL): see [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md). The `Dockerfile` at the root builds one image containing the API, the web app and Chromium, and runs on any container host.

## Repository layout

```
packages/shared     Types, schemas and money math shared by API and web
apps/api
  src/db            Migrations (SQL), migration runner, Kuwait COA template, demo seed
  src/common        Auth guard, request context, errors, audit, hierarchy helpers
  src/platform      Signup/login, tenant provisioning, companies, users, roles, audit log
  src/gl            Master data, fiscal calendar, posting engine, journals, reports, export
  test              End-to-end tests (HTTP + direct SQL against RLS)
apps/web            Next.js UI: auth, GL master data, journal editor, reports, admin
```

## Features

### Master data
- **Chart of accounts**: unlimited hierarchy of header and posting accounts.
  - Type and normal balance.
  - Cost center rule: required, optional or not allowed.
  - Default cost center, and a whitelist of allowed cost centers (subtree-aware).
  - Allowed currencies.
  - Control accounts, which only their owning sub-ledger can post to.
  - Cash-flow category, and dimension rules per account.
- **Cost centers**: hierarchy with a type (production, service, administrative, sales), a manager, validity dates and an active flag.
- **Dimensions**: any number of extra analytical dimensions (project, branch, …), each with values and per-account rules.
- **Distribution templates**: percentage splits across cost centers, for example rent at 40/35/25.
- **Journal types**: user types plus system types that only the posting engine uses (REV, CLS, FXR, AP, AR, INV, PAY).
- **Currencies and exchange rates**: ISO 4217 minor units (KWD/BHD/OMR = 3). Dated rates of type SPOT, AVERAGE or CLOSING.
- **Fiscal calendar**: 12 monthly periods plus an optional adjustment period 13. Each period has a status of OPEN, CLOSED or LOCKED per module (GL, AP, AR, INV, PAY).

### Journal entries
- **Lifecycle**: `DRAFT → SUBMITTED → APPROVED → POSTED → REVERSED`.
  - Approval is enforced per company.
  - The creator of an entry cannot approve it.
  - A rejection returns the entry to draft with a reason.
- **Lines**:
  - Multi-currency, with a rate taken from the line or looked up from the rate table.
  - Amounts are validated against the currency's decimal places.
  - Each line carries a cost center, dimensions, and an optional split by template or by manual percentage/amount.
- **Attachments**: PDF, images and office files up to 10 MB, stored under a tenant/company prefix.
- **Reversal**: creates a mirror entry with the same rates and base amounts. The original is marked REVERSED and linked.

### Posting engine (`apps/api/src/gl/posting.engine.ts`)
The only path into the ledger. In one transaction it:
1. Checks that the period is open for the source module.
2. Expands cost-center distributions. Each piece is rounded to the currency's minor units, and the last piece takes the remainder.
3. Validates every line:
   - The account is an active posting account and accepts the currency.
   - Control-account ownership.
   - Cost center rule, whitelist, validity dates, and the user's cost-center scope.
   - Dimension rules.
4. Balances the entry.
   - Single-currency entries must balance in that currency.
   - Every entry must balance in base currency.
   - A difference of up to one fils per line is booked to the company's rounding account.
5. Assigns a gapless number per journal type and fiscal year (`JV-2026-000001`), using a counter row locked `FOR UPDATE`.
6. Updates the `account_balances` summary.
7. Writes the audit trail.

`POST /api/gl/postings` is the integration entry point for sub-ledgers. It validates and posts in one call and is idempotent per `idempotency_key`.

### Reports
Every report can be viewed on screen or exported as PDF or Excel, in Arabic, English, or both side by side.

| Report | Notes |
|---|---|
| Trial balance | Opening, movement and closing. P&L accounts restart each fiscal year, and an unclosed prior-year result is shown so the report always balances. Filter by cost center subtree or account level. |
| Account statement | Opening balance, running balance, foreign amount and rate. Drills into the entry. |
| Journal register | Posted entries with lines and totals. |
| Income statement | Account hierarchy to any level, cost center filter, prior-year comparison. |
| Statement of financial position | Current-year result and unclosed prior years shown in equity, with a balance check and prior-year comparison. |
| Cost center analysis | Accounts × child cost centers, each rolled up over its subtree, with net profit per column. |
| Cost center summary | Revenue, expense and net for the whole cost center hierarchy. |

Reports read the `account_balances` summary. `gl.rebuild_balances(company)` rebuilds it from posted lines, and a test asserts that the rebuild matches.

### Period-end and planning (phase 2)
- **Accruals**: an entry with an auto-reverse date gets its mirror entry posted automatically on that date.
- **Recurring entries**: any posted or draft entry can become a monthly, quarterly, semi-annual or yearly schedule.
  - Each run posts automatically, or is submitted for approval when the company requires it.
  - An hourly scheduler catches up missed runs; a day of 31 falls on the last day of shorter months.
  - Failures are recorded on the schedule, which does not advance until the run succeeds.
- **Approval threshold**: entries below a company-defined amount can post without approval.
- **FX revaluation**: foreign-currency balances on accounts flagged *revalue* are restated at the CLOSING rate (SPOT as fallback).
  - The adjustment is base-currency-only on the original currency, so the next revaluation sees the adjusted carrying amount.
  - The net result goes to the unrealised gain or loss account, and the entry auto-reverses the next day by default.
- **Cost allocation**: rules move balances from source cost centers to target cost centers, by fixed percentages or by a statistical driver (headcount, area, …) entered per period.
  - Rules run in step order inside one transaction, so later steps allocate what earlier steps moved (step-down).
  - A run can be previewed (executed and rolled back), posted once per period, and reversed.
- **Budgets**: versions per fiscal year, entered as an account × month grid per cost center or at company level, with approval.
  - Can be generated from a year's actuals with a percentage adjustment.
  - The budget-vs-actual report shows variance (positive = favourable) and achievement %.
- **Year-end close**: posts the statutory appropriations, closes revenue and expenses to retained earnings per cost center in the adjustment period, and closes the year's periods.
  - EXPENSE-stage rules (KFAS, NLST, Zakat) are charged to profit; RESERVE-stage rules (statutory reserve) are transferred from retained earnings.
  - The statutory reserve stops at its cap (50% of paid-up capital).
  - The preview shows every amount first. Reopening the year reverses all year-end entries.
  - P&L reports exclude the closing entry, so a full-year income statement is still meaningful after closing.
- **Statement designer**: statements are built from rows that sum account codes or ranges (`41,4201-4204`), combine other rows by formula (`GP+OI-STAFF`), or show the unclosed result.
  - IFRS profit-or-loss and financial-position layouts are seeded.
  - The report lists accounts with balances that no row covers, or that two rows both cover.
- **Excel import**: chart of accounts and journals from `.xlsx`, with downloadable templates.
  - Every row goes through the normal validation in one transaction; the preview reports all row errors and rolls back.
  - A commit is all-or-nothing, and imported journals can be posted in the same step.
- **Journal voucher PDF**: a printable voucher with the amount in words in Arabic and English (e.g. "فقط ألف وخمسمائة دينار كويتي ومائتان وخمسون فلس لا غير").

### Group, control and security (phase 3)
- **Cash flow statement** (indirect method): profit for the period adjusted by balance-sheet movements grouped by each account's cash-flow category (operating, investing, financing; uncategorised counts as operating). A check line confirms the result agrees with the movement in cash accounts.
- **Budget control**: each company chooses NONE, WARN or BLOCK and a control budget.
  - Posting compares year-to-date expense per account (per cost center when the budget has cost-center lines) against the approved budget.
  - WARN posts and returns warnings, shown in the journal editor; BLOCK rejects the entry with `BUDGET_EXCEEDED`.
- **Intercompany**: partner mappings define each company's due-from and due-to account for every other company.
  - One request books both sides in one transaction, each balanced through its due-from or due-to account. Both companies must share a base currency.
  - Reversing either side reverses its counterpart.
  - The reconciliation report compares linked balances per company pair as of a date.
- **Consolidation**: groups have a parent, members and a presentation currency (the parent's base currency).
  - Members are translated at the parent's CLOSING rate for the position and AVERAGE rate for P&L. The translation residue goes to retained earnings.
  - Linked intercompany balances are eliminated automatically; any mismatch is shown as "Unreconciled intercompany differences".
  - Manual adjustments are entered by account code and dated.
  - Reports: worksheet (per company, eliminations, adjustments, consolidated), consolidated financial position and consolidated profit or loss.
- **Cost center hierarchy versions**: a snapshot of the tree with an effective date. The cost center analysis and summary reports can be run against any saved version.
- **Two-factor authentication**: TOTP (RFC 6238) enrolment by QR code; secrets encrypted with AES-256-GCM (`MFA_ENCRYPTION_KEY`). Administrators can reset a member's 2FA.
- **Rate limiting**: per-IP fixed window, 20/min on auth routes and 1200/min elsewhere (`RATE_LIMIT=off` disables it).
- **Tenant export**: `GET admin/export` downloads all of a tenant's data as JSON, without password hashes or MFA secrets.

### Arabic / English
- Master data has `name_ar` and `name_en`; if one is missing, the other is shown.
- Search normalizes Arabic: alef forms, ta marbuta, alef maqsura, diacritics and tatweel.
- The API never returns prose. Errors are `{ code, params }`, translated on the client from `packages/shared/src/errors.ts`.
- The UI switches between RTL and LTR. Each user chooses Latin or Arabic-Indic digits. Amounts and codes are always isolated as LTR text.
- PDFs embed IBM Plex Sans Arabic. The bilingual layout puts Arabic and English columns side by side.

## Multi-tenancy and security

- **Isolation**:
  - Every tenant table has `tenant_id` and an RLS policy on `app.tenant_id`, which is set with `set_config(..., true)` at the start of each transaction.
  - The application connects as `erp_app`. It owns no tables and has no `BYPASSRLS`.
  - Migrations run as `erp_owner`.
- **Integrity**: composite foreign keys `(tenant_id, company_id, id)` make it impossible to reference another tenant's or company's account, cost center or period, whatever the application code does.
- **Immutability**:
  - Database triggers reject any UPDATE or DELETE of posted lines and headers. The only allowed change is marking a posted entry REVERSED.
  - `core.audit_log` is INSERT/SELECT only for the application role.
- **Auth**:
  - Argon2id password hashes.
  - An HS256 JWT in an httpOnly SameSite=Lax cookie for the browser, or as a bearer token for API clients.
  - Permissions are loaded per request from the role.
  - Pre-tenant lookups (login, invitations) go through narrow `SECURITY DEFINER` functions.
- **Authorization**:
  - 18 permissions across 4 system roles (Administrator, Chief Accountant, Accountant, Viewer), plus custom roles.
  - A cost-center scope per user limits that user's lines, journal list and reports to their subtree.
- **Tests**: cross-tenant reads, inserts and references are tested both through the API and with direct SQL.

## Kuwait specifics

- KWD base currency with 3 decimals (fils) end to end: storage `NUMERIC(19,4)`, validation, rounding, formatting.
- A bilingual IFRS chart of accounts template (140 accounts) is loaded at provisioning. It includes:
  - Murabaha financing.
  - PIFSS (social security).
  - KFAS, NLST, Zakat and directors' remuneration accounts.
  - Statutory and voluntary reserves.
- A default cost center tree and journal types are seeded with each new company.

## API overview

All routes are under `/api`. Company-scoped routes need the `X-Company-Id` header.

| Area | Routes |
|---|---|
| Auth | `POST auth/signup`, `auth/login`, `auth/logout`, `auth/switch-tenant`; `GET auth/me`; `PATCH auth/preferences` |
| Admin | `admin/companies`, `admin/users`, `admin/roles`, `GET admin/audit` |
| Master data | `gl/accounts`, `gl/cost-centers`, `gl/dimensions`, `gl/dimension-values`, `gl/journal-types`, `gl/distribution-templates`, `gl/currencies`, `gl/exchange-rates`, `gl/fiscal-years`, `gl/periods`, `PATCH gl/periods/:id/status` |
| Journals | `gl/journals` CRUD, `POST gl/journals/:id/{submit,approve,reject,post,reverse}`, attachments, `GET gl/journals/:id/audit`, `POST gl/postings` |
| Reports | `GET gl/reports/{trial-balance,ledger,journal-register,income-statement,balance-sheet,cost-center-matrix,cost-center-summary,budget-vs-actual,statement}`, `GET gl/reports/voucher/:id`, with `format=json\|pdf\|xlsx`, `lang=ar\|en\|both` |
| Group | `gl/intercompany/{partners,transactions}`, `GET gl/reports/{cash-flow,intercompany-reconciliation}`, `gl/cost-center-versions`, `consolidation/groups` (+ `/:id/adjustments`, `/:id/{worksheet,balance-sheet,income-statement}`) |
| Security | `POST auth/mfa/{setup,enable,disable}`, `POST admin/users/:id/mfa-reset`, `GET admin/export` |
| Period-end | `gl/recurring` (+ `/:id/run`), `POST gl/fx-revaluation[/preview]`, `gl/allocation/{drivers,rules,runs}`, `POST gl/allocation/preview`, `gl/budgets` (+ `/lines`, `/generate`, `/status`), `gl/year-end/{rules,close,reopen}`, `GET gl/year-end/:fiscalYearId/preview`, `gl/statements`, `gl/import/{accounts,journals}`, `GET gl/import/templates/:kind` |

## Not yet built

- OIDC/SSO.
- Email delivery of invitations (a temporary password is shown once to the administrator).
- Object storage for attachments (local disk, or the database with `ATTACHMENT_STORAGE=database`).
- Dedicated-database tenants and per-tenant restore.
- Automatic elimination of intra-group revenue and expense (only balances are eliminated; use manual adjustments).
- Non-controlling interests and partial ownership.
- Historical-rate translation of equity (equity is translated at the closing rate).
- Shared rate-limit store for multi-instance deployments (in-memory today).
