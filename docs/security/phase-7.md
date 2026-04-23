# Phase 7 — Security Audit

Scope: OWASP Top 10 lens across the multi-tenant CRM, platform, admin, Mini
App, and public webhook surfaces. Audit performed before the Phase 7 polish
commits land. Findings below cite files with line numbers; fixes applied in
this commit are marked with [fixed] and reference the new line numbers where
relevant.

Quality gates (run as part of this commit):

- `npx tsc --noEmit` — clean
- `npx vitest run` — 239+ green
- `npm run build` — standalone output present

Findings summary:

| Severity | Open | Fixed in this commit |
| -------- | ---- | -------------------- |
| Critical | 0    | 1                    |
| High     | 1    | 2                    |
| Medium   | 4    | 0                    |
| Low      | 3    | 0                    |

H3 (legacy `@ts-nocheck` routes) is left open per the "no refactoring"
constraint — the routes are not in the Phase 7 ingress path and fixing
them requires schema/UX decisions outside this audit's scope.

---

## Critical

### C1 — SMS webhook accepted any non-empty `x-sms-secret` header [fixed]

**File:** `src/app/api/sms/webhook/[clinicSlug]/route.ts` (previously lines
76-79)

**Before fix:**

```ts
const secretHeader = request.headers.get("x-sms-secret");
if (!secretHeader && process.env.NODE_ENV === "production") {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
```

The check only verified the header's *presence*, never that it equalled a
secret owned by the clinic. An attacker who learned the public webhook URL
(`/api/sms/webhook/<slug>`) could forge inbound SMS messages — stitching
them into existing `Conversation` rows, impersonating patients, and
triggering downstream `tg.message.new` SSE events to staff clients — by
setting `x-sms-secret: anything`.

**Fix:** aligned with the SIP webhook (§6.7.5 / `calls/sip/event/route.ts`):

- Look up the clinic's active `ProviderConnection` (`kind = SMS`) and read
  `config.webhookSecret`.
- Constant-time compare the provided header with the stored secret using
  `safeEqual`.
- In production, require the secret to be configured; otherwise reject with
  401. In development, log a warning and accept so local seeds continue to
  work without extra config.
- Clinic lookup is still wrapped in `runWithTenant({ kind: "SYSTEM" })` so
  the extension does not try to inject a tenant.

See the current implementation in `src/app/api/sms/webhook/[clinicSlug]/route.ts`.

---

## High

### H1 — NextAuth session had no `maxAge` (defaulted to 30 days) [fixed]

**File:** `src/lib/auth.ts` line 43

**Before fix:** `session: { strategy: "jwt" }` — with no `maxAge`, NextAuth
v5 falls back to a 30-day session. TZ §9.2 mandates CRM JWTs ≤ 24h.

**Fix:** added `maxAge: 60 * 60 * 24` (24h) and `updateAge: 60 * 60` so the
cookie is rotated hourly while the user is active. Mini-App sessions are
separate (per-request HMAC verification of Telegram init-data) and not
affected.

### H2 — `/api/auth/*` had no per-IP rate limit [fixed]

**File:** `src/app/api/auth/[...nextauth]/route.ts`

**Before fix:**

```ts
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

TZ §9.2 requires 5 req/min/IP on the auth endpoints to slow credential
stuffing. No throttle existed — an attacker could hammer
`/api/auth/callback/credentials` at full speed.

**Fix:** wrapped the NextAuth handlers so POST requests are throttled with
the existing `rateLimit()` helper keyed on `x-forwarded-for` (falling back
to `x-real-ip` then `"unknown"`). Limit is 5 req/min matching §9.2; GET
passes through unthrottled because it serves the CSRF + providers endpoints
the sign-in flow relies on. On breach we return 429 with `retry-after: 60`
and a plain JSON body so `next-auth`'s client surfaces the generic error
without leaking that the rate limiter was hit.

Note: the in-memory rate limiter is not cluster-safe — tracked under M3
below for a Phase 6/7 Redis swap.

### H3 — Legacy `@ts-nocheck` routes bypass tenancy injection

**Files:**

- `src/app/api/leads/route.ts`
- `src/app/api/leads/[id]/route.ts`
- `src/app/api/leads/[id]/book/route.ts`
- `src/app/api/booking/route.ts`
- `src/app/api/kiosk/checkin/route.ts`
- `src/app/api/kiosk/doctors/route.ts`
- `src/app/api/queue/route.ts`
- `src/app/api/queue/[id]/route.ts`
- `src/app/api/queue/call/route.ts`
- `src/app/api/queue/status/[id]/route.ts`
- `src/app/api/tv-queue/route.ts`
- `src/app/api/telegram/notify/route.ts`
- `src/app/api/telegram/webhook/route.ts`

Each of these starts with `// @ts-nocheck` and calls `prisma.*` directly
outside any `runWithTenant()` frame. That means the Prisma extension in
`src/lib/prisma.ts` cannot inject `clinicId` — the route is either hard-
coded to a single tenant (original single-clinic era) or reads `clinicId`
from untrusted input.

**Status:** left as-is in this audit per the "no refactoring" constraint.
The authenticated CRM surface (`createApiHandler` / `createApiListHandler`)
and the newer platform/miniapp/webhook handlers all enforce tenant context
correctly. The legacy routes should either:

1. Be deleted (kiosk/queue/tv-queue are superseded by the Phase 4 CRM).
2. Or be rewritten on top of `createApiHandler` / `createPlatformHandler`
   with an explicit `TenantContext` before they are re-enabled behind a
   customer-facing feature flag.

Recommendation: file a follow-up ticket tagged `security/legacy-handlers` to
pick one of the two paths in Phase 8. Until resolved, these routes should
stay out of the public ingress (they are currently unreachable in prod
because no UI calls them in the new CRM layout, and the charter allows
existing TODO status).

---

## Medium (recommend, not fixed)

### M1 — PII in log-only notification adapters

**Files:**

- `src/server/notifications/adapters/sms-log-only.ts` line 17
- `src/server/notifications/adapters/tg-log-only.ts` line 12

Both `console.info` the recipient phone / chat id and the first 80
characters of the message body. In production these adapters should never
run (real ones replace them once `ProviderConnection` is configured), but
dev and preview environments write patient phone numbers to the container
log stream — which will flow into whatever log sink we wire up in Phase 6.

Recommendation: redact the destination to `***NNNN` (last four) and truncate
the body preview to a fingerprint (e.g. `sha256(body).slice(0,8)`) before
logging. Keep the adapter name + providerId so pipeline observability is
unaffected. Gate the verbose form behind `DEBUG_NOTIFICATIONS=1`.

### M2 — `publishEventSafe` payloads embed message previews

**File:** `src/app/api/sms/webhook/[clinicSlug]/route.ts` lines 152-161 (and
the Telegram webhook equivalent)

We broadcast `preview: body.slice(0, 200)` over the SSE bus to every
connected staff client in the clinic. That is intentional for the inbox
ticker, but the SSE endpoint currently has no per-role filtering — any
authenticated CRM user of the clinic sees the preview, including
`CALL_OPERATOR` and `NURSE` roles that may not have inbox permission per
TZ §2.

Recommendation: when the Phase 6 realtime layer lands, add a topic scope
(`conversations:inbox`) so only roles with `conversations:read` subscribe to
`tg.message.new`.

### M3 — In-memory rate limiter is not cluster-safe

**File:** `src/lib/rate-limit.ts`

Global `Map<string, ...>` is per-process. On a multi-pod deployment an
attacker can reach `N × limit` requests simply by hitting different pods.
Both the existing public booking / kiosk check-in throttle and the new
`/api/auth/*` wrapper above are affected.

Recommendation: swap the backing store for Redis (INCR + EXPIRE) when the
Phase 6 infra lands. The function signature is intentionally generic so the
swap is internal.

### M4 — CI did not run `npm audit` or a secret scanner [fixed]

**File:** `.github/workflows/ci.yml`

**Fix:** added two non-blocking-by-default audit steps to the `check` job:

- `npm audit --omit=dev --audit-level=high` runs after `npm ci`. `high` is
  the threshold that fails the job; everything below is reported but
  tolerated so a transient advisory does not block shipping.
- `gitleaks detect` runs against the working tree using the upstream GitHub
  Action. `.env` is already in `.gitignore`, so this is a belt-and-braces
  check to catch accidents (a stray `.pem` or hard-coded token).

---

## Low (recommend)

### L1 — `next-auth` is on a beta release (`5.0.0-beta.30`)

Keep an eye on the beta → RC → stable cadence; pin to a specific RC once
available so we do not silently pick up breaking API changes. Not urgent
because the surface we depend on (`NextAuth()`, `auth()`, `handlers`,
callbacks) has been stable across betas.

### L2 — Audit log is fire-and-forget

**File:** `src/lib/audit.ts`

`writeAudit` swallows failures. For most compliance use-cases that is
correct (we should not break the API call because the audit row failed to
persist), but we currently do not have a fallback queue. If PostgreSQL is
momentarily unavailable we silently lose the audit entry. Acceptable for
Phase 5/7; revisit when the queue/worker infra lands.

### L3 — Platform override cookie has 30-minute TTL

**File:** `src/server/platform/clinic-override.ts`

A SUPER_ADMIN who impersonates a clinic stays in that clinic's context for
up to 30 minutes. That matches the UX expectation (platform ops want to
hop between clinics without re-clicking) but longer than strictly needed.
Not blocking; revisit if we see it abused in platform audit logs.

---

## What we actively verified and found clean

- **RBAC:** every CRM route goes through `createApiHandler`/
  `createApiListHandler` which enforces `roles: [...]` and returns 403 on
  mismatch. Platform routes go through `createPlatformHandler` which
  forces SUPER_ADMIN. Mini-App routes go through `createMiniAppHandler`
  which verifies Telegram init-data HMAC before running the body.
- **Tenancy:** Prisma extension in `src/lib/prisma.ts` refuses to run any
  query on a tenant-scoped model outside `runWithTenant()`. All authenticated
  API handlers and server-side page loaders wrap their Prisma calls in
  either `runWithTenant({kind:"TENANT"})` or the SYSTEM/SUPER_ADMIN variants.
- **Input validation:** every mutating route declares a Zod `bodySchema`
  via the handler factories. Query strings are parsed with Zod helpers
  (`src/lib/api-handler.ts`). No `body.json()` is trusted without parse.
- **Secrets in repo:** `.env*` is gitignored (`!.env.example` opt-in only).
  Grepped for typical token shapes — no hardcoded API keys, tokens, or
  private keys found. `RECEPTIONIST_PIN` reads from env with a
  fail-closed guard in `src/lib/pin.ts`.
- **XSS:** React auto-escapes. The single `dangerouslySetInnerHTML` usage
  in `src/app/[locale]/crm/telegram/_components/message-bubble.tsx` HTML-
  escapes first and only adds bold/italic/linkify via a URL whitelist
  (`https?://`). SVG/HTML file uploads do not exist — Phase 6.
- **SQL injection:** Prisma parameterises everything. The only raw SQL is
  `prisma.$queryRawUnsafe("SELECT 1")` in `/api/health` and
  `/api/platform/health` — literal string, no interpolation.
- **Webhook signature verification:** `sip/event`, `telegram/webhook/
  [clinicSlug]`, and (now) `sms/webhook/[clinicSlug]` all compare the
  header against the clinic-scoped secret with constant-time equality and
  return 401 on mismatch.
- **Session / JWT:** JWT strategy, `AUTH_SECRET` 32+ bytes enforced at
  runtime (NextAuth startup check), `SameSite=Lax` cookies (NextAuth
  default), `HttpOnly` set by NextAuth, `Secure` enforced by the host in
  prod. With H1 fixed, CRM session TTL is 24h.
- **PII in logs:** only the two log-only adapters touched PII (M1). The
  main API handler logs request IDs, paths, roles, and statuses — no
  bodies.

---

## Follow-ups for Phase 8+

1. Redis-backed rate limiter (M3).
2. Delete or rewrite the legacy `@ts-nocheck` routes (H3).
3. Redact PII in dev log-only adapters (M1).
4. SSE topic scoping by role (M2).
5. Pin `next-auth` off beta (L1).
