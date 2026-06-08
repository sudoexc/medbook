# NeuroFax — Roadmap 11/10

> **Назначение.** Этот документ продолжает `docs/TZ.md` (фазы 0-10 уже сделаны, см. `docs/progress/LOG.md`). Цель здесь — не «закрыть гэпы до 10/10», а **выйти за рамки category-leading clinic CRM** в продукт, который конкуренты будут копировать. Девять фаз, ~12-14 недель, organized by ROI.
>
> **Базовая оценка по факту (2026-05-06):** SaaS 7.5/10, internal CRM 9/10, revenue optimization 6.5/10. После этого роадмапа: 10+ / 11 / 10.
>
> **Не отменяет TZ.md.** TZ остаётся источником правды для уже построенного. Этот документ — следующая глава.

---

## TL;DR — что делаем

| Фаза | Тема | Зачем | Длительность |
|---|---|---|---|
| **11** | Foundation Polish | Подчистить фундамент — meню, RBAC matrix, currency, onboarding, audit | 1 sprint (~5 дней) |
| **12** | Lifecycle & Timeline UX | Каждый экран отвечает «что сейчас» визуально; timeline объединяет всё | 1 sprint |
| **13** | Action Center | CRM сам говорит ресепшну «что делать сейчас» (top-5 actions) | 2 sprints |
| **14** | Revenue Engines | Empty Slot / Reactivation / No-Show v2 / Loss Analytics | 2 sprints |
| **15** | AI Co-Pilot | LLM в приложении: NL search, voice→SOAP, conversational TG booking | 2 sprints |
| **16** | Patient Experience | Mini App = daily-use: treatment plan, NPS, family, refer-a-friend | 1 sprint |
| **17** | Compliance & Trust | 2FA, granular PHI audit, data export/erase, session security | 1 sprint |
| **18** | Analytics & Reporting | Custom report builder, cohorts, doctor scoreboard, forecast | 1 sprint |
| **19** | SaaS Self-Service | Self-signup, billing self-service, white-label, support tools | 1 sprint |

**Итого:** 12 спринтов = 12-14 недель при текущем темпе (1 dev + agents).

---

## Принципы 11/10

1. **Proactive over reactive.** Экраны не просто показывают «что есть» — они показывают «что делать сейчас». Каждое решение — через призму: «после этой фичи ресепшн сделает на 1 действие меньше или заработает на 1 пациента больше?»
2. **AI as a feature, not a sticker.** LLM используется там, где он сокращает рутину (voice→SOAP, NL search, intent classification), а не как «AI-powered» вывеска.
3. **Closed-loop revenue.** Каждое действие потенциально даёт рубль или его теряет — мы это знаем, считаем и показываем.
4. **PHI is sacred.** До фазы 17 — никаких compromises на PHI, encryption, audit. Каждый view фиксируется.
5. **Multi-tenant first.** Все новые фичи work day-1 в multi-clinic режиме. Branch-aware где нужно.
6. **One screen, one job.** Не плодим экраны. Если фича вписывается в существующий экран — встраиваем. Если нет — спрашиваем «правда нужно?».
7. **Test what matters.** E2E на revenue-critical flows (booking, payment, action center → action done). Unit на pure logic (engines, scoring). Skip UI snapshot tests — слишком хрупкие.

---

## Фаза 11 — Foundation Polish (1 sprint)

**Цель.** Закрыть мелкие debts которые мешают всем последующим фазам. Без этого Action Center / Revenue будут валять рукой по разным форматам валют, проверять права через разрозненные guards, и показывать 4 кнопки которые никто не использует.

### Scope

- **Centralized currency** (`src/lib/format/currency.ts`): `formatCurrency(amount, locale)` для UZS с правильной типографикой («1 200 000 сум» / «1 200 000 so'm»). Refactor: grep `toLocaleString.*UZS|UZS.*toLocaleString|сум` и заменить на единый хелпер.
- **i18n missing keys audit**: dev tool `npm run i18n:check` — рендерит все ключи в обоих locales, ругается на missing. Fix `docsLibrary.types.RESULT` и аналоги.
- **Permission matrix UI** (`/crm/settings/roles`): таблица «роль × ресурс × действие» с галочками. Сейчас 6 ролей определены в коде, но админ не видит что они умеют.
- **Onboarding v2**: расширить `OnboardingChecklist` шагами:
  - templates (есть N шаблонов)
  - first appointment
  - first patient
  - TG bot connected (есть в integrations)
  - first doctor schedule
  - first cabinet
- **Reschedule history → AuditLog**: при `Appointment.startTime/doctorId/cabinetId` change писать `AuditLog.action = 'APPOINTMENT_RESCHEDULED'` с `oldSlot/newSlot` в metadata.
- **Menu cleanup**: переместить из основного `CRM_NAV` в Settings:
  - ~~SMS-Email (subitem of Settings → Communications)~~ — **CANCELLED** (SMS-канал удалён Q2 2026, см. `TZ-sms-removal.md`)
  - Documents (subitem of Settings → Knowledge Base)
  - Cabinets (subitem of Settings → Resources)
  - Services (subitem of Settings → Catalog)
  - Оставить в основном меню только day-to-day: Reception, Appointments, Calendar, Patients, Doctors, Call Center, Telegram, Notifications (queue/history), Analytics, Action Center (ph.13).
- **Dev signal: missing i18n key warner** — react component, который при `t('foo.missing')` рендерит `[MISSING: foo.missing]` в dev.

### Deliverables

- `src/lib/format/currency.ts` + tests
- `src/app/[locale]/crm/settings/roles/page.tsx` (permission matrix UI)
- `OnboardingChecklist v2` (расширенная)
- AuditLog `APPOINTMENT_RESCHEDULED` action + tests
- `CRM_NAV` cleanup
- `npm run i18n:check` script

### Agents

- `i18n-specialist` (existing) — i18n audit + missing key tool
- `multitenant-specialist` (existing) — permission matrix wiring + tests
- `reception-dashboard-specialist` (existing) — onboarding v2
- `settings-pages-builder` (existing) — roles page, menu cleanup
- `prisma-schema-owner` (existing) — AuditLog action enum extension
- `code-reviewer` + `i18n-specialist` + `test-engineer` в конце

### Gate

`npm run build && npx tsc --noEmit && npx vitest run` — clean. Visual смок: открыть `/crm/settings/roles` — таблица читаема. `/crm/reception` — onboarding показывает 8 шагов.

---

## Фаза 12 — Lifecycle & Timeline UX (1 sprint)

**Цель.** Глядя на любой экран, ресепшн / доктор должен сразу понять «в каком состоянии запись/пациент» и «что было раньше». Сейчас communications есть в timeline, а visits/payments/docs — отдельно.

### Scope

- **Visual appointment lifecycle** на странице записи: горизонтальная цепочка `BOOKED → WAITING → IN_PROGRESS → COMPLETED` с прыжком на любой шаг. NO_SHOW / CANCELLED / SKIPPED — отдельные boxes сбоку.
- **Drag/drop calendar reschedule**: в `/crm/calendar` event drag → modal «подтвердить перенос» → API → audit.
- **Quick status icon panel** на `/crm/reception` карточке записи: иконки (✓ пришёл / ⏱ в работе / ✓✓ завершить / × не пришёл) без открытия модалки.
- **Patient Timeline unification**: расширить `patient-timeline.tsx` до **всех** event types в одну ленту:
  - `VISIT` (Appointment.COMPLETED)
  - `PAYMENT` (Payment.PAID)
  - `DOCUMENT` (Document.created)
  - `NOTIFICATION` (NotificationSend.SENT/DELIVERED)
  - `CALL` (Call.completed)
  - `TG` (Message)
  - `CASE` (MedicalCase.created/closed)
  - `RESCHEDULE` (AuditLog.APPOINTMENT_RESCHEDULED)
  Группировать по дню; tabs ALL / VISIT / PAYMENT / COMM / DOC.
- **Empty states** consistent: каждый экран без данных показывает что делать (CTA). EmptyState atom уже есть — пройти по экранам и докрутить копирайтинг.

### Deliverables

- `appointment-lifecycle.tsx` компонент
- `/crm/calendar` drag/drop с audit
- Quick status panel на reception card
- `patient-timeline.tsx` v2 — unified event types
- Empty states copy review (i18n)

### Agents

- `appointments-page-builder` — lifecycle component + drag-drop
- `calendar-specialist` — drag-drop wiring
- `reception-dashboard-specialist` — quick status panel
- `patient-card-specialist` — timeline unification
- `ux-polisher` + `i18n-specialist` — empty states pass

### Gate

E2e: drag запись на новое время → audit log имеет запись. Patient timeline показывает >5 типов событий на seeded пациенте. Quick status icon на /reception меняет статус без modal.

---

## Фаза 13 — Action Center (2 sprints)

**Цель.** Главная фича 11/10. Ресепшн / админ заходит в систему и видит **что делать сегодня**, не «что есть в системе». Сокращает «think time» до нуля.

### Концепция

`Action` = атомарная рекомендация системы пользователю с deeplink на действие.

**Типы actions (initial set):**

| Тип | Триггер | Кому | Deeplink |
|---|---|---|---|
| `EMPTY_SLOT_TOMORROW` | свободный слот в peak hour завтра | RECEPTIONIST | `/crm/calendar?focus=<slot>` + reactivation suggest |
| `DORMANT_BATCH` | >20 dormant patients (>90d), no campaign in 30d | ADMIN | `/crm/notifications/campaigns/new?segment=dormant` |
| `UNCONFIRMED_24H` | tomorrow's appointments still BOOKED, not confirmed | RECEPTIONIST | `/crm/appointments?status=BOOKED&date=tomorrow` |
| `NO_SHOW_RISK_HIGH` | appointment с no-show risk > 0.6 в ближайшие 4ч | RECEPTIONIST | open patient → call action |
| `CASE_REPEAT_DUE` | MedicalCase requires repeat visit by date X | RECEPTIONIST | open case → propose slot |
| `OVERDUE_FOLLOW_UP` | post-visit task без выполнения >7д | ADMIN | task list |
| `DOCTOR_OVERLOAD` | у врача очередь > 8, есть свободный коллега | RECEPTIONIST | suggest reassign UI |
| `IDLE_ROOM` | кабинет свободен >20 мин, есть очередь | RECEPTIONIST | reassign to room |
| `PAYMENT_OVERDUE` | Appointment.PAID? false, дата в прошлом | RECEPTIONIST | open payment |
| `LOW_DOCTOR_SCHEDULE` | у врача <X слотов на след. 7д | ADMIN | open schedule |

### Scope

- **Schema**: model `Action` (id, clinicId, branchId?, type, severity, payloadJson, status, snoozeUntil, dismissedAt, doneAt, deeplinkPath, createdAt, expiresAt). Index `(clinicId, status, severity)`.
- **ActionEngine** (`src/server/actions/engine.ts`) — pure functions per action type, returns proposed actions. Each action type = own file.
- **BullMQ recurring job** `actions-recompute` каждые 15 мин: для каждой клиники прогоняет все детекторы, создаёт/обновляет `Action` rows, expires stale.
- **Daily briefing module** на `/crm/reception` справа: top-5 open actions for current user (filter by role + assignee).
- **Action Center page** `/crm/action-center`: list + filters (type, severity, status), bulk dismiss.
- **Action handlers**: deeplink + pre-filled state (e.g., `/crm/notifications/campaigns/new?segment=dormant&actionId=<id>` → marking action done after campaign sent).
- **Snooze UI**: 1h / 4h / tomorrow / next week / custom. Persist `snoozeUntil`.
- **Audit**: action created/dismissed/done → `AuditLog`.

### Deliverables

- `prisma/migrations/<ts>_action_engine.sql` + Action model
- `src/server/actions/{detectors,engine,handlers}.ts`
- `src/lib/actions/types.ts` — TypeScript types of action payloads
- BullMQ worker + scheduler
- `/crm/action-center` page
- Daily briefing module on `/crm/reception`
- 10 detector implementations (table above)
- Tests: pure detector logic + e2e (action created → user clicks → status DONE)
- i18n RU + UZ для всех типов actions + severities

### Agents

- `action-center-engineer` (NEW, opus) — owns the engine, detectors, schemas
- `prisma-schema-owner` — Action model + indexes + migration
- `notifications-engineer` — BullMQ scheduler hooks (action-recompute)
- `reception-dashboard-specialist` — daily briefing module
- `api-builder` — REST endpoints `/api/crm/actions`
- `realtime-engineer` — `action.created/updated` SSE events for live update
- `i18n-specialist` — translations
- `test-engineer`, `code-reviewer`, `security-reviewer`

### Gate

- 10 detector types impl + unit tests на edge cases
- На seeded prod (270 demo patients) система генерирует ≥30 actions
- E2E: receptionist видит briefing → кликает «empty slot tomorrow» → создаёт reactivation campaign → action автоматически done
- SSE: создание action → live появление в briefing у всех залогиненных RECEPTIONIST

---

## Фаза 14 — Revenue Engines (2 sprints)

**Цель.** Считать упущенную выручку и предлагать конкретные действия по её восстановлению. Без этого Action Center — просто to-do list, с этим — revenue machine.

### Scope

- **Empty Slot Engine** (`src/server/revenue/empty-slot.ts`):
  - Для каждого doctor × day подсчитать `(workSlots - bookedSlots) × averagePrice(doctor.specialty)` — упущенная выручка
  - Identify top empty slots на след. 7 дней (peak hours)
  - Suggest fill: список dormant patients чья история подходит под этого врача
  - Trigger `EMPTY_SLOT_TOMORROW` action
- **Reactivation Engine** (`src/server/revenue/reactivation.ts`):
  - Identify dormant: `lastVisit > 90d` (configurable per clinic) AND no future appointment AND no recent campaign send
  - Segments: `90-180d` / `180-365d` / `>365d` — разные шаблоны и каналы
  - Auto-trigger `PATIENT_INACTIVE_DAYS` notification with idempotency (1x per quarter per patient max)
  - Conversion tracking: dormant → reactivated counter в Analytics
- **No-Show Risk v2** (extends `src/lib/ai/no-show-risk.ts`):
  - **Factor breakdown**: вернуть `{ historyRisk, firstVisitBump, unconfirmedBump, farFutureBump, weatherBump?, dayOfWeekBump? }` — а не только скаляр
  - UI: на карточке appointment tooltip показывает разбивку
  - Confidence score (sample size aware)
- **Loss Analytics dashboard** (`/crm/analytics/loss`):
  - 4 источника loss: no-show, last-min cancel, dormant, empty slots
  - Сумма $$ по источникам / месяц
  - Trend chart (3-month rolling)
  - Drill-down: top contributors (which doctors / which patients / which days)
- **Revenue Forecast** (`/crm/analytics/forecast`):
  - Next 30d revenue projection: `existing bookings × (1 - avg_no_show) + reactivation pipeline × conversion_rate + walk-in baseline`
  - Confidence interval (low/mid/high)
  - "What if" sliders: «если поднять подтверждение до 90% — +X UZS»

### Deliverables

- 4 engine modules in `src/server/revenue/`
- Schema additions: `Patient.dormantSince`, `Patient.reactivationSentAt[]`, possibly `EmptySlotSnapshot` для аналитики истории
- `/crm/analytics/loss` page
- `/crm/analytics/forecast` page
- BullMQ jobs: `revenue-snapshot` daily, `reactivation-scheduler` daily
- Tests: pure engine logic + simulation scenarios

### Agents

- `revenue-engine-builder` (NEW, opus)
- `prisma-schema-owner` — schema
- `notifications-engineer` — reactivation campaigns + idempotency
- `analytics-builder` (NEW, opus) — Loss/Forecast UI (см. Phase 18 — этот агент будет создан раньше)
- `api-builder`
- `test-engineer`, `code-reviewer`

### Gate

- На seeded prod: Loss dashboard показывает реальные числа per source
- Reactivation engine на dry-run видит >50 dormant patients из 270 demo
- No-show risk tooltip показывает breakdown с разумными значениями
- E2E: «full reactivation» сценарий (пациент unmapped 95 дней → engine triggers → notification sent → если открыл — counter inc)

---

## Фаза 15 — AI Co-Pilot (2 sprints)

**Цель.** LLM в приложении в трёх точках, каждая экономит минуты в день. Не «AI everywhere», а целевые use cases.

### Архитектура

- **LLM proxy service** (`src/server/ai/llm.ts`): единая точка для всех LLM вызовов с:
  - PII redaction (имена, телефоны → `<NAME_1>`, `<PHONE_1>`)
  - Provider abstraction (OpenAI / Anthropic / local Ollama)
  - Rate limiting per clinic
  - Cost tracking (tokens used → `LLMUsage` table)
  - Cache identical prompts (Redis, 1h TTL)
- **Audit**: каждый LLM call → `AuditLog.action = 'LLM_CALL'` с prompt hash + redacted version

### Use cases

#### 15.1 — In-app NL Command Bar (Cmd+K → ask)

`/crm/*` cmdk panel получает второй режим — natural language: "найди пустое окно у невролога завтра после обеда".
- Backend: tool-calling agent с инструментами `findFreeSlots(doctor, date)`, `findPatient(query)`, `getAppointmentsToday()`, `searchActions()`
- UI: chat-style ответ с встроенными action chips (например «забронировать слот»)
- Scope: read-only вначале (search/lookup); booking — после доверия

#### 15.2 — Patient summary auto-gen

Перед appointment карточка доктора показывает auto-generated summary:
> *Сальвадор Гомез, 34, постоянный пациент с 2024. Последний визит — 12.04, диагноз: мигрень. Назначен Trizolinum, jaune effect noted. Жаловался на headaches возвращаются.*

- Trigger: при открытии appointment или patient card — async LLM call суммаризирует MedicalCase + last 3 visits notes
- Cache: `Patient.summaryCache` + `summaryCacheUpdatedAt`, invalidate при new visit

#### 15.3 — Voice → SOAP for doctors

- Doctor sends voice message в TG к боту во время / после визита
- Worker: Whisper transcribe → LLM structures into SOAP (Subjective / Objective / Assessment / Plan)
- Saved as `MedicalCase.soapDraft`, doctor edits в CRM
- Privacy: voice file deleted after transcribe; transcript stored only

#### 15.4 — TG Conversational Booking

- Existing TG bot is wizard-driven. Add LLM intent layer:
  - User: "хочу к неврологу в среду после обеда"
  - LLM: extract `{ specialty: 'neurology', preferredDate: 'wed', preferredTime: 'afternoon' }`
  - Call `findFreeSlots` → propose 3 options as inline buttons
  - User: clicks → existing wizard takes over for confirmation
- Fallback to wizard на любой ambiguity

#### 15.5 — Marketing copy generator

- Admin: «напиши reactivation message для dormant patients русский, 200 chars, с promo 20% off»
- LLM produces 3 variants → admin picks → save as NotificationTemplate variant

### Deliverables

- `src/server/ai/llm.ts` — proxy service
- `src/server/ai/redact.ts` — PII redaction
- `src/server/ai/tools/*.ts` — tool definitions (slot search, patient search, etc.)
- Schema: `LLMUsage` table; `Patient.summaryCache`; `MedicalCase.soapDraft`
- Cmdk extension в `/crm/*` layout
- TG webhook intent layer
- Voice→SOAP worker
- Marketing copy UI on `/crm/notifications/templates/new`
- Tests: redaction unit tests; tool-call integration; mock LLM provider

### Agents

- `ai-copilot-engineer` (NEW, opus)
- `telegram-bot-developer` — intent layer
- `notifications-engineer` — marketing copy UI hooks
- `prisma-schema-owner` — LLMUsage + summaryCache fields
- `security-reviewer` — PII redaction audit (gate before merge)
- `test-engineer`

### Gate

- PII redaction: 100% recall on имена/телефоны in test corpus (provided patient names, phone formats UZ +998)
- LLM cost tracking: `LLMUsage` log per call
- E2E: TG NL booking flow happy path
- Voice→SOAP: 5 sample voice notes → SOAP draft created
- Cost ceiling per clinic configurable (Plan field)

---

## Фаза 16 — Patient Experience (1 sprint)

**Цель.** Mini App становится daily-use поверхностью, а не одноразовым «забронировал → закрыл». Каждый юзкейс ниже — повышает retention пациента, что напрямую повышает LTV.

### Scope

- **Treatment plan view**: если у пациента активный `MedicalCase` с repeat visits — показать прогресс (3/5 visits done, next due 12.05).
- **Pre-visit questionnaire**: за 24ч до appointment — push в Mini App «Заполни анкету (5 минут)»: жалобы, аллергии, текущие препараты. Doctor видит ответы в карточке записи.
- **Post-visit NPS**: через 4ч после `COMPLETED` — push «Как прошёл визит? 1-10 + комментарий». Сохраняется в `Review` модели; <7 — alert админу.
- **Family accounts**: в Mini App кнопка «Добавить ребёнка/родственника». Один TG аккаунт → N patients linked. Booking от лица любого.
- **Medication reminders**: если doctor в SOAP отметил `prescriptions[]` — Mini App ставит локальные напоминания (через TG bot push) в указанные дни/времена. Опционально: пациент отмечает «принял».
- **Refer-a-friend**: кнопка «Рекомендуй врача» — генерирует unique link `?ref=<patientId>`. Reception видит источник в Lead.source = 'REFERRAL'. Reward: первый визит referred friend → -15% on referrer's next visit (admin-configurable).

### Deliverables

- 6 новых страниц/секций в Mini App
- Schema: `Review`, `PatientFamily`, `Prescription`, `ReferralCode`
- Worker: `pre-visit-questionnaire-scheduler`, `post-visit-nps-scheduler`, `medication-reminder`
- TG bot routes для NPS reply / questionnaire reply
- Lead.source = 'REFERRAL' integration
- Admin UI on `/crm/settings/clinic`: configure NPS threshold, referral reward %

### Agents

- `patient-experience-engineer` (NEW, opus)
- `telegram-miniapp-builder` — Mini App pages
- `telegram-bot-developer` — push + NPS reply handling
- `notifications-engineer` — reminder workers
- `prisma-schema-owner` — schemas

### Gate

- E2E: пациент из demo seed получает pre-visit questionnaire push → отвечает → doctor видит → completes → пациент получает NPS push → отвечает 8/10
- Family: 1 TG account создаёт 2 patients → видит 2 records в Mini App, бронирует на каждого
- Referral: linked friend книжит → original patient получает скидку

---

## Фаза 17 — Compliance & Trust (1 sprint)

**Цель.** Сделать продукт продаваемым крупным клиникам и hospital chains. Без 2FA, granular PHI audit, data export — серьёзный клиент не подпишет contract.

### Scope

- **2FA mandatory for ADMIN/SUPER_ADMIN**: TOTP setup на первом логине после rollout. Recovery codes. Configurable enforcement per clinic для остальных ролей (Plan-gated).
- **Granular PHI audit** (`PatientView` log): кто открывал чью карточку когда. UI на `/crm/settings/audit?type=patient-view&patientId=...` (visible to ADMIN). Required field for compliance.
- **Session security**:
  - Idle timeout (configurable, default 30 min)
  - Forced re-login after 8h
  - Concurrent session limit per user (kick old sessions on new login)
  - Audit `SESSION_TIMEOUT`, `FORCED_LOGOUT`, `CONCURRENT_KICK`
- **Data export (patient request)**:
  - Endpoint: `POST /api/crm/patients/:id/data-export-request` → ADMIN approval queue
  - Worker generates ZIP: profile + visits + medical cases + payments + documents + communications
  - Encrypted with one-time password (delivered via TG)
  - Audit: `PATIENT_DATA_EXPORTED`
- **Data deletion (patient request)**:
  - Soft delete by default (status=DELETED, hidden from UI, kept for compliance window)
  - Hard delete after 90 days OR on admin override
  - Cascade: anonymize references (visits keep aggregate stats but PII stripped)
  - Audit: `PATIENT_DELETED`, `PATIENT_HARD_DELETED`
- **Encryption review**:
  - Audit: какие поля действительно sensitive (паспорт, диагноз) — encrypt at rest via Postgres pgcrypto
  - Document key rotation procedure
- **Backup verification**:
  - Daily backup to S3-compatible (existing MinIO can do its own snapshot)
  - Weekly restore drill (automated): restore to staging DB, verify checksums

### Deliverables

- 2FA setup flow в `/login` + `/crm/me/security`
- `PatientView` model + middleware that logs every patient page view
- Session timeout middleware
- Data export worker + UI (ADMIN side)
- Data deletion flow (request → approve → soft delete → 90d hard delete cron)
- pgcrypto integration for sensitive fields
- Backup scripts + restore drill in CI

### Agents

- `compliance-engineer` (NEW, opus)
- `security-reviewer` — gate-keeper, must approve before merge
- `prisma-schema-owner` — encryption fields, PatientView, deletion cascades
- `infrastructure-engineer` — backup drill, session storage in Redis
- `multitenant-specialist` — session middleware + view audit
- `i18n-specialist` — recovery flow / 2FA setup translations

### Gate

- 2FA: ADMIN не может войти без 2FA после rollout (test with new admin account)
- PHI audit: открытие карточки пациента → запись в PatientView видна на /crm/settings/audit
- Data export e2e: request → approve → ZIP generated → password delivered → ZIP unlocks → contains expected sections
- Restore drill: weekly CI job restores yesterday's backup → verifies row count matches

---

## Фаза 18 — Analytics & Reporting (1 sprint)

**Цель.** Директор видит весь бизнес одним кликом и может построить произвольный отчёт без инженера. Закрывает «9/10 internal CRM» полностью.

### Scope

- **Custom Report Builder** (`/crm/analytics/reports/new`):
  - UI: drag dimensions (date / doctor / branch / specialty / patient segment / source) + measures (count visits / revenue / no-show rate / avg ticket / LTV)
  - Filters (date range, status, branch)
  - Save report → reuse, schedule (weekly email / TG)
  - Export CSV / PDF
- **Cohort analysis**: `/crm/analytics/cohorts`:
  - X-axis = month-of-first-visit
  - Y-axis = retention % at month N (or revenue per cohort)
  - Heatmap visualization
- **Doctor performance scoreboard** (`/crm/analytics/doctors`):
  - Per doctor: visits / revenue / NPS avg / no-show rate / repeat visit % / new vs returning ratio
  - Ranked table + trend lines
  - Comparison: top vs bottom 25%
- **Real-time financial dashboard** (`/crm/analytics/financial`):
  - Today: revenue collected, revenue scheduled, no-show losses
  - This month: ARR pace, projected vs target
  - Forecast next 30d (re-uses Phase 14 forecast)
- **Doctor schedule heatmap**: загрузка по часам / дням, чтобы директор видел недо/перегруз

### Deliverables

- Report Builder page + saved-reports model
- 3 pre-built dashboards (Cohort, Doctor Performance, Financial)
- Scheduled-report worker (BullMQ)
- Aggregation views в Postgres (materialized views for heavy queries)
- CSV/PDF export

### Agents

- `analytics-builder` (NEW, opus) — может создать раньше для Phase 14
- `prisma-schema-owner` — materialized views, indexes
- `api-builder` — aggregation endpoints
- `notifications-engineer` — scheduled report delivery
- `performance-optimizer` — query optimization (indexes, mv refresh policy)

### Gate

- Report Builder: создать отчёт «выручка по неврологам за апрель», сохранить, расписать на email каждый понедельник
- Cohort heatmap: данные seed-prod показывают cohorts из 270 demo patients
- Financial dashboard <500ms p95 на seeded prod

---

## Фаза 19 — SaaS Self-Service (1 sprint)

**Цель.** Новая клиника регистрируется сама за <30 минут без участия SUPER_ADMIN. Plan upgrade self-service. White-label для крупных клиентов.

### Scope

- **Self-signup**: публичный landing → email/phone → email confirm → choose plan (Free/Starter/Pro) → auto-create Clinic + ADMIN user → onboarding playbook (см. ниже).
- **Onboarding playbooks**: при создании клиники — выбор шаблона (general / dental / neurology / pediatric / cosmetology). Playbook = pre-seeded services, doctors-template, notifications-templates, schedule-defaults. Скип-able (start blank).
- **Self-service billing** (Stripe-style):
  - `/crm/settings/billing`: current plan, usage (patients / appointments / TG notifications sent), upgrade button (SMS counter retired Q2 2026, см. `TZ-sms-removal.md`)
  - Plan limits enforced (см. Phase 9b — есть Plan/Subscription, нужно добавить enforcement gates)
  - Payment via Click/Payme (UZ) integration или manual invoice
  - Invoice history + PDF
- **White-label settings** (`/crm/settings/branding`, Pro plan only):
  - Logo upload
  - Brand colors (primary)
  - Custom subdomain (clinic.yourdomain.uz) — DNS provisioning task
  - Custom email sender (DKIM setup task)
- **SUPER_ADMIN support tools**:
  - Impersonate clinic ADMIN (with audit `SUPER_ADMIN_IMPERSONATE`)
  - View as: shadow login that shows what user sees, no write
  - Bulk clinic operations (suspend / extend trial)
- **Plan limit enforcement**:
  - Soft warning at 80%
  - Hard block at 100% (для Free plan)
  - Upgrade prompt UI

### Deliverables

- Public signup flow `/signup` + email confirmation
- Playbook templates (5 шт): yaml/json definitions + apply-script
- Billing page + Stripe-style usage display
- Click/Payme integration (LogOnly first)
- White-label CSS variables system
- Subdomain provisioning runbook (manual для start, automate later)
- SUPER_ADMIN impersonation tool

### Agents

- `saas-onboarding-engineer` (NEW, opus)
- `admin-platform-builder` — SUPER_ADMIN tools
- `multitenant-specialist` — clinic provisioning, subdomain routing
- `prisma-schema-owner` — Plan/Subscription enforcement, Invoice model
- `infrastructure-engineer` — DNS / DKIM runbook
- `i18n-specialist` — signup + onboarding RU/UZ
- `security-reviewer` — impersonation audit

### Gate

- Self-signup e2e: новый пользователь создаёт clinic за <10 кликов
- Onboarding playbook: «neurology» → seeded clinic с 5 services, 3 doctor slots, 12 templates
- Plan limit: Free clinic с 50 пациентов → 51-й блокирует с upgrade CTA
- Impersonation: SUPER_ADMIN заходит «как» ADMIN clinic X → видит данные X → audit log записан

---

## Cross-cutting

### После каждой фазы

`security-reviewer`, `test-engineer`, `a11y-engineer`, `i18n-specialist`, `performance-optimizer`, `ux-polisher`, `code-reviewer`, `docs-writer`. Если что-то отвалилось — фаза не закрыта.

### Phase exit checklist (каждая)

- [ ] `npm run build` exit 0
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` green
- [ ] `npx playwright test` happy-path green
- [ ] i18n RU + UZ для всех новых строк
- [ ] AuditLog для destructive operations
- [ ] Feature flag в Plan model если фича tier-restricted
- [ ] `docs/progress/LOG.md` updated
- [ ] git tag `phase-N-done`

### ADRs

Любое решение, расходящееся с TZ.md или меняющее cross-cutting контракты, → новый ADR в `docs/adr/NNNN-title.md`. Структура ADR: Context / Decision / Consequences / Alternatives. Создать `docs/adr/` при первой записи.

---

## Параллелизм / порядок

Зависимости между фазами:

```
11 → 12 → 13 → 14 → 18
                ↓
        15 (parallel after 13)
        16 (parallel after 12)
        17 (parallel after 11)
        19 (after 17 — нужны billing + multi-clinic enforcement)
```

Можно параллелить треки 13/15/16/17 если будет 2+ devs. Соло — последовательно как в таблице TL;DR.

---

## Что НЕ делаем (deliberate exclusions)

- **Native mobile app для пациентов** — Mini App покрывает 95% need в Узбекистане где TG доминирует. Native рассмотрим после 1000+ active patients.
- **Полная HL7/FHIR интеграция** — overkill пока нет partner clinics требующих. Плоский PDF export + structured JSON хватает.
- **Insurance integration** — Uzbekistan медстраховой рынок незрелый. Через 1-2 года.
- **Marketplace для clinics (find-a-doctor)** — это другой продукт, отдельный roadmap.
- **AI diagnosis suggestion** — regulated territory, не MVP. Voice→SOAP — это note-taking, не diagnosis.

---

## История изменений

- **2026-05-06** — initial 11/10 roadmap (фазы 11-19) после ревью кодовой базы и GPT-аудита.
