# Deploying ShowPass

The production stack runs on one Linux host with Docker:

```
internet ──443──▶ caddy (TLS, HSTS) ──▶ web (nginx: SPA + proxy) ──▶ api (Node) ──▶ postgres
                                                                        └────────▶ redis
                                                       backup (pg_dump daily) ──▶ ./backups
```

## First deploy

1. Point a DNS record for your domain at the server and open ports 80 and 443.
2. On the server, clone the repo and create the env file:
   ```bash
   cp .env.production.example .env.production   # fill in every value
   ```
3. Start everything:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```
   Caddy fetches a TLS certificate automatically. The API applies database migrations when it starts.
4. Create the first super admin (one-off):
   ```bash
   docker compose -f docker-compose.prod.yml exec api node -e "
     const { PrismaClient } = require('@prisma/client'); const b = require('bcryptjs');
     new PrismaClient().user.create({ data: { name: 'Owner', email: 'owner@example.com', phone: '+94770000000',
       passwordHash: b.hashSync(process.argv[1], 12), role: 'SUPER_ADMIN', emailVerifiedAt: new Date() } })
       .then(() => console.log('created'))" 'a-strong-password'
   ```
   Then log in and add cinemas, screens, prices, movies and staff from the admin panel. Do **not** run the seed in production, because it wipes the database.

## Payment gateway (PayHere)

- In the PayHere portal, add your domain and copy the **Merchant ID** and **Merchant Secret**.
- Under *Integrations → API Keys*, create an app and copy its **App ID / App Secret**. Without these, refunds are recorded as `MANUAL-…` and must be processed in the portal.
- The notify URL is set automatically to `https://<DOMAIN>/api/payments/webhook/payhere`.
- Test with `PAYHERE_SANDBOX=true` first.

## Email and SMS

- Any SMTP provider works (for example SendGrid on port 587).
- `SMS_PROVIDER=http` posts `{ "to": "+9477…", "message": "…" }` with `Authorization: Bearer <SMS_HTTP_TOKEN>` to `SMS_HTTP_URL`. If your local SMS provider uses a different format, adapt `apps/api/src/modules/notifications/sms.ts`.

## Backups (NFR-16)

The `backup` service writes `backups/showpass-<timestamp>.dump` every 24 h and deletes dumps older than 30 days. Copy `./backups` off the server (for example with a nightly `rclone` to object storage).

Restore:
```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U showpass -d showpass --clean --if-exists < backups/showpass-YYYYMMDDTHHMMSSZ.dump
```

## Updating

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## Scaling

Live seat updates go through Redis, so you can run several API containers behind nginx (`docker compose ... up -d --scale api=3`). Background jobs are idempotent and safe to run on every instance.
