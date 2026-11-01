# Publishing with Docker

`docker-compose.prod.yml` runs PostgreSQL and the ERP image, and publishes them over HTTPS in one of two ways:

| | Option A: own server (Caddy) | Option B: Cloudflare Tunnel |
|---|---|---|
| Where it runs | A cloud server with a public IP (e.g. Hetzner, DigitalOcean, AWS Lightsail) | Any machine with Docker, including your Windows PC |
| Needs | A domain pointing at the server; ports 80 and 443 open | A free Cloudflare account (a domain on Cloudflare for a fixed address) |
| HTTPS | Automatic (Let's Encrypt via Caddy) | Automatic (Cloudflare) |
| Up when | The server is on (always) | That machine is on and Docker is running |

The database and the app are never published directly; only the proxy is.

## 1. Configuration (both options)

```bash
cp .env.prod.example .env        # PowerShell: Copy-Item .env.prod.example .env
```

Fill in every value. Generate each secret with `openssl rand -hex 32` (or, in PowerShell, `-join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })`).

- `POSTGRES_PASSWORD`, `ERP_OWNER_PASSWORD`, `ERP_APP_PASSWORD`: database passwords. Use letters and digits only.
- `JWT_SECRET`, `MFA_ENCRYPTION_KEY`: application secrets. Never change `MFA_ENCRYPTION_KEY` after users enable 2FA.
- `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`: the account that signs in to `/platform` to create customer tenants.
- `PUBLIC_SIGNUP=off`: customers get accounts from the platform console. Set `on` for self-service sign-up.
- `SEED_DEMO=true` loads a demo company (`demo@example.com`, password `DEMO_PASSWORD`). Leave it `false` for real use.

`.env` holds secrets: it is ignored by git; keep a copy somewhere safe.

## 2a. Option A: your own server

1. Create a server running Ubuntu 24.04 (2 GB RAM or more) and install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
2. In your domain's DNS, add an **A record**, e.g. `erp.yourcompany.com` → the server's IPv4 address.
3. Allow ports 80 and 443 in the provider's firewall.
4. On the server:
   ```bash
   git clone https://github.com/bahymohammmed/ERPSaaS.git && cd ERPSaaS
   cp .env.prod.example .env && nano .env          # set DOMAIN=erp.yourcompany.com and the secrets
   docker compose -f docker-compose.prod.yml --profile caddy up -d --build
   ```
5. Open `https://erp.yourcompany.com`. The first start takes a few minutes (image build, then the certificate).

## 2b. Option B: Cloudflare Tunnel (works from your PC)

**Quick test, no account**, gives a random `https://….trycloudflare.com` address that changes on every start:

```powershell
docker compose -f docker-compose.prod.yml up -d --build
docker run --rm --network erpsaas_default cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://app:3000
```

The address is printed in the output. `erpsaas_default` is the folder name plus `_default`; run `docker network ls` if yours differs. Set `CLIENT_IP_HEADER=cf-connecting-ip` in `.env`.

**Fixed address on your domain**: the domain must use Cloudflare DNS.

1. In Cloudflare: **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, name it, choose **Docker**, and copy the token from the command shown (the long value after `--token`).
2. In the tunnel, under **Public hostname**, add `erp.yourcompany.com` with service **HTTP** `app:3000`.
3. In `.env`: `TUNNEL_TOKEN=<token>` and `CLIENT_IP_HEADER=cf-connecting-ip`.
4. Start:
   ```powershell
   docker compose -f docker-compose.prod.yml --profile tunnel up -d --build
   ```
5. Open `https://erp.yourcompany.com`.

On a Windows PC, turn on **Docker Desktop → Settings → General → Start Docker Desktop when you sign in**, and keep the PC from sleeping; the site is offline whenever the PC or Docker is.

## Operating

```bash
# status and logs
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app

# update to the latest code (migrations run automatically on start)
git pull
docker compose -f docker-compose.prod.yml --profile caddy up -d --build     # or --profile tunnel

# backup (includes attachments, which are stored in the database)
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U postgres -Fc erp > erp-backup.dump

# restore into an empty installation
docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U postgres -d erp --clean --if-exists < erp-backup.dump
```

Copy backups off the machine (another disk or cloud storage) and test a restore occasionally.

## Security checklist

- Every value in `.env` is unique and random; the example values are not used.
- Sign in to `/platform` and enable two-factor authentication for the platform administrator (menu under your name).
- `SEED_DEMO=false` unless you want the demo company online.
- Keep the server updated (`sudo apt update && sudo apt upgrade`) and Docker images rebuilt after updates.
