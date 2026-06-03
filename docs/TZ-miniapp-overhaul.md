# ТЗ — Mini-App overhaul

**Статус:** Draft · 2026-06-01 · автор: post-Phase-B аудит
**Скоуп:** полный апгрейд пациентской Telegram Mini App'ы — realtime, рефакторинг, UX, конвергенция с CRM/cabinet паттернами.
**Связанные документы:** `docs/TZ-cross-surface-sync.md` (envelope v2 / outbox, единая источник истины для realtime-контракта), `docs/TZ.md` §§4.6/8.8 (Patient surface), `docs/realtime.md`, `reference_medbook_design_tokens.md` (палитра и атомы).

---

## 0. TL;DR

Patient mini-app — это **третья поверхность из трёх**, и единственная, которая после Phase B envelope-v2 осталась полностью оффлайн. Она не публикует в outbox при бронировании/отмене и не подписана на SSE — любое изменение в CRM/cabinet'е пациент видит только через ручной refresh.

Дополнительно: 490-строчный booking handler смешивает 4 разные ответственности; 13 `as never` маскируют типобезопасность; нет skeleton'ов / error boundary / оптимистичных мутаций; дизайн-система форк отдельно от CRM с риском дрейфа; phone-нормализация и dev-bypass логика продублирована.

Этот ТЗ описывает целевое состояние, в котором:

1. Mini-app **симметрично участвует** в envelope-v2 cross-surface sync (publish + subscribe).
2. Доменные операции (`bookAppointment`, `cancelAppointment`, `attachToCase`) **унифицированы** с CRM через shared server functions из `src/server/appointments/**`.
3. UI слой имеет **производственное качество**: skeleton states, optimistic mutations, error recovery, TG WebApp surface depth.
4. Дизайн-система **конвергирована** с CRM через общий token-слой (минимизация дрейфа палитры/типографики при едином мобайл-first рендере).
5. Тех-долг (`as never`, дубли, monolithic handlers) **закрыт**.

Цель: к концу внедрения **mini-app становится full-citizen поверхностью** — пациент видит обновления в реальном времени, любой write идёт через тот же путь что и CRM-write, UX выдерживает 3G-сеть и сетевые сбои без потери действия.

Долговременно: mini-app должна быть **референсом для будущих пациент-поверхностей** (web-кабинет пациента, native app), а не одноразовым TG-фронтом.

---

## 1. Цели и нон-цели

### 1.1 Цели

| #   | Цель                                                              | Метрика приёмки                                                                                                                                                          |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | Patient видит CRM/cabinet изменения в realtime                    | После `appointment.confirmed` в CRM mini-app обновляет список ≤1с (без refresh); reconnect восстанавливает пропущенные события через `Last-Event-ID`                     |
| M2  | Mini-app публикует свои действия в envelope v2                    | POST `/api/miniapp/appointments` пишет в `EventOutbox` с `surface: "MINIAPP"`, `actor.role: "PATIENT"`, `actor.patientId: <pid>`; CRM получает событие через тот же путь |
| M3  | Унификация доменных функций                                       | `bookAppointment` существует ровно один раз в `src/server/appointments/book.ts` и вызывается из CRM, mini-app, voice-bot, любого нового канала                          |
| M4  | Booking handler ≤80 строк                                         | `src/app/api/miniapp/appointments/route.ts` POST — тонкий orchestrator: validate → call domain fn → format response; вся логика case/referral/conflict в shared modules  |
| M5  | Zero `as never` в `src/app/api/miniapp/**`                        | `grep -r "as never" src/app/api/miniapp` → 0 совпадений                                                                                                                  |
| M6  | UX устойчив к сетевым сбоям                                       | Сценарий "тап на 'забронировать' → 3G → таймаут" не теряет состояние; пользователь видит retry; повторный тап не создаёт дубль (idempotency-key)                          |
| M7  | TG WebApp surface depth                                           | Используем: MainButton, BackButton, popup, haptics, share intent, viewport API, color scheme, BiometryManager (если pinning); QR scan для талонов/направлений            |
| M8  | Design-system конвергенция                                        | Палитра + типографика mini-app читает токены из общего слоя `src/styles/tokens.css`; изменение одного hex-значения отражается одновременно в CRM и mini-app             |
| M9  | Family scenario безопасен                                         | `onBehalfOf` валидируется через `getActivePatientScope()` helper в одной точке; любой write на family-member идёт через тот же guard; ≥1 audit row с `onBehalfOfPatientId` |
| M10 | i18n полнота                                                      | Нет hardcoded RU/UZ строк в `src/app/c/**`; `pnpm i18n:audit` (новая команда) проходит без warnings                                                                       |

### 1.2 Нон-цели (НЕ в этом ТЗ)

- **Native iOS/Android app** — TG Mini App остаётся единственным mobile-каналом для патиента в этом цикле.
- **Web-кабинет пациента вне TG** — отдельный канал, не сейчас. Архитектура (envelope, shared domain fn) делается так, чтобы его легко добавить, но UI не строим.
- **AI-фичи в mini-app** — симптом-чек-бот, suggestion stream, voice intake — отдельный ТЗ Phase 15+.
- **Платёжная интеграция изменений** — текущая Click/Payme/Stripe воронка остаётся как есть, мы не трогаем `/api/miniapp/payments/**`.
- **Push-уведомления (FCM/APNs)** — пациент получает уведомления через TG bot triggers; mobile push отдельный канал, вне скоупа.
- **Multi-bot tenant isolation** — один TG-бот на одну клинику остаётся существующей моделью; multi-bot federation — отдельная история.

---

## 2. Текущее состояние

### 2.1 Поверхность

**Pages** (`src/app/c/[slug]/my/**`) — ~15 экранов: home, booking wizard (5 шагов), appointments, profile, documents, medications, NPS, pre-visit, refer, family, account/delete.

**API** (`src/app/api/miniapp/**`) — ~20 эндпоинтов: auth, clinic, appointments (CRUD + attach-case), family, profile, doctors, services, slots, documents, inbox, pre-visit, NPS, medications, treatment-plan, referral, account/{export, delete, cancel-deletion}.

**Shared** — `_components/` (mini-ui, mini-i18n, auth-provider, mini-app-shell, family-switcher, language-picker), `_hooks/` (use-miniapp-api + 12 ресурс-хуков на React Query), `_messages/{ru,uz}.ts` (323 строки каждый).

### 2.2 Семь конкретных разрывов (с file:line)

#### G2.1 — Realtime отсутствует целиком

- Нет endpoint'а `/api/miniapp/events` (проверено `glob src/app/api/miniapp/events*` → 0 файлов).
- Нет ни одного использования `useLiveQuery` или `new EventSource` в `src/app/c/**`.
- Нет ни одного `publishViaOutbox` / `publishEventSafe` в `src/app/api/miniapp/**`.
- Все хуки используют `cache: "no-store"` (`use-miniapp-api.ts:37`), что заставляет каждое возвращение на экран дёргать сеть — это маскировка отсутствия realtime, не его замена.

#### G2.2 — `appointments/route.ts` — 490 строк, 4 ответственности

- POST `/api/miniapp/appointments` (`src/app/api/miniapp/appointments/route.ts:160-490`) комбинирует:
  - Booking-валидация + Serializable tx с conflict detection (lines 220-330)
  - Referral reward auto-apply внутри той же tx (lines 279-290, 338-356)
  - Medical-case auto-create/auto-attach/2+ choices logic (lines 358-472)
  - Audit + fireTrigger (line 333)
- Аналогичная логика бронирования из CRM сидит в `src/app/api/crm/appointments/route.ts` POST — два независимых пути записи, которые **уже** разошлись (referral reward auto-apply в CRM **нет**, см. cross-surface-sync TZ §2.3 разрыв #6).

#### G2.3 — `as never` маскирует mismatch Prisma ↔ Zod

- 13 совпадений по `src/app/api/miniapp/**` (6 файлов: appointments, appointments/[id], appointments/[id]/attach-case, auth, family, pre-visit, account/delete).
- Примеры: `appointments/route.ts:268` (`data: { … } as never` при `appointment.create`), `auth/route.ts:101` (upsert patient), `family/route.ts:167` (link create).
- Корень: Prisma `UncheckedCreateInput` требует `clinicId` как relation field, а Zod-схема валидирует плоский body — текущий "обход" через `as never` гасит tsc, но не ловит реальные mismatches.

#### G2.4 — UX layer недописан

- **Skeleton'ов нет**: ни одного `*-skeleton.tsx` в `src/app/c/[slug]/my/_components/**`.
- **Error boundary**: `src/app/c/[slug]/my/layout.tsx` не оборачивает children в error boundary — auth-провайдер бросает → пустой экран.
- **Optimistic UI**: ни одной `onMutate` callback в hooks (`use-appointments.ts`, `use-profile.ts`, `use-family.ts` — все pessimistic).
- **Error toasts**: нет toast/snackbar системы; ошибки показываются как full-page error UI или silently swallowed.
- **Retry**: на auth-fail нет кнопки retry; на mutation-fail React Query default retry один раз, после — error без UI.

#### G2.5 — TG WebApp depth ~70%

- Используем: theme params, MainButton, BackButton, haptics (только в booking-confirm).
- Не используем: `showPopup`, `showAlert`, `showConfirm` (используем roll-our-own modals), `showScanQrPopup` (нет QR-сканера для талонов), `switchInlineQuery` (share/forward), `requestWriteAccess`, `expand`, `enableClosingConfirmation`, `BiometricManager` (для pinning возвратной авторизации).

#### G2.6 — Дизайн-система форк

- `mini-ui.tsx` — 199 строк, свой `MButton`, `MCard`, `MListItem`, `MSpinner`, `MEmptyState`(?).
- CRM использует shadcn (`src/components/ui/**`).
- Палитра берётся из TG `themeParams` (CSS vars `--tg-*`) — это **правильно** для TG-нативного look, но **не синхронизировано** с `reference_medbook_design_tokens.md`. Изменение брендовой палитры → ручная синхронизация в двух местах.
- Типографика mini-app задаётся локально в `mini-app-shell.tsx` font-stack; CRM использует Inter глобально. Несогласованность.

#### G2.7 — Дубли и copy-paste

- **Phone normalization**: `normalizePhone()` существует в `src/lib/phone.ts:13` и используется в `appointments/route.ts:16` — но `family/route.ts:86-87` и `auth/route.ts:56-58` имеют свою inline-логику.
- **Dev-bypass**: генерация synthetic user id в `miniapp-auth-provider.tsx:49-82` (клиент) дублируется в `src/server/miniapp/handler.ts:135-150` (сервер). Любое изменение одной стороны молча ломает другую.
- **Active patient resolve (family)**: `onBehalfOf` валидируется в `appointments/route.ts:50-60` и снова в `appointments/route.ts:172-180` (POST path) — две независимые валидации внутри одного файла.

---

## 3. Целевая архитектура

### 3.1 Три столпа

**Столп A — Realtime симметрия.** Mini-app становится full-citizen в envelope-v2:

- Новый endpoint `/api/miniapp/events` — SSE-стрим, scoped to authenticated patient (включая family-linked id'ы).
- Все mutations в `/api/miniapp/**` пишут в `EventOutbox` через `publishViaOutbox(tx, envelope)` с `surface: "MINIAPP"`, `actor: { role: "PATIENT", patientId, onBehalfOfPatientId? }`.
- Frontend — единый `useMiniAppLiveEvents(patientId)` hook, инвалидирующий React Query keys на основе `event.type` + `tenantScope`.

**Столп B — Унификация записей.** Доменные операции на appointments не имеют двух реализаций:

- `src/server/appointments/book.ts` (новый) — shared `bookAppointment({ doctorId, serviceIds, startAt, patientId, channel, actor, surface })`.
- POST `/api/crm/appointments` (CRM-booking) и POST `/api/miniapp/appointments` (patient-booking) — оба превращаются в тонкие orchestrator'ы вокруг этой функции.
- Логика referral-reward auto-apply, medical-case attach, conflict detection — вынесены в отдельные модули в `src/server/appointments/{referral,case-attach,conflicts}.ts`.

**Столп C — UX production-quality.** Mini-app выдерживает реальные мобильные сети:

- Skeleton'ы на каждом списке + форме (`<*Skeleton />` рядом с каждым `*-screen.tsx`).
- Error boundary в layout (`<MiniAppErrorBoundary />` с retry button + log to action-center).
- Optimistic mutations на book/cancel/profile-edit с rollback на 4xx/5xx.
- Toast система — TG-native (`showPopup` / `HapticFeedback`) + fallback на inline-toast.
- Idempotency keys на book/payment-init (предотвращение дублей при retry).

### 3.2 Архитектурная диаграмма

```
                                 ┌──────────────────────────────────────┐
                                 │  Mini-app (TG WebApp)                │
                                 │                                      │
                                 │   useMiniAppLiveEvents(patientId)   │
                                 │              │                       │
                                 │              ▼                       │
                                 │   React Query invalidator           │
                                 └─────────┬───────────────▲────────────┘
                                           │ SSE           │ mutate
                              GET /api/miniapp/events       │
                                           │               │
                                           ▼               ▼
                          ┌────────────────────────────────────────────┐
                          │  /api/miniapp/events/route.ts (новый)      │
                          │  - auth via TG init-data + verify          │
                          │  - resolve patient + family-linked ids     │
                          │  - subscribe to EventBus, filter by:       │
                          │      tenantScope.patientId ∈ allowedIds    │
                          │      OR appointmentId ∈ owned-appointments │
                          │  - replay из outbox по Last-Event-ID       │
                          └────────────────┬───────────────────────────┘
                                           │
                                           ▼
                          ┌────────────────────────────────────────────┐
                          │  EventBus + OutboxPumper (Phase B)         │
                          └────────────────────────────────────────────┘
                                           ▲
                                           │ publishViaOutbox(tx, env)
                                           │
   ┌────────────────────────────┐    ┌─────┴─────────────────────────┐
   │ POST /api/miniapp/appts   │───▶│ shared: bookAppointment(...)   │
   │ (route: thin orchestrator) │    │  - conflict detection         │
   └────────────────────────────┘    │  - referral reward apply      │
                                     │  - case auto-attach           │
   ┌────────────────────────────┐    │  - audit + publishViaOutbox   │
   │ POST /api/crm/appts        │───▶│                                │
   │ (route: thin orchestrator) │    └────────────────────────────────┘
   └────────────────────────────┘
```

---

## 4. Backend контракт

### 4.1 Новые / изменённые endpoints

| Метод + Path                                | Цель                                                                              | Изменение                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /api/miniapp/events`                   | SSE patient-scoped поток                                                          | **NEW**                                                  |
| `POST /api/miniapp/appointments`            | Booking                                                                           | **REFACTOR** — orchestrator вокруг `bookAppointment`    |
| `PATCH /api/miniapp/appointments/[id]`      | Reschedule (если разрешено правилами клиники)                                     | **REFACTOR** — orchestrator вокруг `rescheduleAppointment` |
| `DELETE /api/miniapp/appointments/[id]`     | Cancel                                                                            | **REFACTOR** — orchestrator вокруг `cancelAppointment`    |
| `POST /api/miniapp/appointments/[id]/attach-case` | Связать с кейсом                                                           | **REFACTOR** — вынести логику в `attachCaseToAppointment` |
| `POST /api/miniapp/family`                  | Добавить родственника                                                             | **PATCH** — publishViaOutbox `patient.familyLinked`      |
| `DELETE /api/miniapp/family/[id]`           | Удалить                                                                           | **PATCH** — publishViaOutbox `patient.familyUnlinked`    |
| `POST /api/miniapp/profile`                 | Edit profile                                                                      | **PATCH** — publishViaOutbox `patient.profileUpdated`    |
| `POST /api/miniapp/nps/[appointmentId]`     | Submit NPS                                                                        | **PATCH** — publishViaOutbox `nps.submitted`             |
| `POST /api/miniapp/pre-visit/[appointmentId]` | Pre-visit form submit                                                            | **PATCH** — publishViaOutbox `previsit.submitted`        |
| `POST /api/miniapp/inbox/[id]`              | Mark inbox item read                                                              | **PATCH** — publishViaOutbox `notification.read`         |

### 4.2 Shared domain functions (новые/обогащённые)

```
src/server/appointments/
  book.ts              (NEW)   — bookAppointment(input): {appointment, caseAttach}
  reschedule.ts        (NEW)   — rescheduleAppointment(input)
  cancel.ts            (exists; Phase B.2 — обогатить под miniapp surface=MINIAPP)
  confirm.ts           (exists; Phase B.1)
  emit-change.ts       (exists; Phase B.3)

src/server/cases/
  attach.ts            (NEW)   — attachCaseToAppointment / autoAttachOrChoices
  create.ts            (NEW)   — autoCreateCaseForBooking (extracted)

src/server/referral/
  apply-reward.ts      (NEW)   — applyReferralReward(tx, patientId, appointmentId) → ReferralReward | null

src/server/miniapp/
  active-patient.ts    (NEW)   — resolveActivePatient({ ctx, onBehalfOfParam }) → {patientId, isOnBehalf}
  family-allowed-ids.ts (NEW)  — getAllowedPatientIds(ownerPatientId) → string[]
```

### 4.3 Envelope events — добавления

Поверх типов из `TZ-cross-surface-sync.md` §4.2:

| Топик                          | Кто публикует                                       | Кто потребляет                                |
| ------------------------------ | --------------------------------------------------- | --------------------------------------------- |
| `appointment.created`          | shared `bookAppointment` (publish из любой surface) | CRM + cabinet + mini-app (own/family)         |
| `appointment.rescheduled`      | shared `rescheduleAppointment`                      | то же                                         |
| `appointment.cancelled`        | shared `cancelAppointment`                          | то же                                         |
| `patient.familyLinked`         | mini-app или CRM                                    | mini-app (обе стороны — owner + linked)      |
| `patient.familyUnlinked`       | то же                                               | то же                                         |
| `patient.profileUpdated`       | mini-app `profile/route.ts`                         | CRM (если открыт patient drawer)              |
| `notification.read`            | mini-app `inbox/[id]/route.ts` или TG webhook       | CRM (delivery-status badge)                   |
| `nps.submitted`                | mini-app `nps/[id]/route.ts`                        | CRM (NPS dashboard)                           |
| `previsit.submitted`           | mini-app `pre-visit/[id]/route.ts`                  | doctor cabinet (reception card)               |

### 4.4 SSE фильтрация для mini-app

`/api/miniapp/events` строит `allowedScope` один раз на коннект:

```ts
const allowed = {
  patientIds: new Set([ctx.patientId, ...(await getFamilyAllowedIds(ctx.patientId))]),
  clinicId: ctx.clinicId,
};
```

Каждое входящее envelope-событие пропускается через фильтр:

```ts
function shouldDeliver(env: EventEnvelope, allowed): boolean {
  if (env.tenantScope.clinicId !== allowed.clinicId) return false;
  // Patient-scoped: явный patientId совпадает
  if (env.tenantScope.patientId && allowed.patientIds.has(env.tenantScope.patientId)) return true;
  // Через appointmentId — если в payload есть patientId
  if (env.payload && typeof env.payload === "object" && "patientId" in env.payload) {
    const pid = (env.payload as { patientId?: string }).patientId;
    if (pid && allowed.patientIds.has(pid)) return true;
  }
  // Иначе drop
  return false;
}
```

### 4.5 Idempotency-key для критичных POST

POST `/api/miniapp/appointments` и POST `/api/miniapp/account/delete` принимают header `Idempotency-Key: <ulid>`. Сервер хранит маппинг `key → response_hash` в Redis на 24ч; повторный POST с тем же ключом возвращает кэшированный ответ. Frontend генерит ulid один раз при открытии экрана подтверждения брони и переиспользует на retry.

---

## 5. Frontend контракт

### 5.1 Realtime hook

```tsx
// src/app/c/[slug]/my/_hooks/use-miniapp-live-events.ts (NEW)
export function useMiniAppLiveEvents() {
  const qc = useQueryClient();
  const { state } = useMiniAppAuth();
  useEffect(() => {
    if (state.status !== "ready") return;
    const es = new EventSource(
      `/api/miniapp/events?clinicSlug=${state.clinic.slug}`,
      { withCredentials: true },
    );
    es.addEventListener("appointment.created", () => {
      qc.invalidateQueries({ queryKey: ["miniapp", "appointments"] });
    });
    es.addEventListener("appointment.cancelled", (e) => { /* ... */ });
    es.addEventListener("notification.read", () => { /* ... */ });
    // ... full event map
    return () => es.close();
  }, [state]);
}
```

Подключается один раз в `mini-app-shell.tsx`. Last-Event-ID хранится в `sessionStorage` и подставляется как query param на reconnect.

### 5.2 Skeleton'ы

Каждый list-экран получает соседний `*-skeleton.tsx`:

```
_components/
  appointments-screen.tsx
  appointments-skeleton.tsx     (NEW)
  documents-screen.tsx
  documents-skeleton.tsx        (NEW)
  ...
```

Skeleton — это 3-5 placeholder rows с pulse-анимацией (`@keyframes` в `mini-ui.css`). React Query `isPending` → skeleton; `isFetching && data` → существующий контент без перезаливки.

### 5.3 Error boundary

`src/app/c/[slug]/my/_components/error-boundary.tsx` (NEW) — class component с `componentDidCatch`. Логирует в `/api/miniapp/client-errors` (тоже NEW endpoint для serverside логирования критичных client-errors). UI: TG-нативный popup + "Перезагрузить" кнопка (вызывает `window.location.reload()`).

Wrapping: `layout.tsx` → `<MiniAppErrorBoundary><MiniAppAuthProvider>{children}</...></...></...>`.

### 5.4 Optimistic mutations

Пример (book cancel):

```ts
useMutation({
  mutationFn: (id) => apiCall(`/api/miniapp/appointments/${id}`, { method: "DELETE" }),
  onMutate: async (id) => {
    await qc.cancelQueries({ queryKey: ["miniapp", "appointments"] });
    const prev = qc.getQueryData(["miniapp", "appointments"]);
    qc.setQueryData(["miniapp", "appointments"], (old) =>
      old?.filter((a) => a.id !== id),
    );
    return { prev };
  },
  onError: (_err, _id, ctx) => {
    qc.setQueryData(["miniapp", "appointments"], ctx?.prev);
    showErrorToast("Не удалось отменить. Попробуйте ещё раз.");
  },
  onSettled: () => qc.invalidateQueries({ queryKey: ["miniapp", "appointments"] }),
});
```

То же для book (создание с временным id), profile-edit, family-add.

### 5.5 Toast / popup система

Единый хелпер `showToast(level: "info" | "success" | "error", message: string)`:

- В TG WebApp 6.2+: `Telegram.WebApp.showPopup({ message, buttons: [{ type: "ok" }] })` для error.
- В TG WebApp ≥ 6.1: `HapticFeedback.notificationOccurred("error" | "success")`.
- Fallback (старый TG): inline-toast (custom, нижний край).

### 5.6 TG WebApp surface depth

Добавляем wrappers в `src/lib/tg-webapp.ts`:

- `useMainButton({ text, onClick, color?, isVisible })` — wraps `Telegram.WebApp.MainButton`.
- `useBackButton(handler?)` — wraps `BackButton` (default → router.back()).
- `usePopup()` → `showAlert`, `showConfirm`, `showPopup`.
- `useScanQR(onResult)` — для QR-сканера талона/направления.
- `useShare({ text, url })` — `switchInlineQuery` для referral.
- `useClosingConfirmation(active: boolean)` — на формах с unsaved changes.

### 5.7 Skeleton + suspense boundary стратегия

Не используем React `Suspense` для data fetching — React Query'шный `isPending` flag достаточен и понятнее на client'е. Suspense оставляем только для code-splitting роутов через `next/dynamic`.

---

## 6. Design-system конвергенция

### 6.1 Token layer

Создаём `src/styles/tokens.css` (NEW) с CSS custom properties:

```css
:root {
  /* Brand */
  --brand-primary: #4f46e5;
  --brand-success: #10b981;
  --brand-warning: #f59e0b;
  --brand-danger: #ef4444;
  /* Surface */
  --surface-bg: #ffffff;
  --surface-bg-elevated: #f9fafb;
  --surface-text: #0f172a;
  --surface-text-muted: #64748b;
  --surface-border: #e2e8f0;
  /* Typography */
  --font-sans: "Inter", system-ui, sans-serif;
  --font-size-xs: 12px;
  --font-size-sm: 14px;
  --font-size-base: 16px;
  --font-size-lg: 18px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
}

[data-theme="dark"] { ... }
```

Tailwind config (CRM) читает токены через `theme.extend.colors`. Mini-app `mini-ui.tsx` атомы читают токены напрямую через `var(--surface-bg)`.

### 6.2 TG theme overrides

Mini-app shell мапит `Telegram.WebApp.themeParams` на токены:

```ts
// Только в miniapp shell:
document.documentElement.style.setProperty("--surface-bg", tg.themeParams.bg_color);
document.documentElement.style.setProperty("--surface-text", tg.themeParams.text_color);
// ... etc
```

Так brand-colors остаются от MedBook, но bg/text адаптируются под пользовательскую тему TG (light/dark/system).

### 6.3 Атомы

Mini-app остаётся со своими `MButton`, `MCard`, `MListItem` (мобайл-оптимизация + TG-нативный look), но:

- API сигнатуры выравниваются с shadcn-эквивалентами (`variant`, `size` enums одинаковы).
- Размеры/radii берутся из tokens.
- Документация — `_components/_DESIGN.md` (NEW) — какой компонент когда использовать.

---

## 7. Refactor backend modules

### 7.1 Распил `appointments/route.ts` POST

**До:** 490 строк, 4 ответственности.
**После:** ≤80 строк, делегирует в shared functions.

```ts
// Целевой shape:
export const POST = createMiniAppHandler({ bodySchema: BookBody }, async ({ ctx, body }) => {
  const active = await resolveActivePatient({ ctx, onBehalfOf: body.onBehalfOf });
  if (!active.ok) return forbidden(active.reason);

  const result = await bookAppointment({
    clinicId: ctx.clinicId,
    patientId: active.patientId,
    doctorId: body.doctorId,
    serviceIds: body.serviceIds,
    startAt: new Date(body.startAt),
    comments: body.comments ?? null,
    channel: "TELEGRAM",
    actor: {
      role: "PATIENT",
      userId: null,
      patientId: ctx.patientId,
      onBehalfOfPatientId: active.isOnBehalf ? active.patientId : null,
      label: `patient:${ctx.patientId}`,
    },
    surface: "MINIAPP",
    correlationId: newCorrelationId(),
  });

  if (!result.ok) return conflict(result.reason, result.detail);

  return ok({
    appointment: result.appointment,
    caseAttach: result.caseAttach,
    referralApplied: result.referralReward !== null,
  });
});
```

### 7.2 `bookAppointment` контракт

```ts
// src/server/appointments/book.ts (NEW)
export type BookInput = {
  clinicId: string;
  patientId: string;
  doctorId: string;
  serviceIds: string[];
  startAt: Date;
  comments: string | null;
  channel: AppointmentChannel;
  actor: Actor;
  surface: Surface;
  correlationId: string;
  idempotencyKey?: string;
};

export type BookResult =
  | { ok: true; appointment: Appointment; caseAttach: CaseAttachResult; referralReward: ReferralReward | null }
  | { ok: false; reason: "doctor_busy" | "cabinet_busy" | "service_not_found" | "doctor_inactive" | "rate_limit"; detail?: { until?: string } };

export async function bookAppointment(input: BookInput): Promise<BookResult> {
  // Idempotency check
  // Load doctor + services
  // Compute end, base price, referral discount
  // Resolve referral reward (call applyReferralReward in tx)
  // Serializable tx: conflict check → create → attach reward
  // After tx: emit envelope, fireTrigger, case auto-attach
}
```

CRM `POST /api/crm/appointments` тоже превращается в orchestrator вокруг этой функции (передаёт `surface: "CRM"`, `actor.role: "RECEPTIONIST"`).

### 7.3 `attachCaseToAppointment` логика

```ts
// src/server/cases/attach.ts (NEW)
export type CaseAttachOutcome =
  | { kind: "auto"; caseId: string }
  | { kind: "created"; caseId: string; title: string }
  | { kind: "needs_choice"; choices: OpenCaseChoice[] }
  | { kind: "skipped"; reason: string };

export async function autoAttachCase(input: {
  clinicId: string;
  patientId: string;
  appointmentId: string;
  doctorId: string;
  startAt: Date;
  preferredLang: "RU" | "UZ";
  primaryComplaint: string | null;
}): Promise<CaseAttachOutcome> {
  // Existing logic from appointments/route.ts:392-472, factored out
}
```

Вызов из обеих POST'ов booking'а после commit'а tx.

### 7.4 Типы вместо `as never`

Корень проблемы: Prisma `UncheckedCreateInput` требует `clinicId` (scalar), а `XxxCreateInput` ожидает relation `clinic: { connect: ... }`. Решение:

- Использовать `Prisma.AppointmentUncheckedCreateInput` явно (а не `as never`).
- Если нужны `connect` для связей, использовать `Prisma.AppointmentCreateInput` и не миксовать.
- Где Zod body даёт более узкий тип чем нужен Prisma — добавить explicit `satisfies Prisma.X` и не использовать `as never`.

Acceptance: `grep -r "as never" src/app/api/miniapp` → 0.

---

## 8. Phase plan

### Phase M0 — recon + setup (1 день)

- Создать tracking tasks (M1-M10 по ТЗ).
- Завести branch `miniapp-overhaul-phase-m`.
- Snapshot текущей карты mini-app в `reports/scratch/2026-06-XX-miniapp-overhaul-baseline.md` (для diff после).

### Phase M1 — Shared `bookAppointment` + refactor (3-4 дня)

**Цели:** M3 (унификация), M4 (≤80 строк), M5 (zero `as never`).

1. Создать `src/server/appointments/book.ts` с реализацией, портированной из CRM POST.
2. Создать `src/server/cases/attach.ts`, `src/server/referral/apply-reward.ts`, `src/server/miniapp/active-patient.ts`.
3. Переписать `POST /api/crm/appointments` через `bookAppointment` (CRM-сначала — мы знаем что там тесты есть).
4. Переписать `POST /api/miniapp/appointments` через `bookAppointment`.
5. Убрать все `as never` в mini-app routes — каждый case либо `satisfies Prisma.*UncheckedCreateInput`, либо explicit comment + cast.
6. Тесты:
   - Unit: `book.ts` — conflict, referral apply, idempotency.
   - Unit: `case-attach.ts` — все 4 outcome (auto/created/needs_choice/skipped).
   - Integration smoke: один e2e booking flow CRM + один miniapp.

### Phase M2 — Outbox publishers в mini-app (2-3 дня)

**Цели:** M2 (mini-app publishes).

1. `POST /api/miniapp/appointments` → `publishViaOutbox` `appointment.created` (через `bookAppointment` который уже это делает после M1).
2. `DELETE /api/miniapp/appointments/[id]` → `cancelAppointment` (уже умеет через Phase B.2).
3. `POST /api/miniapp/family` → `publishViaOutbox` `patient.familyLinked`.
4. `DELETE /api/miniapp/family/[id]` → `patient.familyUnlinked`.
5. `POST /api/miniapp/profile` → `patient.profileUpdated`.
6. `POST /api/miniapp/inbox/[id]` (mark read) → `notification.read`.
7. `POST /api/miniapp/nps/[appointmentId]` → `nps.submitted`.
8. `POST /api/miniapp/pre-visit/[appointmentId]` → `previsit.submitted`.
9. Расширить `events.ts` + `envelope.ts` (`EVENT_TYPES`, payload schemas, `EVENT_META`).

### Phase M3 — SSE endpoint + frontend hook (2 дня)

**Цели:** M1 (patient видит realtime).

1. `GET /api/miniapp/events/route.ts` — SSE handler с patient-scoped фильтром.
2. `Last-Event-ID` replay через `EventOutbox` (cursor-based, ≤200 событий).
3. `useMiniAppLiveEvents()` hook + интеграция в `mini-app-shell.tsx`.
4. Подключить event-type → React Query invalidation map.
5. Тест: e2e `tests/e2e/22-miniapp-realtime.spec.ts` — CRM подтверждает запись, mini-app видит обновление ≤2с.

### Phase M4 — UX production-quality (4-5 дней) ⚠️ "капризный" цикл

**Цели:** M6 (устойчив к сбоям), M7 (TG depth).

1. Skeleton'ы для всех list-экранов (8 компонентов).
2. `MiniAppErrorBoundary` + integration в layout.
3. Optimistic mutations на book/cancel/profile-edit/family-add/family-remove.
4. Toast/popup система через TG WebApp API.
5. Idempotency-key для booking POST.
6. TG wrappers (`useMainButton`, `useBackButton`, `usePopup`, `useScanQR`, `useShare`, `useClosingConfirmation`).
7. QR-сканер для referral code redemption + талона на приём.
8. Visual iteration round — ожидаем 3-5 раундов tweaks анимаций, transitions, haptics timing.

### Phase M5 — Design-system конвергенция (2 дня)

**Цели:** M8 (token layer).

1. Создать `src/styles/tokens.css`.
2. Перевести `mini-ui.tsx` атомы на токены.
3. Tailwind config CRM читает токены через `theme.extend.colors`.
4. TG-theme override layer в `mini-app-shell.tsx`.
5. `_components/_DESIGN.md` — гайд по атомам.

### Phase M6 — i18n + cleanup (1-2 дня)

**Цели:** M10 (i18n), M9 (family guard).

1. `pnpm i18n:audit` script — grep'ает hardcoded RU/UZ строки в `src/app/c/**`, exit code 1 на находку.
2. Пофиксить все находки.
3. `resolveActivePatient()` helper — единая точка валидации `onBehalfOf`.
4. Все `/api/miniapp/**` routes которые принимают `onBehalfOf` query/body → через helper.
5. Audit row guarantees: на каждый write от family-owner на behalf — `audit.meta.onBehalfOfPatientId`.

### Phase M7 — observability + acceptance (1 день)

1. Метрики:
   - `miniapp.sse.connections.active` (gauge)
   - `miniapp.sse.replay.events_total` (counter)
   - `miniapp.booking.duration_seconds` (histogram, p50/p95/p99)
   - `miniapp.booking.idempotency.hits_total` (counter)
   - `miniapp.outbox.publishes_total` (counter, label: event_type)
2. Smoke test scenarios прогон вручную (см. §9 ниже).
3. Закрытие tracking tasks.

---

## 9. Acceptance criteria — детально

| Цель | Сценарий                                                                                              | Pass critreria                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1   | CRM подтверждает запись (BOOKED → CONFIRMED)                                                          | mini-app обновляет статус ≤1с без refresh; в `sessionStorage` появляется `lastEventId`                                                                       |
| M1   | Mini-app reconnect после 5с offline                                                                   | при reconnect передаётся `?since=<lastEventId>`; получает missed события из outbox; UI догоняет состояние                                                  |
| M2   | Mini-app букает → CRM открыт на странице appointments                                                 | в CRM появляется новая строка ≤1с; outbox row: `surface=MINIAPP`, `actor.role=PATIENT`, `actor.patientId=<pid>`                                            |
| M3   | `grep -rn "prisma.appointment.create" src/app/api/{crm,miniapp}/appointments/route.ts`                | 0 матчей (всё через `bookAppointment`)                                                                                                                       |
| M4   | `wc -l src/app/api/miniapp/appointments/route.ts`                                                     | ≤120 строк (полный файл включая GET, PATCH, DELETE)                                                                                                          |
| M5   | `grep -r "as never" src/app/api/miniapp`                                                              | 0 совпадений                                                                                                                                                  |
| M6   | На confirm экране тап booking → `network throttling: Slow 3G → таймаут 30с → повтор тап`              | UI показывает retry-state, не fronzen; повтор тап с тем же idempotency-key возвращает 200 с первичным response; в БД 1 appointment                          |
| M7   | TG WebApp depth audit                                                                                 | используются: MainButton, BackButton, popup, haptics, theme-params, viewport, share, scanQR, closingConfirmation                                            |
| M8   | Изменить `--brand-primary` в `tokens.css`                                                             | визуально меняется одновременно в CRM `/[locale]/crm/calendar` и mini-app `/c/<slug>/my`                                                                     |
| M9   | Owner букает on behalf of family-member                                                               | audit row есть; `meta.onBehalfOfPatientId === <linked-id>`; mini-app другой семьи **не** получает событие                                                   |
| M10  | `pnpm i18n:audit`                                                                                     | exit code 0, нет hardcoded RU/UZ строк в `c/[slug]/my/**` (кроме `_messages/`)                                                                              |

---

## 10. Risks + rollback

### 10.1 Риски

| Риск                                                              | Вероятность | Воздействие | Митигация                                                                                                                                |
| ----------------------------------------------------------------- | ----------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Refactor booking ломает edge-case (referral, case-attach)         | Medium      | High        | Покрыть unit-тестами booking + case-attach + referral до начала refactor. Phase M1 не закрывается без 100% тестов на новые модули.       |
| SSE стрим на мобильном TG WebApp нестабилен (TG-клиент закрывает) | Medium      | Medium      | Heartbeat каждые 25с (стандарт). При close → retry с exponential backoff на frontend. Fallback на polling every 30s если SSE недоступен. |
| Optimistic UI создаёт race condition с realtime invalidation      | Low         | Medium      | onMutate cancel'ит in-flight queries; onSettled делает invalidate; live-event invalidator делает invalidate. Все три → одна eventual state. |
| Phase M4 "капризный цикл" затягивает M5/M6                        | High        | Low         | Параллелим: M4 на frontend, M5/M6 на backend. Жёсткий cutoff на 5 раундов tweaks для M4.                                                  |
| TG WebApp version fragmentation (старые версии не имеют popup)    | Medium      | Low         | Feature-detect через `tg.isVersionAtLeast("6.2")`; fallback на inline-toast.                                                              |
| Idempotency Redis key collision                                   | Very Low    | Medium      | Key = `idempotency:miniapp:<patientId>:<ulid>` — patientId в ключе исключает кросс-юзерные коллизии.                                      |

### 10.2 Rollback план

- **M1-M2 (refactor + publishers):** rollback по commit'у; обратно к `prisma.appointment.create` в route. Outbox события исчезнут, остальная система не сломается (outbox-pumper толерантен к пустоте).
- **M3 (SSE):** feature-flag `MINIAPP_REALTIME_ENABLED=false` → frontend не открывает SSE, fallback на текущий no-store polling.
- **M4 (UX):** каждый компонент изолирован. Skeleton/error-boundary/optimistic-mutations — отдельные PR'ы, можно откатить точечно.
- **M5 (tokens):** `tokens.css` это override layer, удалить → старые hardcoded values вернутся.

---

## 11. Telemetry / observability

### 11.1 Метрики

Все в Prometheus формате, scraped через `/api/internal/metrics`:

- `miniapp_sse_connections_active{clinic_id}` (gauge)
- `miniapp_sse_events_delivered_total{event_type, clinic_id}` (counter)
- `miniapp_sse_replay_events_total{clinic_id}` (counter)
- `miniapp_outbox_publishes_total{event_type, surface=MINIAPP}` (counter)
- `miniapp_booking_duration_seconds{outcome=success|conflict|error}` (histogram)
- `miniapp_booking_idempotency_hits_total` (counter)
- `miniapp_client_errors_total{kind}` (counter)

### 11.2 Логи

- Все error'ы `/api/miniapp/**` пишутся через `console.error("[miniapp:<route>]" + ...)` структурированно (JSON если `LOG_FORMAT=json`).
- `/api/miniapp/client-errors` (новый) принимает frontend error reports и пишет в `ActionCenter` с severity=warning, autoresolve=24h.

### 11.3 Dashboards

В Grafana (Phase M7):

- "Mini-app health": active SSE connections, error rate per route, booking p95.
- "Cross-surface latency": p95 time от outbox insert до patient SSE delivery — должен быть <1с.

---

## 12. Зависимости и порядок

- **TZ-cross-surface-sync Phase B** (B.1-B.6) — **готово**. Этот ТЗ строится поверх envelope-v2 + outbox.
- **Cross-surface-sync Phase C** (patient SSE infrastructure) — частично перекрывается с этим ТЗ §4.4 и Phase M3. Координация: SSE-endpoint реализуется здесь, общие helpers (envelope, outbox) уже в `src/server/realtime/**`.
- **Doctor cabinet unfreeze** (см. `feedback_medbook_priority_pivot.md`) — независим, не блокирует.

---

## 13. Открытые вопросы

1. **QR-сканер для талонов** — нужен ли в Phase M4 или отложить в отдельную фичу? Решение по результатам Phase M4 mid-review.
2. **Pinning повторного входа через BiometricManager** — улучшение security или дополнительная сложность? Решение зависит от security review.
3. **Web-кабинет пациента (non-TG)** — выходит ли в roadmap после этого цикла? Архитектура готова, но UI отдельный sprint.
4. **NotificationSend.delivered/read events** — реализуется здесь (`§4.3 notification.read`) или в notification rewrite ТЗ? Pendant: TZ-notifications (если будет).

---

## 14. Definition of Done

Этот ТЗ закрыт, когда:

- [ ] Все M1-M10 acceptance criteria пройдены (§9).
- [ ] `docs/realtime.md` обновлён (раздел Patient SSE).
- [ ] `docs/TZ.md` §4.6 (Patient surface) ссылается на этот документ.
- [ ] Все tracking-tasks закрыты.
- [ ] PR merged в main; деплой на staging; smoke-tests прошли; деплой на prod (с явного pasta-pacing'а по `feedback_no_autodeploy.md`).
- [ ] Telemetry dashboards собирают метрики в течение 7 дней без алертов.

