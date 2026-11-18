# ShowPass

Online cinema ticket booking: browse movies, pick showtimes and seats on a live seat map, pay online, and get QR e-tickets. Cinema staff get an admin panel and a mobile QR scanner.

Built from the SRS *ShowPass Cinema Ticket Booking Website* (Nov 2026). Plan, design decisions and delivery status: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Stack

| | |
|---|---|
| `apps/api` | Node 22, Express, TypeScript, Prisma + PostgreSQL, Socket.IO, Zod, Vitest |
| `apps/web` | React 18, Vite, React Router, TanStack Query, Tailwind |
| Infra (dev) | Docker Compose: PostgreSQL 16 (port **5450**), Redis 7 (**6380**), Mailpit (UI **8025**, SMTP 1025) |

## Getting started

```bash
npm install
npm run infra:up                 # postgres, redis, mailpit
cp apps/api/.env.example apps/api/.env   # then set JWT_SECRET / QR_SECRET
npm run db:migrate               # apply migrations
npm run db:seed                  # demo cinemas, screens, movies, 7 days of shows
npm run dev                      # API :4000 + web :5180
```

Open http://localhost:5180. Emails (OTP codes, e-tickets) land in Mailpit at http://localhost:8025. SMS messages are printed to the API log.

### Demo accounts (from the seed)

| Role | Login | Password |
|---|---|---|
| Super admin | admin@showpass.local | Admin@1234 |
| Cinema admin (Colombo) | manager@showpass.local | Manager@1234 |
| Ticket checker (Colombo) | checker@showpass.local | Checker@1234 |
| Customer | customer@showpass.local | Customer@1234 |

Promo codes: `WELCOME10` (10%, max LKR 500), `FLAT300` (LKR 300 off over LKR 2,000).

### Payments in development
`PAYMENT_GATEWAY=mock` sends checkout to a test page (`/mock-gateway/:id`) where you choose **Pay** or **Decline**. The API then receives a signed webhook through the same code path a real gateway uses. Set `PAYMENT_GATEWAY=payhere` with merchant credentials to use PayHere hosted checkout (`notify_url` = `PUBLIC_API_URL/api/payments/webhook/payhere`, which must be publicly reachable).

## Tests

```bash
npm test                                   # API: unit + integration against showpass_test DB
npm run test:coverage -w apps/api          # currently ~75% statements
```

The integration suite includes 8 customers racing for the same seats (exactly one wins), hold expiry, late and forged webhooks, refunds when seats are lost, cancellation tiers, QR reuse, overlap checks when scheduling shows, and role scoping.

## How the important parts work

- **No double booking (FR-4.5, NFR-4).** Holding seats is one conditional `UPDATE … WHERE status='AVAILABLE' OR hold lapsed` inside a transaction. If fewer rows change than were requested, it rolls back with `409 SEATS_UNAVAILABLE`. A unique `(showId, seatId)` key backs this up.
- **Holds (FR-4.4, 4.6).** A hold creates a `PENDING` booking with a 10-minute expiry (configurable). A sweeper releases lapsed holds every 30 s. Lapsed holds also count as free immediately, so correctness does not depend on the sweeper.
- **Payment confirmation (FR-5.3, NFR-6).** Bookings only change state in `handleGatewayEvent`, which is idempotent. If a payment succeeds after its seats were resold, it is refunded automatically. A reconciliation job records abandoned payments and retries failed refunds.
- **Live seat map (FR-4.7, NFR-2).** Socket.IO room per show, with long-polling fallback plus a 20 s refetch as a safety net.
- **Security.** bcrypt hashing, httpOnly SameSite session cookie, CSRF header check, Helmet, Zod validation on every endpoint, rate limits on login/OTP, role-based admin access with cinema scoping, 30-minute sliding staff sessions, audit log of bookings, payments, refunds and admin actions.

## Project layout

```
apps/api/src
  config/        env validation
  lib/           prisma, redis, logger, errors, money, audit
  middleware/    auth (cookie JWT, roles), validation, CSRF, rate limits, errors
  modules/
    auth/        register, login, OTP verify, password reset, profile
    catalogue/   movies, filters, showtimes, seat map, holds, reviews
    bookings/    hold/promo/cancel/refund logic, my bookings, ticket PDF
    payments/    gateway interface, PayHere + mock adapters, webhooks, reconciliation
    tickets/     QR + PDF rendering, email/SMS notifications
    checker/     QR scan validation
    admin/       movies, promos, reviews, cinemas, screens, pricing, shows, bookings, staff, settings, reports
    pricing/     pure pricing/discount/refund functions
  realtime/      Socket.IO
  jobs/          hold sweeper, payment reconciliation
apps/web/src
  pages/         customer pages, checker, admin/*
  components/    layout + UI primitives
  lib/           API client, auth context, socket hook, formatting
```
