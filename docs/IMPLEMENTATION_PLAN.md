# ShowPass – Implementation Plan

Source: *SRS – ShowPass Cinema Ticket Booking Website* (Nov 16, 2026).

## 1. Technology choices

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language for API + web, shared types |
| Repo | npm workspaces monorepo: `apps/api`, `apps/web` | Simple, no extra tooling |
| API | Node 22 + Express, layered: routes → controllers → services → Prisma | NFR-15 layered structure |
| DB | PostgreSQL 16 via Prisma ORM | Relational model from SRS §6, parameterised queries (NFR-8) |
| Cache / rate limit | Redis 7 | Rate-limiting login/OTP (NFR-8), Socket.IO fan-out |
| Real-time | Socket.IO (WebSocket with long-polling fallback) | FR-4.7, NFR-2, SRS §4.4 |
| Validation | Zod | Request validation on every endpoint |
| Auth | bcrypt password hashes, JWT in httpOnly SameSite cookie, role-based guards | NFR-7, NFR-9 |
| Payments | `PaymentGateway` interface with **PayHere** adapter and a **Mock** adapter for dev/test | FR-5.2/5.3, open question on gateway |
| Email | Nodemailer (SMTP) → Mailpit locally, SendGrid/SMTP in prod | FR-6.2 |
| SMS | `SmsProvider` interface; console provider locally, HTTP provider later | FR-1.2, FR-6.2 |
| Tickets | `qrcode` + `pdfkit` | FR-6.1, FR-6.3 |
| Web | React 18 + Vite + React Router + TanStack Query + Tailwind (dark cinema theme) | §4.1, NFR-13/14 |
| QR scanning | `html5-qrcode` in the checker view | FR-8.1, §4.2 |
| Tests | Vitest + Supertest against a real Postgres | NFR-15 (≥70% backend logic) |
| Local infra | `docker-compose.yml`: postgres, redis, mailpit | |

## 2. Key design decisions

### 2.1 Double-booking prevention (FR-4.5, NFR-4)
The database is the source of truth for seat state. `ShowSeat` has a unique `(showId, seatId)` and a `status` of `AVAILABLE | HELD | BOOKED`.

Holding seats is a single conditional `UPDATE … WHERE status = 'AVAILABLE' OR (status = 'HELD' AND held_until < now())` inside a transaction. If the number of updated rows is less than the number of requested seats, the transaction rolls back and the client gets `409 SEATS_UNAVAILABLE` (SRS §7.1 alt-flow 3). Postgres row locks serialise concurrent updates, so two customers cannot both win the same seat.

Confirming a payment re-checks that every seat is still `HELD` by that booking before switching to `BOOKED`. If a hold expired and the seat was taken by someone else, the payment is refunded automatically (NFR-6).

### 2.2 Seat holds and expiry (FR-4.4, FR-4.6)
- When a hold is placed, a `PENDING` booking is created with `holdExpiresAt = now + holdMinutes` (default 10, configurable).
- A background sweeper (every 30 s) marks expired pending bookings `EXPIRED` and releases their seats.
- Expired holds are also treated as available by the hold query itself, so correctness never depends on the sweeper timing.

### 2.3 Payment flow (FR-5.2, FR-5.3, FR-5.6)
1. `POST /bookings/:id/pay` → creates a `Payment(INITIATED)` and returns gateway checkout parameters.
2. Customer pays on the gateway (PayHere hosted checkout, or the Mock gateway page in dev).
3. Gateway calls the **webhook**; the signature is verified, then handling is idempotent on `gatewayRef`.
4. Success → booking `CONFIRMED`, seats `BOOKED`, QR token issued, email + SMS queued.
   Failure → booking `FAILED`, seats released.
5. A reconciliation job (every 5 min) looks at payments stuck in `INITIATED`, queries the gateway, then confirms or refunds (NFR-6).

### 2.4 Configurable business rules
Stored in a `Setting` table with defaults in code, and editable by a super admin:
`holdMinutes=10`, `maxSeatsPerBooking=10`, `bookingCutoffMinutes=0` (minutes before the show starts),
`cancelCutoffMinutes=120`, `convenienceFeePerTicket=0`, `taxPercent=0`, `currency=LKR`,
refund policy `[{minHoursBefore:24, percent:100}, {minHoursBefore:2, percent:50}]`.

### 2.5 Answers assumed for SRS §7.4 open questions
| Question | Assumption (can be changed in settings or code) |
|---|---|
| One cinema or several? | Multi-cinema data model; a cinema admin is scoped to one cinema |
| Gateway / SMS provider | PayHere adapter + Mock; SMS via a pluggable provider (console in dev) |
| Refund policy | 100% if ≥ 24 h before the show, 50% if ≥ 2 h, none after the cut-off |
| Convenience fee | Configurable per ticket, default 0 |

### 2.6 Security
HTTPS is terminated at the reverse proxy. The app also uses Helmet headers, sends the auth cookie as `httpOnly; SameSite=Lax; Secure` in prod, and requires an `X-Requested-With` header on state-changing requests (CSRF). Login, OTP and reset endpoints are rate-limited. Staff tokens use a 30-minute sliding expiry (NFR-9). Inputs are validated with Zod, and React escapes output (XSS). No card data ever reaches the server (NFR-10). Every booking, payment, refund and admin action is written to `AuditLog` (NFR-17).

## 3. Data model
This follows SRS §6, plus supporting tables:
`User, VerificationCode, Movie, Cinema, Screen, Seat, Show, ShowSeat, PriceRule, Booking, BookingSeat, Payment, PromoCode, Review, WatchlistItem, AuditLog, Setting`.
`BookingSeat` keeps a snapshot of seat label, category and price, so booking history survives seat release on cancellation.

## 4. API outline (`/api`)
- **auth**: `POST register, login, logout, verify/request, verify/confirm, password/forgot, password/reset`; `GET me`; `PATCH me`
- **movies**: `GET /movies?status&q&genre&language&format&date`, `GET /movies/:slug`, `GET /movies/:id/shows?date&cinemaId`
- **shows**: `GET /shows/:id` (seat map + prices), `POST /shows/:id/holds`
- **bookings**: `GET /bookings` (mine), `GET /bookings/:id`, `POST /bookings/:id/promo`, `POST /bookings/:id/pay`, `DELETE /bookings/:id/hold`, `POST /bookings/:id/cancel`, `GET /bookings/:id/ticket.pdf`
- **payments**: `POST /payments/webhook/:gateway`, `POST /payments/mock/:paymentId/complete` (dev only)
- **checker**: `POST /checker/scan` `{token, showId?}`
- **admin**: CRUD for `movies, cinemas, screens (+layout), shows, price-rules, promo-codes, staff, reviews`; `GET bookings?q`, `GET reports/*` (+CSV/PDF), `GET/PUT settings`
- **realtime**: Socket.IO room `show:<id>` → `seats:update`

## 5. Delivery phases

| Phase | Content | SRS coverage | Status |
|---|---|---|---|
| **0. Foundation** | Monorepo, docker-compose, Prisma schema + migrations, seed data, API skeleton (config, errors, logging, auth middleware), web skeleton with dark theme | §2.4, §2.5, §6 | Done |
| **1. Core booking flow** | Auth + OTP verification + password reset; catalogue, search and filters; showtimes; seat map; holds with countdown; promo codes; mock and PayHere payment; webhook confirmation; sweeper; e-ticket QR + PDF; email/SMS; My Bookings; real-time seat updates | FR-1.1–1.5, 2.1–2.4, 3.x, 4.x, 5.1–5.4, 5.6, 6.1–6.3 | Done |
| **2. Cancellation + validation** | Customer cancellation with refund policy; checker QR scan page; mark used | FR-7.x, FR-8.x | Done |
| **3. Admin panel** | Dashboard; movies; cinemas and screens with visual seat layout editor; showtime scheduling with overlap check; pricing rules; promo codes; booking search; staff and roles; settings; audit log | FR-9.1–9.6, 9.8 | Done |
| **4. Reports + reviews** | Sales, bookings and occupancy reports with CSV/PDF export; reviews and moderation | FR-9.7, FR-10.x | Done |
| **5. Hardening** | Payment reconciliation job; audit log; backend coverage 78.9% (53 tests); code-split staff screens; PayHere Merchant API for refunds + status lookup; Socket.IO Redis adapter; Docker + Caddy HTTPS deploy; daily backups with 30-day retention; Playwright E2E with axe WCAG 2.1 AA checks at 360 px. **Open:** adapter for the chosen local SMS provider (generic HTTP adapter exists); manual screen-reader pass | NFR-1…17 | Done (see open items) |
| **6. Low-priority** | Google sign-in; watchlist booking-open emails; food & drink combos; 2-hour reminder | FR-1.6, 2.5, 5.5, 6.4 | Done |

## 6. Testing strategy
- **Unit**: pricing/fee/tax/discount calculation, refund policy, PayHere hash and signature, overlap detection.
- **Integration** (Vitest + Supertest, real Postgres): register → verify → hold → pay → webhook → confirmed; concurrent holds on the same seat (exactly one succeeds); hold expiry release; cancellation refund; QR scan twice → `ALREADY_USED`.
- **E2E** (Playwright, `npm run test:e2e`): the booking flow on a 360 px viewport in 5 steps (NFR-12), live seat updates within 2 s (NFR-2), all admin pages, and axe WCAG 2.1 AA scans of the customer pages (NFR-14).
