# Deploying to Cloudflare

## How it runs

```
browser ──► Worker "erp" (deploy/cloudflare/src/index.ts)
              │  sets x-erp-client-ip from CF-Connecting-IP
              ▼
            Container ErpContainer (Dockerfile, one instance, standard-1: ½ vCPU, 4 GiB)
              ├─ Next.js web app :3000  ──/api──►  NestJS API :4000
              └─ Chromium for PDF reports
                                   │
                                   ▼
                       PostgreSQL 16 (managed, outside Cloudflare)
```

- Cloudflare does not host PostgreSQL. Use any managed PostgreSQL 16+ service that allows creating roles: Neon, Supabase, AWS RDS, DigitalOcean, and others. Choose the region closest to your users; for Kuwait that is usually Frankfurt or Bahrain.
- The container sleeps after 30 minutes without requests. The first request after that waits a few seconds for it to start.
- A cron trigger wakes the container every hour so recurring entries are still generated.
- The container disk is not persistent. Attachments are therefore stored in the database (`ATTACHMENT_STORAGE=database`).
- The API runs as a single instance, because the rate limiter and the scheduler keep their state in memory.

## One-time setup

1. **Cloudflare account** on the Workers Paid plan, which Containers requires.
2. **API token**: in Cloudflare, go to My Profile → API Tokens → Create Token. Start from the "Edit Cloudflare Workers" template and add **Account → Containers → Edit**. Copy the token and your Account ID (shown on the Workers overview page).
3. **Database**: create a PostgreSQL 16+ instance. As its admin user, run:
   ```sh
   psql "$ADMIN_DATABASE_URL" -v owner_password='…' -v app_password='…' -f scripts/db-setup-managed.sql
   ```
   This creates the `erp` database, the `erp_owner` role that runs migrations, and the `erp_app` role the application connects as (no BYPASSRLS).
4. **GitHub secrets**: in the repository, go to Settings → Secrets and variables → Actions and add:

   | Secret | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from step 2 |
   | `CLOUDFLARE_ACCOUNT_ID` | your account ID |
   | `DATABASE_URL` | `postgres://erp_app:…@host/erp?sslmode=require` |
   | `MIGRATION_DATABASE_URL` | `postgres://erp_owner:…@host/erp?sslmode=require` |
   | `JWT_SECRET` | 64 random characters (`openssl rand -hex 32`) |
   | `MFA_ENCRYPTION_KEY` | 64 random characters. **Never change it**: enrolled 2FA secrets become unreadable. |
   | `DEMO_PASSWORD` | optional; only used to load the demo tenant |

   The deploy job runs in the `production` GitHub environment, so you can add required reviewers there.

## Deploying

Every push to `main` runs `.github/workflows/deploy-cloudflare.yml`. The workflow:

1. Runs the test suite against a throwaway PostgreSQL and builds the web app.
2. Applies pending migrations to the production database.
3. Builds the image, pushes it to Cloudflare's registry, and deploys the Worker with its secrets.

To deploy by hand, go to Actions → Deploy to Cloudflare → Run workflow. Tick *Load the demo tenant* to create `demo@example.com` with `DEMO_PASSWORD`.

The app is served at `https://erp.<your-subdomain>.workers.dev`. To use your own domain, go to Workers & Pages → erp → Settings → Domains & Routes → Add custom domain.

### From your own machine

You need Docker running and Node 22:

```sh
MIGRATION_DATABASE_URL=… pnpm db:migrate
cd deploy/cloudflare
npm ci
npx wrangler login
npx wrangler secret put DATABASE_URL       # and JWT_SECRET, MFA_ENCRYPTION_KEY
npx wrangler deploy
```

## Operating

- **Logs**: run `npx wrangler tail` in `deploy/cloudflare`, or go to Workers & Pages → erp → Logs.
- **Rollback**: go to Workers & Pages → erp → Deployments. Migrations are not rolled back automatically.
- **Backups**: rely on the database provider's point-in-time recovery. `GET /api/admin/export` gives a per-tenant JSON export.
