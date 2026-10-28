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
  - 14 permissions across 4 system roles (Administrator, Chief Accountant, Accountant, Viewer), plus custom roles.
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
| Reports | `GET gl/reports/{trial-balance,ledger,journal-register,income-statement,balance-sheet,cost-center-matrix,cost-center-summary}` with `format=json\|pdf\|xlsx`, `lang=ar\|en\|both` |

## Not yet built (phase 2)

- Recurring and auto-reversing entries.
- Cost allocation engine with statistical drivers.
- FX revaluation.
- Year-end close: closing entries plus Kuwaiti statutory appropriations.
- Budgets.
- Financial statement designer.
- Cash flow statement.
- Excel import.
- Amount in words.
- Approval thresholds.

Further out:
- OIDC/SSO and MFA (auth is local accounts today).
- Email delivery of invitations (a temporary password is shown once to the administrator).
- Object storage for attachments (local disk today).
- Rate limiting.
- Per-tenant export and restore.
- Multi-entity consolidation.
