# Diwan · ديوان

Multi-tenant SaaS ERP for Kuwait and the Gulf: general ledger, sales and receivables, purchases and payables, bank and cash, tax and fixed assets, with group consolidation. KWD with 3 decimals, IFRS chart of accounts, and Arabic/English throughout. The product name lives in `packages/shared/src/brand.ts`.

| Layer | Technology |
|---|---|
| Database | PostgreSQL 16: row-level security (RLS), `NUMERIC` money, ICU, `pg_trgm` |
| API | NestJS 11 (TypeScript), `pg`, zod, decimal.js |
| Web | Next.js 15 (App Router), React 19, Mantine 7 (RTL), TanStack Query |
| Shared | `@erp/shared`: enums, money math, zod schemas, error catalogue, report model |
| Export | Headless Chromium for PDF (Arabic shaping, bidi), exceljs for Excel (RTL sheets) |

## Quick start

### Run the production image (Docker only)

```bash
docker compose --profile app up --build
```

This builds the production image and starts PostgreSQL with it. It then applies the migrations and loads the demo tenant. Open http://localhost:8080 and sign in with `demo@example.com` / `demo-password-123`. The platform console (to create tenants) is at the same address with `admin@example.com` / `admin-password-123`. `docker compose --profile app down -v` stops everything and deletes the data.

### Development

Requires Node 22 and pnpm 10.

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

- **Any server or PC with Docker**: `docker-compose.prod.yml` with automatic HTTPS (Caddy) or Cloudflare Tunnel. See [docs/deploy-docker.md](docs/deploy-docker.md).
- Cloudflare (Workers + Containers, with a managed PostgreSQL): see [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md). The `Dockerfile` at the root builds one image containing the API, the web app and Chromium, and runs on any container host.

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

### Platform administration (SaaS operator)
- **Platform admins** are separate accounts listed in `core.platform_admins`. The application role cannot read or write that table; it is written by `pnpm platform:admin` (with `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`) using the owner connection. A platform admin cannot belong to a tenant.
- Signing in as a platform admin opens `/platform` with a platform-scoped token. Tenant routes reject it, and platform routes reject tenant tokens.
- **Tenants**: list with plan, limits, usage and last sign-in; create a tenant with its first company and administrator (new user with a temporary password shown once, or an existing user); edit plan and limits; suspend (signs its users out and blocks sign-in) and reactivate.
- **Support**: per-tenant companies and users; reset a member's password, optionally with 2FA.
- Every platform action on a tenant is written to that tenant's audit log. Cross-tenant reads go through `SECURITY DEFINER` functions that re-check the caller.
- `PUBLIC_SIGNUP=off` closes self-service sign-up, so tenants are created only from the console. Docker Compose and Cloudflare default to `off`.

### Passwords
- **Forgot password?** on the sign-in page e-mails a one-time link (Arabic and English) that expires after an hour; the answer is the same whether or not the address is registered, and one link per minute is sent. Needs `SMTP_URL` and `APP_URL`; without SMTP the link is hidden.
- **Change password** in the account menu (tenant users and platform admins).
- **Administration → Users → reset password** gives a member a temporary password, shown once; they must choose their own at the next sign-in. Users who also belong to another organisation reset their own password instead. Platform support resets work the same way.
- Every password change signs the user out everywhere else.

### Subscription plans
- The console's **Subscription plans** tab creates, edits and deletes plans: names, description, monthly price, default company and user limits, and the **modules** included.
- Modules (`packages/shared/src/features.ts`) bundle related screens, reports and API routes, so they open and close together: general ledger (always included), period-end, budgets, statement designer, tax, bank and cash, sales and receivables, purchases and payables, fixed assets, group companies.
- Dependencies are kept consistent: ticking sales or purchases also ticks bank and cash; unticking bank and cash also unticks sales and purchases. The server stores a plan with everything it requires.
- Each tenant is on one plan. Requests to a module outside it are refused with `FEATURE_NOT_IN_PLAN`, and its screens disappear from the menu, reports list and search; data already entered is kept and returns when the plan includes the module again.
- Seeded plans: Starter, Business, Enterprise and Standard (every module; the default, and the plan existing tenants are on). The default plan is used for self-service sign-up and for tenants created without a plan. Plans in use and the default plan cannot be deleted.

### Sales, purchases and bank (AR / AP / cash)
- **Customers and suppliers** with currency, payment terms, credit limit, contact and tax details, a default revenue / expense account, and a running balance. Each posts to a receivable or payable **control account**, so the sub-ledger always agrees with the ledger.
- **Invoices** (sales and purchase) and **credit / debit notes**: lines with account, cost center, quantity and unit price; draft → post (gapless SI / CN / PI / DN numbers) → void by reversal. Cost center rules and budget control apply. Bilingual PDF with the amount in words.
- **Tax codes** (rate, sales and purchase tax accounts) per invoice line; tax is posted to its own accounts and shown on the printed document. The **tax report** totals net amounts, output and input tax per code for any date range.
- **Receipts and payments** applied to open invoices (manually or oldest first); the unapplied rest stays on account. Foreign-currency documents carry their rate, and the difference between invoice and settlement rates is posted as a **realised exchange gain or loss**.
- A receipt or payment can go through a bank account in **another currency** (a USD supplier paid from a KWD account): the bank amount fixes the rate.
- **Later allocation**: on-account receipts, payments and credit / debit notes can be applied to invoices after posting, and allocations removed again; the exchange difference is realised on the allocation date and undone on removal or void. Ageing follows allocation dates.
- **Bank and cash accounts** linked to ledger accounts, with balances in their own currency; **transfers** between them, also across currencies.
- **Bank reconciliation**: tick the lines on the statement until the difference is zero; cleared lines drop out of later reconciliations. **Statement import** (CSV or Excel, English or Arabic headers, signed amount or debit / credit columns) matches lines to ledger movements of the same amount within five days; unmatched lines such as bank charges are booked from the statement in one step.
- **Reports**: receivables and payables ageing (checked against the control accounts) and customer / supplier statements of account.

### Fixed assets (IAS 16)
- **Categories** (seeded with the chart of accounts: land, buildings, machinery, vehicles, furniture, computers) hold the asset, accumulated depreciation, expense and disposal gain/loss accounts and the default method: straight line, declining balance or none. A category can lock its asset accounts so only this module posts to them.
- **Register**: code, bilingual names, category, cost center, location, custodian, serial number, cost, residual value, useful life.
  - An asset is put into service either by posting the purchase (debit asset, credit the paying account) or by recognising a cost already in the ledger, optionally with accumulated depreciation taken over from a previous system.
- **Depreciation runs** per period: preview, then one entry split by expense account and cost center. Part months are pro rata by days, skipped months are caught up, assets become *fully depreciated* automatically, and only the latest run can be reversed.
- **Disposal / sale**: depreciation is brought to the disposal date, then cost and accumulated depreciation are removed and the gain or loss is posted. Disposals can be reversed.
- **Transfers** between cost centers; later depreciation follows the asset.
- **Excel import** of an opening register.
- **Reports**: asset register, IAS 16 movement schedule (checked against the ledger) and depreciation forecast.
- Entries carry source module `FA` and have their own period status; they are reversed from the fixed asset screens only.

### Interface and design
- **Light, dark and system themes.** Switch from the sun/moon button in the header, or from Appearance in the user menu. Colours come from one set of tokens (`apps/web/src/app/theme.ts`, `globals.css`).
- **Navigation**: the sidebar is grouped into overview, general ledger, period-end, group companies, reports and administration. It collapses to an icon rail, with labels as tooltips, and remembers your choice.
- **Search (Ctrl K or /)**: jump to any screen or report you have access to, or run an action: new entry, switch theme or language, open the guide, sign out.
- **Dashboard**: cash and bank, revenue, expenses and net profit for the year to date (amounts count up as they load), a monthly revenue/expense chart, a work queue and the latest entries. It reads from `GET /gl/dashboard`. Users limited to some cost centers do not see company-wide totals.
- **Motion**: pages fade in, cards appear one after another, chart bars grow, hover lifts and press feedback. Every animation is switched off when the operating system asks for reduced motion.
- **States**: skeleton rows while loading, empty states with a next step, and a sticky totals bar in the journal editor that shows the balance as you type.

### User guide
Every screen has a help button (?) in the header that opens the guide for that screen, in Arabic or English to match the interface. `/help` shows the whole guide, grouped and searchable, and does not require signing in. The content is in `apps/web/src/help/guides.ts`.

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
| Auth | `POST auth/signup`, `auth/login`, `auth/logout`, `auth/switch-tenant`, `auth/password` (change), `auth/password/{forgot,check,reset}`; `GET auth/me`; `PATCH auth/preferences` |
| Admin | `admin/companies`, `admin/users`, `admin/roles`, `GET admin/audit` |
| Master data | `gl/accounts`, `gl/cost-centers`, `gl/dimensions`, `gl/dimension-values`, `gl/journal-types`, `gl/distribution-templates`, `gl/currencies`, `gl/exchange-rates`, `gl/fiscal-years`, `gl/periods`, `PATCH gl/periods/:id/status` |
| Journals | `gl/journals` CRUD, `POST gl/journals/:id/{submit,approve,reject,post,reverse}`, attachments, `GET gl/journals/:id/audit`, `POST gl/postings` |
| Reports | `GET gl/reports/{trial-balance,ledger,journal-register,income-statement,balance-sheet,cost-center-matrix,cost-center-summary,budget-vs-actual,statement}`, `GET gl/reports/voucher/:id`, with `format=json\|pdf\|xlsx`, `lang=ar\|en\|both` |
| Group | `gl/intercompany/{partners,transactions}`, `GET gl/reports/{cash-flow,intercompany-reconciliation}`, `gl/cost-center-versions`, `consolidation/groups` (+ `/:id/adjustments`, `/:id/{worksheet,balance-sheet,income-statement}`) |
| Platform | `GET platform/me`, `platform/tenants` (list, create), `GET/PATCH platform/tenants/:id`, `platform/plans` (list, create), `PUT/DELETE platform/plans/:code`, `POST platform/tenants/:id/users/:userId/reset-credentials`, `POST platform/mfa/{setup,enable,disable}`; `GET auth/config` (public) |
| Sales / purchases | `sl/{AR,AP}/parties`, `sl/{AR,AP}/documents` (+ `/:id/{post,void,print}`), `sl/{AR,AP}/settlements` (+ `/:id/void`), `POST sl/{AR,AP}/allocations`, `POST sl/{AR,AP}/allocations/:id/remove`, `GET sl/{AR,AP}/reports/{aging,statement}` |
| Tax | `tax/codes`, `GET tax/report` |
| Bank and cash | `cb/accounts`, `cb/transfers`, `cb/accounts/:id/reconciliations`, `cb/reconciliations` (+ `/:id/items`, `/:id/complete`, `/:id/statement` upload / delete, `/:id/match`, `/:id/statement/:lineId/post`) |
| Fixed assets | `fa/categories`, `fa/assets` (+ `/:id/{activate,transfer,dispose,reverse-disposal}`), `fa/depreciation/{preview,run,runs}`, `POST fa/depreciation/runs/:id/reverse`, `fa/import` (+ `/template`), `GET fa/reports/{register,movement,forecast}` |
| Security | `POST auth/mfa/{setup,enable,disable}`, `POST admin/users/:id/mfa-reset`, `GET admin/export` |
| Period-end | `gl/recurring` (+ `/:id/run`), `POST gl/fx-revaluation[/preview]`, `gl/allocation/{drivers,rules,runs}`, `POST gl/allocation/preview`, `gl/budgets` (+ `/lines`, `/generate`, `/status`), `gl/year-end/{rules,close,reopen}`, `GET gl/year-end/:fiscalYearId/preview`, `gl/statements`, `gl/import/{accounts,journals}`, `GET gl/import/templates/:kind` |

## Not yet built

- Inventory items, stock movements and costing; payroll.
- MT940 / CAMT statement formats and live bank feeds (CSV and Excel import only).
- Tax-inclusive prices and per-jurisdiction tax return forms (the tax report is a summary by code).
- OIDC/SSO.
- E-mailed invitations (a temporary password is shown once to the administrator; only password resets are e-mailed).
- Object storage for attachments (local disk, or the database with `ATTACHMENT_STORAGE=database`).
- Dedicated-database tenants and per-tenant restore.
- Automatic elimination of intra-group revenue and expense (only balances are eliminated; use manual adjustments).
- Non-controlling interests and partial ownership.
- Historical-rate translation of equity (equity is translated at the closing rate).
- Shared rate-limit store for multi-instance deployments (in-memory today).
