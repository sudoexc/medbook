---
title: Mini-app overhaul — pre-M1 baseline snapshot
date: 2026-06-01
tz: docs/TZ-miniapp-overhaul.md
phase: M0 (recon)
purpose: zero-state numbers + corrections to TZ; рантайм-diff после каждой M-фазы.
---

# Inventory

## Backend — `src/app/api/miniapp/**`

- **23 route files** (POST/GET/PATCH/DELETE).
- LOC ranking (top heavies):
  - `appointments/route.ts` — **490** (POST = 4 ответственности; основная мишень M1).
  - `nps/[appointmentId]/route.ts` — 336.
  - `family/route.ts` — 224.
  - `pre-visit/[appointmentId]/route.ts` — 204.
  - `medications/route.ts` — 165.
  - `appointments/[id]/route.ts` — 160.
  - все остальные ≤150.

## Frontend — `src/app/c/[slug]/my/**`

- **6 985 LOC total** (TSX/TS, без тестов).
- **15 page files** (home, booking 5-step wizard, appointments, profile, documents, family, medications, NPS, pre-visit, refer, account-delete + 2 nested).
- **27 components** в `_components/**`.
- **17 hooks** в `_hooks/**` (14 ресурс-hooks + auth provider + booking-draft + active-context).
- **2 message files** по 323 строки (ru + uz).

# Signal counts (M-acceptance гарды)

| Signal | Value | Source | M-goal |
| --- | --- | --- | --- |
| `as never` в `src/app/api/miniapp/**` | **13** (6 файлов) | grep | M5 → должно стать 0 |
| `cache: "no-store"` в `src/app/c/**` | **3** (TZ называл 1) | grep | M3 — заменяется на SSE-driven invalidate |
| `publishViaOutbox` / `publishEventSafe` в `src/app/api/miniapp/**` | **0** | grep | M2 → должно стать ≥8 |
| `onMutate` (optimistic UI) в `src/app/c/**` | **0** | grep | M4 → ≥5 (book, cancel, profile, family-add, family-remove) |
| `Skeleton*` компоненты в `src/app/c/**` | **0** настоящих (1 ложный — `inbox-banner.tsx` это просто текст комментария) | grep | M4 → ≥8 skeleton'ов |
| `ErrorBoundary` в `src/app/c/**` | **0** | grep | M4 → 1 root-level boundary |
| `useQuery`+`useMutation` calls | **58** в 14 hook-файлах | grep | M2-M3 — будут подключены к live invalidate map |
| Mini-app LOC vs CRM LOC ratio (booking) | mini-app **490** vs CRM **~330** (POST chunk) | wc | M1 → orchestrator каждого ≤80, общая логика в shared |

# Corrections to TZ (что было неточно)

1. **TG WebApp wrapper лежит не в `src/lib/tg-webapp.ts`** (как сказано в TZ §5.6), а в **`src/hooks/use-telegram-webapp.ts`**. Существуют `useTelegramWebApp()`, `useTelegramMainButton()`, `useTelegramBackButton()`, и hooks для `showAlert`/`showConfirm`. M4 wrappers (`useMainButton`, `useBackButton`, `usePopup`) — это **расширение существующего hook**, не green-field.
2. **`showAlert` + `showConfirm` уже широко используются** (~15 мест в 4 компонентах) — TZ §G2.5 "не используем popup/alert/confirm" неточно. Реальный пробел — отсутствие `showPopup` (rich), `showScanQrPopup`, `switchInlineQuery`, `requestWriteAccess`, `expand`, `enableClosingConfirmation`, `BiometricManager`. M4 уточнить scope.
3. **`normalizePhone` дублируется не как inline-логика, а как импорт-симметрия** — все 4 файла (`appointments`, `family`, `auth`, `profile`) импортируют из `@/lib/phone`. Дубля как такового нет — TZ §G2.7 преувеличил. Реальный дубль — dev-bypass synthesis (client+server) и onBehalfOf double-validation в `appointments/route.ts`. Эти два — настоящие, остаются в M1/M6 scope.
4. **Phase B uncommitted на main** — branch `miniapp-overhaul-phase-m` создавать сейчас нельзя (потащит uncommitted Phase B changes). Работаем на main, как делали Phase B. Branch open question — решать одновременно с deploy-решением по Phase B.

# As-built map (для diff'а после)

```
src/app/api/miniapp/
├── account/                      3 routes
├── appointments/                 3 routes  ← основная мишень M1
├── auth/                         1 route
├── clinic/                       1 route
├── doctors/                      1 route
├── documents/                    1 route
├── family/                       2 routes
├── inbox/                        2 routes
├── medications/                  2 routes
├── nps/                          1 route
├── pre-visit/                    1 route
├── profile/                      1 route
├── referral/                     1 route
├── services/                     1 route
├── slots/                        1 route
└── treatment-plan/               1 route
                                  ───
                                  23 routes (0 publishers)

src/app/c/[slug]/my/
├── _components/                  27 файлов (mini-ui + screens)
├── _hooks/                       17 файлов (14 ресурс + 3 utility)
├── _messages/                    2 файла (ru/uz)
└── pages/                        15 page.tsx
                                  ────────
                                  ~61 файла, 6 985 LOC
```

# Acceptance grep'ы для будущих фаз (executable)

Запускать в конце каждой M-фазы:

```bash
# M5
grep -r "as never" src/app/api/miniapp | wc -l
# expected after M1: 0

# M2
grep -r "publishViaOutbox" src/app/api/miniapp | wc -l
# expected after M2: ≥8 файлов

# M4
grep -rE "onMutate\\s*[:(]" src/app/c | wc -l
# expected after M4: ≥5

# M4
find src/app/c/[slug]/my -name "*skeleton*.tsx" | wc -l
# expected after M4: ≥8

# M10
pnpm i18n:audit  # (создаётся в M6)
# expected: exit 0

# M4 (booking handler shrink)
wc -l src/app/api/miniapp/appointments/route.ts
# expected after M1: ≤120
```

# Out-of-scope для baseline (не блокируем M1, разберём по ходу)

- Точные query keys для invalidate map в `useMiniAppLiveEvents` — определятся при M3 реализации.
- Конкретные слова для `i18n:audit` (RU/UZ кириллица + узбекская латиница вместе) — оформляется в M6 script.
- Token palette diff CRM ↔ mini-app — собирается в M5.
