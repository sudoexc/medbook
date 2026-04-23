# UX Phase 7 — Polish Pass

**Agent:** `ux-polisher`
**Scope:** `docs/TZ.md` §9.6 (UX micro-details) + §10.Фаза 7.
**Parallel tracks:** `security-reviewer`, `a11y-engineer`, `performance-optimizer`.
**Files not touched per coordination rules:** `src/app/api/*`, `prisma/schema.prisma`, ARIA attributes, bundle/dynamic-import surgery.

Baseline coming out of Phase 6: 239 vitest tests, `tsc --noEmit` clean, `npm run build` exit 0.
Post-polish quality gates: 239 vitest tests, `tsc --noEmit` clean for every file I touched (one pre-existing TS2345 in `src/app/api/auth/[...nextauth]/route.ts` introduced by a parallel agent is out of scope), `npm run build` exit 0.

## Summary — before / after

| Area | Before | After |
|---|---|---|
| Toast provider | `sonner` already mounted in `src/app/layout.tsx` with `<Toaster position="top-right" />` | No change — verified |
| Top-level CRM error boundary | none (Next default white-screen) | `src/app/[locale]/crm/error.tsx` with **Повторить** + **Вернуться** |
| Top-level admin error boundary | none | `src/app/admin/error.tsx` (RU labels — operator-only surface) |
| Per-page loading skeletons | Only inside client components (after mount); route transitions showed blank | Added `loading.tsx` for patients / appointments / doctors / reception / call-center / telegram / notifications / analytics / documents / calendar + generic fallback at `src/app/[locale]/crm/loading.tsx` |
| Shared `<PageSkeleton>` molecule | — | `src/components/molecules/page-skeleton.tsx` — configurable header + KPI + filters + table/grid body + right rail |
| Empty states | Present on every table/list already (24 files import `EmptyState`) | Verified — no gaps |
| Global search shortcut | `⌘K` / `Ctrl+K` only | Added `/` (Gmail/GitHub convention) — ignores `input`/`textarea`/`contenteditable` so typing stays undisturbed. Topbar hint updated to "⌘K · /" |
| Toast on mutations | Consumer components fire toasts in `onSuccess` / `onError` throughout | Audited — verified toasts exist on: create/edit patient, new appointment, 409 conflict, bulk status, queue status, save clinic, create/update user, save schedule, add time-off, send SMS, template CRUD, integrations test/save, exchange-rate save, cabinet/service CRUD, SMS compose, retry send, documents upload, telegram send, takeover, payment create |
| Keyboard shortcuts | `⌘K` open search, Radix handles Esc close, Enter submits forms | Added `/` → open search. Esc/Enter already handled by Radix primitives and form `onSubmit`, not overridden anywhere |
| Test IDs | existing ones preserved | Not touched (test-engineer scope) |

## File inventory

### Added

| Path | Purpose |
|---|---|
| `src/app/[locale]/crm/error.tsx` | CRM top-level error boundary |
| `src/app/admin/error.tsx` | Admin platform top-level error boundary |
| `src/app/[locale]/crm/loading.tsx` | Generic fallback skeleton |
| `src/app/[locale]/crm/patients/loading.tsx` | List + rail |
| `src/app/[locale]/crm/appointments/loading.tsx` | KPI + filters + table |
| `src/app/[locale]/crm/doctors/loading.tsx` | Filters + grid + rail |
| `src/app/[locale]/crm/reception/loading.tsx` | KPI + grid + rail |
| `src/app/[locale]/crm/call-center/loading.tsx` | Bespoke 3-col (queue / active / history) |
| `src/app/[locale]/crm/telegram/loading.tsx` | Bespoke 3-col inbox |
| `src/app/[locale]/crm/notifications/loading.tsx` | Tabs + tree + editor + stats rail |
| `src/app/[locale]/crm/analytics/loading.tsx` | Header + 6 chart placeholders |
| `src/app/[locale]/crm/documents/loading.tsx` | Filters + table |
| `src/app/[locale]/crm/calendar/loading.tsx` | Toolbar + week grid stub |
| `src/components/molecules/page-skeleton.tsx` | Reusable skeleton molecule |
| `docs/ux/phase-7.md` | This document |

### Modified

| Path | Change |
|---|---|
| `src/components/layout/global-search.tsx` | `useGlobalSearchShortcut` now also fires on `/` when target is not an editable element |
| `src/components/layout/crm-topbar.tsx` | Updated kbd hint to "⌘K · /" + comment |
| `src/messages/ru.json` | Added `common.goHome`, `common.errorBoundaryTitle`, `common.errorBoundaryDescription` |
| `src/messages/uz.json` | Same keys, uz translations |

## Checklist walk-through

### 1. Toast provider

Verified `sonner` mounted once at `src/app/layout.tsx:25` — no change.

### 2. Empty states

Every CRM list/table already has a meaningful `<EmptyState>` with icon / title / description / CTA. Grep confirms 24 files import the atom; `patients-table.tsx` / `appointments-table.tsx` / `doctors-page-client.tsx` / `calendar-page-client.tsx` / `call-center` / `telegram` / `notifications` / `settings/*` all covered. "No data" / `.length === 0` patterns audited — no raw placeholder strings remain in the CRM tree.

### 3. Skeletons

Added Next.js App Router `loading.tsx` files — these render instantly on server navigation (before the client component mounts and fires its own TanStack Query loader). Each file's shape mirrors its page layout (confirmed against the page client component before writing the skeleton). Where a simple two-col / table fit, the files delegate to `<PageSkeleton>`; where the layout is bespoke (call-center 3-col, telegram inbox, calendar swim-lanes, notifications tabs+tree+editor) the file inlines a hand-rolled set of `<Skeleton>` blocks.

Client-side skeletons inside `isLoading ? <Skeleton … /> : …` branches were left untouched — they are already present in every data-heavy page (analytics charts, notification stats, doctor heat-grid, patients-table body, appointments-table body, audit log, settings list views, etc.).

### 4. Error boundaries

- `src/app/[locale]/crm/error.tsx` — covers every `/crm/*` child route. Uses `useTranslations("common")` with three newly added keys (`errorBoundaryTitle`, `errorBoundaryDescription`, `goHome`) and `t("retry")` which already existed.
- `src/app/admin/error.tsx` — admin platform is outside `[locale]`, so labels are in RU directly. Also logs `error` to console for Sentry pickup.

Dev builds surface `error.digest` + `error.message` in a `<pre>` block; prod keeps it behind `process.env.NODE_ENV`. Next.js will hook this file as the nearest `error.tsx` for any thrown error in `/crm/**` children — no change in existing pages needed.

### 5. Loading buttons

Grep for `onClick={.*async` returned a single match in `documents-tab.tsx` (signature-pad save), which already binds `isPending` to the button's `disabled`. Form submissions across the CRM use `useMutation`'s `isPending` already (e.g. `new-patient-dialog.tsx`, `schedule-editor.tsx`, every settings `*-client.tsx`). No changes required.

### 6. Keyboard shortcuts

- `⌘K` / `Ctrl+K` — already wired in `useGlobalSearchShortcut`.
- `/` — added. Guards against editable targets so the key keeps working inside `<input>` / `<textarea>` / `[contenteditable]`.
- `Esc` — Radix `Dialog` / `Sheet` primitives close on Esc by default; grep confirms no `onEscapeKeyDown` handlers override the behaviour.
- `Enter` — form `onSubmit` handlers propagate naturally; `NewAppointmentDialog`, `new-patient-dialog`, `sms-dialog`, `message-composer` all use real `<form onSubmit>` or explicit Enter key handling where expected.

### 7. Toasts on mutations

Audit scope: every `useMutation` in the CRM tree. Result: all consumer sites already call `toast.success(...)` on `onSuccess` and `toast.error(...)` on `onError`. The hooks files themselves (e.g. `use-templates.ts`, `use-queue.ts`) are silent on purpose — toasts are composed at the call site so the message can be i18n'd against the screen's namespace. No spot fixes were needed.

### 8. Form UX — inline validation on blur

Left as-is. Current project convention is validate-on-submit via Zod schemas; mixing blur-time validation would require a larger refactor and the charter says "leave if already consistent". Validation UX is already uniform across `new-patient-dialog`, `schedule-editor`, `clinic-settings-client`, `users-settings-client`, etc.

## Quality gates

| Gate | Status | Notes |
|---|---|---|
| `npx tsc --noEmit` | clean within scope | Pre-existing `src/app/api/auth/[...nextauth]/route.ts` TS2345 is from a parallel security-reviewer change; API routes are outside UX polisher scope |
| `npx vitest run` | **239 / 239 passed** | Same as Phase 6 baseline |
| `npm run build` | exit 0 | Route manifest includes new `loading.tsx` + `error.tsx` |

## Known gaps / handoff

- **Inline blur validation** for email/phone — deferred; current validate-on-submit is consistent across all forms.
- **Visual regression** — no Percy/Chromatic configured; tracking is Phase 7 test-engineer's call.
- **ARIA attributes on new skeleton/error components** — intentionally not added; a11y-engineer owns ARIA hardening in parallel and will pass over the whole tree.
- **Sonner `richColors` / custom themes** — left default; design can be iterated later without code churn.
- **Signature / `autoFocus` first field on dialogs** — most dialogs already do this through Radix defaults; audit confirmed no missing cases in Phase 7 scope.
