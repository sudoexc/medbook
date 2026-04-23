# Security Checklist for Page / API Agents

Use this list every time you add or modify a route handler, server action,
server component that reads data, or public webhook. It distils the TZ §9.2,
§5.5, and §2 requirements into concrete pass/fail gates.

If an item does not apply (e.g. a read-only public endpoint and "Zod body"),
write a one-line justification in the PR description.

---

## 1. Authentication

- [ ] CRM routes use `createApiHandler({ roles: [...] })` or
      `createApiListHandler`.
- [ ] Platform (SUPER_ADMIN only) routes use `createPlatformHandler`.
- [ ] Mini-App routes use `createMiniAppHandler`.
- [ ] Public webhooks verify a secret (HMAC or constant-time header compare)
      against a clinic-scoped secret stored in `ProviderConnection.config`
      or `Clinic.<field>`. No bare "header exists" check.
- [ ] `/api/public/*` endpoints are rate-limited to 10 req/min/IP.
- [ ] `/api/auth/*` endpoints are rate-limited to 5 req/min/IP.

## 2. Authorisation (RBAC)

- [ ] Explicit `roles: [...]` allow-list; do not rely on "any authenticated
      user".
- [ ] 403 (not 404 / not 200) when the session role is not in the allow-list.
- [ ] SUPER_ADMIN is bypassed by the handler factory only when the feature
      is global (e.g. platform); otherwise it is listed explicitly.
- [ ] No `session.user.role === "ADMIN"` checks inline — use the handler
      factory's role list or a server-side guard helper.

## 3. Tenancy isolation

- [ ] Every Prisma call runs inside `runWithTenant({...})`. Handler
      factories do this automatically; server components must wrap
      explicitly when they read data in page-level `generateMetadata` /
      `page.tsx`.
- [ ] When you must use `{ kind: "SYSTEM" }` (e.g. cron, webhooks, sign-in),
      pass the tenant's `clinicId` explicitly in every `where` clause.
- [ ] Never trust `clinicId` from the request body / query string; always
      derive it from the authenticated session, the webhook's slug lookup,
      or the Mini-App init-data.
- [ ] `MODELS_WITHOUT_TENANT` in `src/lib/prisma.ts` is the single source of
      truth — do not add a new tenant-scoped model without also adding the
      `clinicId` column and the appropriate `@@index`.

## 4. Input validation (Zod)

- [ ] Every POST / PATCH / PUT / DELETE declares a `bodySchema` in the
      handler factory.
- [ ] Query parameters go through a Zod schema (not ad-hoc
      `searchParams.get`).
- [ ] Numeric IDs, enums, dates are `.coerce`d and bounded. Strings have
      `.max()` bounds.
- [ ] Nested objects: prefer `z.object({...}).strict()` so unknown keys are
      rejected, and explicitly list what you accept.
- [ ] File uploads use the shared multipart helper (Phase 6) — do not parse
      `multipart/form-data` by hand.

## 5. Output encoding (XSS)

- [ ] All rendering goes through React (auto-escaped).
- [ ] No `dangerouslySetInnerHTML` unless:
      - input is HTML-escaped first, AND
      - the transformation only introduces a whitelisted set of tags / URLs
        (see `message-bubble.tsx` for the pattern).
- [ ] `target="_blank"` links always include `rel="noopener noreferrer"`.
- [ ] JSON returned from APIs: use `Response.json(...)` — do not hand-craft
      with `new Response(`...`)`.

## 6. SQL / NoSQL injection

- [ ] All queries go through Prisma's generated client. No string
      concatenation into `$queryRawUnsafe`.
- [ ] Raw SQL is limited to health checks (`SELECT 1`) and must be a literal
      string — no template interpolation.
- [ ] Full-text search uses Prisma's `search` / `contains` operators; user
      input is never spliced into raw SQL.

## 7. Secrets management

- [ ] No secrets in the repo. `.env*` is gitignored. Review for `*.pem`,
      `*.key`, `*.p12`, hard-coded tokens before committing.
- [ ] Tenant-scoped secrets go through `encryptSecret()` in
      `src/server/crypto/secrets.ts`. Never store plaintext in Prisma.
- [ ] The encryption KDF uses `APP_SECRET`; its rotation is a platform-ops
      task, not a per-clinic action.
- [ ] Displaying a secret in the CRM UI (clinic settings) requires the user
      to re-enter their password — never show a stored secret in the clear.

## 8. Sessions & cookies

- [ ] NextAuth JWT `maxAge` ≤ 24h for CRM, ≤ 30d for Mini-App.
- [ ] `session.updateAge` is set so the token rotates during an active
      session.
- [ ] Sign-out clears the auth cookie and any platform override cookie.
- [ ] Cookies are `HttpOnly`, `Secure` in prod, `SameSite=Lax`.
- [ ] Platform override cookie is HMAC-signed with constant-time compare.

## 9. Rate limiting & brute force

- [ ] Public booking / webhook endpoints are throttled per-IP (10/min).
- [ ] Auth endpoints are throttled per-IP (5/min).
- [ ] PIN / password endpoints have per-account lockout after N failures
      (see `src/lib/pin.ts` for the pattern).
- [ ] `/api/events` SSE connections have a per-client cap (Phase 6).

## 10. CSRF

- [ ] Mutating routes are same-origin and rely on `SameSite=Lax` + the fact
      that credentials are JWT cookies.
- [ ] Form submissions happen via `fetch` with `credentials: "include"` and
      JSON bodies — no classic form POST that could be cross-origin.
- [ ] Public webhooks are exempt (they are not browser contexts) but MUST
      verify a secret (see Authentication bullet 4).

## 11. PII & logging

- [ ] Never log patient name, full phone, email body, chat content, or
      message preview at INFO level.
- [ ] Audit rows (`src/lib/audit.ts`) record action + actor + target + meta
      — not the sensitive payload.
- [ ] Server errors log a short message and a stable code; no stack traces
      cross tenant boundaries in user-visible responses.
- [ ] Dev-only verbose logging must be gated behind `DEBUG_*` env flags.

## 12. Realtime (SSE)

- [ ] Published payloads do not leak PII across roles inside the same
      clinic. Respect the role → topic scoping in `src/server/realtime/`.
- [ ] SSE handlers verify the session the same way CRM API routes do.

## 13. File uploads (Phase 6+)

- [ ] MIME-type allow-list (not deny-list).
- [ ] Size limit enforced at the edge.
- [ ] Re-encode images server-side to strip EXIF / metadata.
- [ ] Store files with a random id, never the user-supplied filename.
- [ ] Serve via a signed URL with short TTL.

## 14. CI quality gates

- [ ] `npm run lint` passes.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npx vitest run` passes.
- [ ] `npm run build` produces `.next/standalone/server.js`.
- [ ] `npm audit --omit=dev --audit-level=high` passes (non-blocking below
      `high`).
- [ ] `gitleaks detect` finds no new findings.

---

When in doubt, read `docs/security/phase-7.md` for the current baseline and
the list of open medium/low findings. If a change affects anything in this
checklist in a non-trivial way, add a "Security:" bullet to the PR body.
