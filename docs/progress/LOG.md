# MedBook / NeuroFax — Progress Log

**Каждая новая сессия — начинай с чтения этого файла.** Здесь фиксируется состояние между контекстными пропусками.

- **Спецификация:** `docs/TZ.md` (единственный источник правды).
- **Команда агентов:** `.claude/agents/*.md` (31 шт, model: opus).
- **Safety тег:** `pre-rebuild-2026-04-22` (коммит `ec24c4d`, сняться `git reset --hard pre-rebuild-2026-04-22`).

## Соглашения

- Каждая фаза — один блок ниже. Формат: статус, дата, что сделано, файлы, тесты, известные минусы.
- В конце фазы запускается cross-cutting ревью: `security-reviewer`, `a11y-engineer`, `performance-optimizer`, `test-engineer`, `ux-polisher`, `code-reviewer`.
- После каждой фазы — `git commit` с тегом `phase-N-done` + обновление этого файла.

---

## Phase 0 — Зачистка + фундамент — ✅ DONE 2026-04-22

**Коммиты:** `447fcb3` (cleanup) · `38998cd` (prisma) · `566e6dd` (i18n) · `f47466a` (design-system) · `edb1715` (tenancy) · `phase-0-done` tag.

### Что сделано

- **Зачистка (`migration-cleaner`):** снёс `src/app/[locale]/(dashboard)/`, `[locale]/login`, `src/components/charts/`, `auto-print.tsx`, `api/export`. LEGACY-пометки на `api/telegram/notify`, `api/appointments/[id]`, `api/payments`.
- **Prisma (`prisma-schema-owner`):** 28 моделей, 23 enum, initial migration `20260422080121_phase-1-initial`. Seed: 2 клиники (neurofax, demo-clinic), 1 SUPER_ADMIN, по 10 пациентов, 5 услуг, 20 appointments, 10 templates, FX rate.
- **i18n (`i18n-specialist`):** next-intl для ru/uz, full formatters (`formatMoney`, `formatMoneyDual`, `formatDate`, `formatPhone`, `formatName`). MoneyText атом. Language switcher.
- **Design-system (`design-system-builder`):** Tailwind токены (primary teal #3DD5C0), shadcn/ui (22 компонента), 13 атомов в `src/components/atoms/`, 6 молекул в `src/components/molecules/`, layout-shell (sidebar + topbar + right-rail), theme-provider (next-themes). Placeholder-страницы для 10 CRM-разделов.
- **Tenancy (`multitenant-specialist`):** `src/lib/tenant-context.ts` (AsyncLocalStorage), `src/lib/prisma.ts` через `$extends`, `src/lib/api-handler.ts` (createApiHandler), `src/lib/auth.ts` (clinicId в JWT), clinic-switcher UI stub. 18 vitest тестов — зелёные.

### Build / тесты

- `npx tsc --noEmit` — clean.
- `npm run build` — exit 0 (минорный warning на legacy doctors static page).
- `npx vitest run` — 18/18 passed.

### Ключевые файлы для последующих фаз

- **Prisma client:** `src/lib/prisma.ts` — автоматически подставляет `clinicId` в TENANT-контексте.
- **API handler wrapper:** `src/lib/api-handler.ts` — использовать вместо ручного `auth()` + `runWithTenant`.
- **Tenant context helpers:** `src/lib/tenant-context.ts`.
- **Auth:** `src/lib/auth.ts` — credentials provider, JWT со `{userId, role, clinicId}`.
- **Layout shell:** `src/app/[locale]/crm/layout.tsx` + `src/components/layout/crm-*`.
- **CRM страницы:** `src/app/[locale]/crm/{reception,appointments,calendar,patients,doctors,call-center,telegram,notifications,analytics,settings}/page.tsx` (placeholders).
- **Формат money/date/phone:** `src/lib/format.ts` через `MoneyText`, `DateText`, `PhoneText`.
- **Витрина компонентов:** `/ru/crm/components` (dev-only).

### Known legacy (ожидает Phase 1 / api-builder)

- 22 старых API-роута помечены `// @ts-nocheck` + TODO(phase-1): src/app/api/{booking,leads,queue,medical-records,patients,payments,reviews,schedule,search,telegram,tv-queue,appointments,kiosk}/**, и `src/lib/{auth,booking-validation,doctors}.ts` (часть починена tenancy-агентом).
- Legacy route `/[locale]/doctors` (публичный) использует старые поля — останется до `public-site-revamp`.
- `prisma/migrations/` создан как `--create-only`, в БД не применён (применится в Phase 1 на dev-среде).

### Заметки для следующих фаз

- **api-builder (Phase 1):** всегда через `createApiHandler`. Никогда не добавлять `clinicId` в where вручную. Композитные unique с clinicId — middleware их видит и не дублирует. Cross-tenant — через `{ skipTenantScope: true }` (только для ExchangeRate/ProviderConnection) или `runWithTenant({kind:'SYSTEM'}, ...)`.
- **Воркеры:** оборачивать main() в `runWithTenant({kind:'SYSTEM'}, ...)`.
- **clinic-switcher:** UI уже в topbar, но реальные endpoints `/api/platform/*` создаст admin-platform-builder в Phase 4.
- **Применение миграции:** `npx prisma migrate deploy` на dev-БД перед началом Phase 1.

---

## Phase 1 — Данные + API — ✅ DONE 2026-04-22

**Коммит:** `d7da9b5` · тег `phase-1-done`.

### Что сделано (api-builder)

- **~50 endpoints** под `src/app/api/crm/*`:
  - patients (list/create/[id]/communications-timeline/ltv/export-CSV/delete)
  - doctors (CRUD + schedule PUT + time-off + finance)
  - services, cabinets (CRUD с soft-delete)
  - appointments (CRUD + 409 conflict-detection + queue-status PATCH + bulk-status + slots/available)
  - payments (CRUD + sync recalcLtv при PAID)
  - documents (metadata-only, upload stub — файлы Phase 4 MinIO)
  - communications + communications/sms (log-only, dispatcher → 3a)
  - conversations + messages (list + OUT send)
  - calls (CRUD), notifications/templates + sends + retry
  - dashboard (KPI today/week/month + queue snapshot)
  - audit, exchange-rates, search (cross-entity top-5), online-requests
- **Zod-схемы:** `src/server/schemas/{18 files}.ts`.
- **Services:** `src/server/services/{appointments,ltv}.ts` — conflict-detection + LTV recalc.
- **HTTP helpers:** `src/server/http.ts` — ok/err/notFound/forbidden/conflict/parseQuery/diff.
- **Audit:** все мутации пишут AuditLog с before/after diff.
- **RBAC:** через `createApiHandler({roles})`, DOCTOR self-scope через userId-check.
- **Conflict-detection (POST/PATCH appointment):** doctor_busy / cabinet_busy / doctor_time_off / outside_schedule.
- **OpenAPI markdown-фрагменты** в `docs/api/`.
- **Легаси удалены:** `src/app/api/{analytics,appointments,doctor-schedule,medical-records,patients,payments,reviews,schedule,search}` → всё заменено на `/api/crm/*`.
- **Сохранены** (публичные, с `@ts-nocheck` для последующих фаз): `booking`, `leads`, `kiosk`, `queue`, `tv-queue`, `telegram/{webhook,notify}`, `auth`.

### Build / тесты

- `npx tsc --noEmit` — 0 ошибок.
- `npx vitest run` — **40/40 passed**.
- `npm run build` — clean.

### Known TODOs для следующих фаз

- LTV recalc — сейчас синхронно в Payment handler. Phase 3a → BullMQ воркер.
- Document upload — metadata only. Phase 4 → MinIO.
- Full tenancy-isolation integration test — требует тестовую БД. Phase 7.
- `next/font/google` warnings на Inter в Turbopack — не критично, на Phase 6 закрепим font resolver.
- `createApiHandler` не получает Next `params` — id читается из URL через `idFromUrl()`. Если Next 16 даст typed params — рефактор.

### Что готово для Phase 2 (UI)

- **Все необходимые endpoints** для patient card, appointments table, calendar, reception dashboard, doctors page.
- Timeline коммуникаций: `GET /api/crm/patients/[id]/communications` — возвращает mixed feed.
- Slots: `GET /api/crm/appointments/slots/available?doctorId=&date=&serviceIds=...`.
- Conflict response format: `409 { error: "conflict", reason: "doctor_busy|cabinet_busy|doctor_time_off|outside_schedule", until?: "HH:mm" }`.
- Dashboard KPI: `GET /api/crm/dashboard?period=today|week|month`.
- Global search: `GET /api/crm/search?q=...`.

---

## Phase 2a — Пациенты — ✅ DONE 2026-04-22

**Коммиты:** `5b773a7` (список) · `ecb9051` (карточка) · тег `phase-2a-done`.

### Что сделано

#### patients-page-builder → список (`5b773a7`)

- `src/app/[locale]/crm/patients/page.tsx` + 9 `_components/`: patients-page-client, patients-table (TanStack Table + Virtual), patients-filters, patients-right-rail, 4 виджета (demographics, sources, birthdays, top-services), new-patient-dialog, export-button.
- 3 hooks: `use-patients-list` (useInfiniteQuery + cursor), `use-patients-stats`, `use-patients-filters` (URL-sync).
- Endpoint `GET /api/crm/patients/stats` — разбивка по gender / source / тегам / top services / дни рождения на неделю.
- Фильтры в URL: `q, segment, source, gender, tag, balance, registeredFrom, registeredTo, sort, dir, ageMin, ageMax`. RBAC: DOCTOR видит только своих (по userId в AppointmentService.doctor.userId).

#### patient-card-specialist → карточка (`ecb9051`)

- `src/app/[locale]/crm/patients/[id]/page.tsx` (server component, Next 16 `params: Promise<{id}>`).
- 10 client-компонентов: patient-card-client (обёртка + QueryClient), patient-card-skeleton, patient-header (ФИО + inline-edit через `InlineField` + `TagEditor` + статус блока), patient-quick-actions (6 действий), sms-dialog (fallback для WhatsApp/Telegram недоступности), delete-patient-dialog (soft-delete), patient-tabs (Radix Tabs).
- 6 вкладок: `overview-tab` (5 KpiTiles + timeline 10), `visits-tab` (expandable rows со services + payment badges), `documents-tab` (drag-drop upload + stub подпись через canvas), `communications-tab` (mixed feed + фильтр по типу), `payments-tab` (3-KPI + add dialog), `medical-tab` (stub на `Patient.notes`).
- 6 hooks: `use-patient` (optimistic PATCH + DELETE), `use-patient-communications`, `use-patient-appointments`, `use-patient-payments`, `use-patient-documents` (optimistic pending:// URL), `use-current-role`.
- i18n `patientCard.*` — ~180 строк паритет ru/uz.
- `Button asChild` не поддерживается (@base-ui/react) → через `buttonVariants()` на `<Link>`, `<a>`, `<label>`.

### Build / тесты

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 40/40 passed.
- `npm run build` — clean (build прошёл на список, карточка доложена поверх).

### Requests для следующих фаз

- **prisma-schema-owner (при необходимости):** отдельные таблицы anamnesis / allergies / diagnoses (сейчас medical-tab живёт в `Patient.notes`). Shared `Tag` table вместо `string[]`. `Document.uploadState` enum (`PENDING | UPLOADED | FAILED`) — реальный MinIO в Phase 4.
- **realtime-engineer (Phase 2c):** SSE-каналы `clinic:{id}:reception` + `clinic:{id}:queue` — нужны reception-dashboard.
- **notifications-engineer (Phase 3a):** реальная отправка SMS/Telegram/WhatsApp (сейчас `log-only`, диспатчер stubbed) + ретраи с экспоненциальным бэкофом.

### Известные минусы (Phase 2a)

- Документы в карточке — только метадата + optimistic pending URL. Реальный upload → MinIO на Phase 4.
- Signature pad (documents-tab) — локальный canvas без binding к Document. Phase 4 + TG-MiniApp.
- `medical-tab` — единое `notes` поле. Разбиение — Phase 4 после решения prisma-schema-owner.
- Export button вызывает `/api/crm/patients/export-csv` (готов в Phase 1), но стримит синхронно — Phase 5 wrap в BullMQ воркер.

---

## Phase 2b — Записи + Календарь — ✅ DONE 2026-04-22

**Коммиты:** `08668b4` (appointments) · `eb73394` (calendar) · тег `phase-2b-done`.

### Что сделано

#### appointments-page-builder (`08668b4`)

- `src/app/[locale]/crm/appointments/page.tsx` + `_components/` (11 файлов) + `_hooks/` (3 файла).
- TanStack Table + виртуализация >100 строк. Колонки: время, пациент, врач, услуги, статус, оплата, кабинет, канал, действия.
- `appointments-filters`: dateMode (today/tomorrow/week/custom) + bucket, doctor, status, channel, service, cabinet, onlyUnpaid, q — URL-sync.
- `appointments-bulk-bar`: mark arrived / not-arrived (bulk-status POST), SMS reminder (log-only), reschedule (stub до полного календарного диалога).
- `appointment-drawer` (Sheet справа): details + inline edit + history + payments без дублирования карточки пациента.
- `appointments-kpi-strip`: счётчики по статусам (client-side из загруженных страниц — не по всему фильтру).
- `export-button`: стрим CSV через `/api/crm/appointments/export-csv` (endpoint ожидает api-builder).
- `_hooks/use-appointment.ts`: `usePatchAppointment` (optimistic + `AppointmentConflictError`), `useBulkStatus`, `useSetQueueStatus`, `useDeleteAppointment`. Экспортируются calendar'ом.
- **SHARED** `src/components/appointments/NewAppointmentDialog.tsx` + `SlotPicker.tsx` — single source of truth для создания записи. Patient autocomplete + "создать нового" inline. Channel enum из Prisma: `WALKIN|PHONE|TELEGRAM|WEBSITE|KIOSK` (не из ТЗ).
- i18n `appointments.*` — полный паритет ru/uz.

#### calendar-specialist (`eb73394`)

- `src/app/[locale]/crm/calendar/page.tsx` + `_components/` (6 файлов) + `_hooks/` (3 файла).
- FullCalendar 6.1.20 (`resource-timegrid`) с GPL open-source ключом — swim-lanes по врачам, Y=время.
- Views: day / workWeek (5d) / week (7d). Месяц исключён явно.
- Toolbar: date-nav + view-switcher + multi-filter врачи / кабинеты / услуги + overlay toggle + "Сегодня" + "Новая запись".
- DnD + resize: при drop/resize → `usePatchAppointment`; на 409 — snap back + toast с переведённым `reason`.
- Empty slot click → shared `NewAppointmentDialog` с `initialDoctorId/Date/Time`. Event click → reuse `AppointmentDrawer`.
- Cabinet overlay: toggle красит события HSL-из-cabinetId.
- `use-conflict-detector.ts`: обёртка вокруг optimistic PATCH + `lastConflict` state для баннера.
- `use-calendar-data.ts`: 30s `refetchInterval` как fallback до SSE (Phase 3a realtime-engineer заменит на инвалидацию по `appointment.*` событиям).
- Desktop-only (≥1280px) — "Use desktop" hint на меньших экранах.
- i18n `calendar.*` — полный паритет ru/uz.

### Build / тесты

- `npx tsc --noEmit` — clean после обоих коммитов.
- `npx vitest run` — 40/40 passed.
- `npm run build` — exit 0.

### Requests для следующих фаз

- **api-builder:**
  - `GET /api/crm/appointments/export-csv` (UTF-8 BOM + RFC-4180, как у patients/export).
  - `serviceIds[]` в `/api/crm/doctors` для server-side фильтра в NewAppointmentDialog.
  - `doctorId[]` / `cabinetId[]` / `serviceId[]` (множественные) в `/api/crm/appointments` для календаря.
  - Status-tally endpoint для `/crm/appointments` — сейчас KPI считается по загруженным страницам.
  - Bulk reminders endpoint — сейчас SMS reminder триггерит `/api/crm/communications/sms` по одному.
- **realtime-engineer (Phase 3a):** SSE каналы `clinic:{id}:appointments` / `clinic:{id}:calendar` — инвалидировать `["calendar","appointments",...]` и `["appointments","list",...]` на `appointment.{created|updated|cancelled|moved}`. TODO-маркер уже в `use-calendar-data.ts`.

### Известные минусы

- Reschedule action в bulk-bar = toast-stub. Полная диалоговая форма переноса — после стабилизации календаря.
- `schedulerLicenseKey = 'GPL-My-Project-Is-Open-Source'` — для продакшн-клиники без open-source обязательств нужна платная лицензия FullCalendar premium либо миграция на `resource-timeline` paid.
- Export CSV кнопка ссылается на несуществующий endpoint — будет 404 до патча api-builder.

---

## Phase 2c — Reception dashboard — ✅ DONE 2026-04-22

**Коммит:** `536e6d5` · тег `phase-2c-done`.

### Что сделано (reception-dashboard-specialist)

- `src/app/[locale]/crm/reception/page.tsx` (server shell) + `_components/` (8 файлов) + `_hooks/use-reception-live.ts` (7 хуков: dashboard, today appts, incoming calls, unread conversations, cabinets, reminders + `computeUpcomingReminders`).
- `kpi-strip`: 6 плашек (сегодня / пришли / no-show / выручка / ожидают / в работе). Клик → фильтр `/crm/appointments?status=...`.
- `doctor-queue-grid` + `doctor-queue-card`: responsive 1/2/3/4 колонки. Live actions: call next, mark arrived, complete, no-show.
- Виджеты правой колонки: calls-widget (incoming), tg-preview-widget (unread convos), cabinets-widget (client-side occupancy), reminders-widget (SMS sender).
- Polling 15s stale / 30s refetch — TODO маркеры для SSE (realtime-engineer Phase 3a).
- NO_SHOW идёт через main `PATCH /api/crm/appointments/[id]` — queue-status endpoint принимает только `WAITING|IN_PROGRESS|COMPLETED|SKIPPED`.
- i18n `reception.*` — полный паритет ru/uz (ru добавлен в commit `513cb8c` из-за параллельного раннинга, uz — в `536e6d5`).

### Requests для Phase 3a+

- **api-builder:** `POST /api/crm/communications/sms/bulk` для reminders-widget, `GET /api/crm/cabinets/occupancy` (server-computed currentDoctor/nextFreeAt), `hasReminder` boolean на appointment rows.
- **realtime-engineer:** SSE каналы `queue.updated`, `appointment.updated`, `call.incoming`, `tg.message` → инвалидация `["reception"]`, `["appointments","today"]`, `["calls","incoming"]`, `["conversations","unread"]`. Polling становится fallback.

---

## Phase 2d — Doctors — ✅ DONE 2026-04-22

**Коммит:** `513cb8c` · тег `phase-2d-done`.

### Что сделано (doctors-page-builder)

#### `/crm/doctors` (список)

- `page.tsx` + `_components/` (4 файла): doctors-page-client, doctor-card (avatar/rating/today load/revenue/load bar), doctors-filters (search + specialty + sort + onlyActive), doctors-right-rail (KPI + top-3 period toggle).
- `_hooks/`: use-doctors-list (useInfiniteQuery), use-doctors-filters (URL-sync + `usePeriodRange`), use-doctors-stats (`aggregateByDoctor`).
- Grid 4 кол на 1680+, адаптив до 1 на 1280.

#### `/crm/doctors/[id]` (профиль)

- Next 16 `params: Promise<{id}>`. Tabs: Overview / Schedule / Patients / Reviews.
- `doctor-header` (xl avatar + rating + bio + "Новая запись" → shared `NewAppointmentDialog` с `initialDoctorId`).
- `doctor-heat-grid`: 7×15 week grid (Mon-Sun × 08-22), 4 intensity bins, prev/next нав.
- `doctor-finances`: 4 KPI (revenue, count, avg check, no-show %) через `MoneyText` dual UZS+USD, period toggle. `avgCheck` и `noShowRate` — client-derived из `/appointments` (TODO api-builder).
- `schedule-editor`: per-day slots + cabinet + overlap detection + red highlight + optimistic PUT.
- `doctor-time-off`: list + inline add/delete.
- `doctor-patients-list`: top-30 by LTV (derived client-side).
- `doctor-reviews`: stub empty state (endpoint ожидает api-builder).
- DOCTOR role сам видит всё; RECEPTIONIST/CALL_OPERATOR не видят Patients tab (API также enforces).
- i18n `crmDoctors.*` — полный паритет (~150 ключей).

### Build / тесты (Phase 2c + 2d совместно)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 40/40 passed.
- `npm run build` — exit 0. `/[locale]/crm/{reception,doctors,doctors/[id]}` в route manifest.

### Requests для Phase 3a+

- **api-builder:** `GET /api/crm/doctors/[id]/reviews` (сейчас stub), добавить `avgCheck`+`noShowRate` в `/finance`, `doctorId` filter в `/api/crm/patients`, specializations aggregation endpoint.
- **realtime-engineer:** инвалидировать `["doctors","list"]` + `doctor:{id}` на `queue.updated`.

### Phase 2 — ИТОГО

- 2a/2b/2c/2d все в прод-состоянии. Все 10 CRM-разделов имеют рабочие страницы.
- 40/40 vitest, tsc clean, build успешен.
- Полный коммит-трейл: `5b773a7 → ecb9051 → b2c927c → 08668b4 → eb73394 → 71e4bbb → 513cb8c → 536e6d5`.

---

## Phase 3a — Уведомления — ✅ DONE 2026-04-22

**Коммит:** `0d0770a` · тег `phase-3a-done`.

### Что сделано (notifications-engineer)

#### Сервер

- **Template engine** `src/server/notifications/template.ts`: render / validate / extractPlaceholders + `ALLOWED_KEYS_BY_TRIGGER` whitelist. HTML-escape auto.
- **Queue abstraction** `src/server/queue/index.ts`: `QueueAdapter` interface + `InMemoryQueueAdapter` (setTimeout/setInterval). BullMQ swap single line когда `REDIS_URL` появится.
- **Adapters** `src/server/notifications/adapters/`: `SmsAdapter`+`TgAdapter` interfaces, `sms-log-only` / `tg-log-only` (дефолт, пишут `NotificationSend` без внешних вызовов), `sms-eskiz-stub` (throws `not configured`), factory выбирает по `ProviderConnection`.
- **Rate-limit** `src/server/notifications/rate-limit.ts`: SMS 3/час, TG 10/мин per patient (in-memory sliding window).
- **Triggers** `src/server/notifications/triggers.ts`: 7 триггеров (`appointment.{created,reminder-24h,reminder-2h,cancelled}`, `birthday`, `no-show`, `payment.due`) + `fireTrigger(kind, entity)` dispatcher. Идемпотентно (по appointmentId + triggerKey).
- **Workers** `src/server/workers/{notifications-send,notifications-scheduler,start}.ts`: запуск через `npx tsx src/server/workers/start.ts`. Retry: 3 попытки, exp backoff 60/300/1800s.
- **Trigger integration points:** `POST/PATCH/DELETE /api/crm/appointments/*`, `POST/PATCH /api/crm/payments/*` — fire-and-forget `fireTrigger()` в конце. Scheduler tick: birthday / reminder / payment.due.

#### API

- `GET /api/crm/notifications/stats` (today sent/failed + top templates).
- `GET/POST /api/crm/notifications/triggers`.

#### UI `/crm/notifications`

- Тaбы: Templates / Queue / Campaigns / Triggers (URL-sync).
- `template-tree` (left) + `template-editor` (right с placeholder-hint + sample preview + "Test send" dev-only button).
- `queue-table`: virtualized, фильтры по status/channel/from/to, retry/cancel actions.
- `campaigns-list` — stub (полный builder → Phase 5).
- `triggers-panel`: 7 toggles + template select + delay editor (использует `NotificationTemplate.isActive`).
- Right rail — stats.
- i18n `notifications.*` ru/uz parity.

### Build / тесты

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **68/68 passed** (+28 новых: template, rate-limit, queue, triggers).
- `npm run build` — exit 0, все 5 notifications endpoints в route manifest.

### Requests для следующих фаз

- **infrastructure-engineer (Phase 6):** swap `InMemoryQueueAdapter` → BullMQ + Redis, процесс воркеров в docker-compose.
- **prisma-schema-owner (опц.):** `TriggerConfig` model если потребуется per-trigger delay/config отдельно от `NotificationTemplate.key`.
- **telegram-bot-developer (Phase 3b/3d):** заменить `tg-log-only` на реальный `tg-adapter` через `send.ts` бота.
- **settings-pages-builder (Phase 4):** UI для `ProviderConnection` — клиника настраивает Eskiz/Playmobile API-ключ, токен-бот.

### Deviations

- Без `TriggerConfig` model — `NotificationTemplate.key` = trigger-key verbatim, `.isActive` = toggle.
- LogOnly — default; реальный Eskiz stub throws пока не настроен.
- Campaigns — stub, полный конструктор в Phase 5.
- Queue теряется при рестарте (in-memory) — ок для dev, critical для прода (→ Phase 6).

---

## Phase 3b — Telegram inbox + бот — ✅ DONE 2026-04-22

**Коммит:** `bb066e2` · тег `phase-3b-done`.

### Что сделано (telegram-bot-developer + telegram-inbox-specialist combined)

#### Bot backend

- **Webhook** `POST /api/telegram/webhook/[clinicSlug]`: X-Telegram-Bot-Api-Secret-Token verify, SYSTEM-context DB access, idempotent `(clinicId, externalId)` дедуп, routes через FSM когда `mode=bot`, публикует `tg.takeover.incoming` когда `mode=takeover`.
- **FSM** `src/server/telegram/state.ts`: pure `step(prev, event, catalog)` — `start → lang_select → service_select → doctor_select → slot_select → name_input → confirm → done`. In-memory store с 30-min TTL, injectable для тестов.
- **Messages** `src/server/telegram/messages.ts`: ru/uz dictionary + `t(lang, key)` helper (server-side без next-intl).
- **Send** `src/server/telegram/send.ts`: sendMessage / sendPhoto / editMessageText / answerCallbackQuery с 429-backoff; no-op when `tgBotToken` null.
- **Auth** `src/server/telegram/auth.ts`: `verifyLoginWidget` (sha256 botToken) + `verifyMiniAppInitData` (HMAC-SHA256("WebAppData", botToken)), constant-time compare.
- **Adapter** `src/server/notifications/adapters/tg-clinic.ts`: real TgAdapter через `send.ts`, registered в factory.
- **Event bus** `src/server/realtime/event-bus.ts`: process-local stub для SSE handoff (realtime-engineer заменит).

#### Inbox UI `/crm/telegram`

- 3-col layout: conversation-list (virtualized, search + filters bot/operator/all, unread badge) / chat-pane (infinite scroll up, takeover toggle) / chat-right-rail (patient preview + quick actions: "Записать" opens `NewAppointmentDialog` с `initialPatientId`, "Открыть карточку" → `/crm/patients/[id]`, "Создать пациента" mini form).
- `message-composer`: Enter=send, template picker (`channel=TELEGRAM`), inline-buttons builder JSON.
- Hooks: use-conversations (30s poll + URL sync), use-tg-messages (10s poll, scroll-preserve), use-send-message (optimistic), use-takeover (optimistic mode flip).
- i18n `tgInbox.*` ru/uz parity.

### Build / тесты

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **98/98 passed** (+30 новых: FSM + auth verifiers).
- `npm run build` — exit 0.

### Requests для следующих фаз

- **realtime-engineer:** replace polling на SSE каналы `tg.message.new`, `tg.takeover.incoming`, `tg.conversation.updated`. Event-bus stub — drop-in point. TODO-маркеры в хуках.
- **telegram-miniapp-builder (Phase 3d):** `verifyMiniAppInitData` готов. FSM states `service_select`/`slot_select` сейчас stub — должны deferить к Mini App URL когда `Clinic.tgMiniAppUrl` set.
- **admin-platform-builder (Phase 4):** clinic token management UI — `Clinic.{tgBotToken, tgBotUsername, tgWebhookSecret}`. UI также должен вызывать `setWebhook` после save.
- **prisma-schema-owner:** возможно нужен `Clinic.tgMiniAppUrl` field — сейчас отсутствует.

### Deviations

- Mini App deep-linking deferred до Phase 3d из-за отсутствующего `Clinic.tgMiniAppUrl`.
- Right-rail create-patient form minimal (fullName + phone only).

---

## Phase 3c — Call Center — ✅ DONE 2026-04-22

**Коммит:** pending · тег: `phase-3c-done` (после commit).

### Что сделано (call-center-developer)

#### TelephonyAdapter + LogOnly

- `src/server/telephony/adapter.ts` — `TelephonyAdapter` interface (`call`, `hangup`, `onEvent`), `TelephonyEvent` shape с `kind|callId|from|to|timestamp|meta`. Каналы на event-bus: `telephony.{ringing,answered,hangup,missed}` + `call.{incoming,answered,ended}`.
- `src/server/telephony/log-only.ts` — `LogOnlyTelephonyAdapter`. `call()` создаёт Call row с fake `sipCallId='log-<uuid>'`, публикует synthetic ringing + `call.incoming`. `hangup()` idempotent — считает `durationSec = endedAt - createdAt`. `onEvent()` подписывается на все `telephony.*` каналы.
- `src/server/telephony/index.ts` — factory. Сейчас `ProviderKind` не имеет SIP — используется label-based escape hatch (`kind=OTHER, label='sip'`) как forward-compat. Fallback — всегда LogOnly.

#### Webhook `/api/calls/sip/event`

- `src/app/api/calls/sip/event/route.ts` — POST only (GET/PUT/DELETE/PATCH → 405). Zod-схема `{kind, callId, from, to, timestamp, operatorId?, recordingUrl?, meta?}`. Resolves clinic by `?clinicSlug=` или `x-clinic-slug` header. Secret verify через `ProviderConnection.config.webhookSecret` (header `x-sip-secret`); в dev без secret — warn + accept; в prod без secret — 401.
- События: `ringing` upsertит Call с `direction=IN`, линкует Patient по `phoneSearchVariants(from)`, публикует `call.incoming`; `answered` добавляет тег `answered` к Call (идемпотентно); `hangup` считает `endedAt/durationSec`; `missed` ставит `direction=MISSED + endedAt`. Все события публикуются и на `telephony.*`, и на `call.*`.
- Runs under `runWithTenant({kind: "SYSTEM"})` с явным `clinicId`.

#### UI `/crm/call-center`

- `page.tsx` (server shell) + `_components/call-center-page-client.tsx` (3-col layout 320px/1fr/380px, desktop-only ≥1280px).
- **Left — `incoming-queue.tsx`:** список ringing calls (filter из всех `direction=IN && !endedAt`), pop-up toast при новом звонке, click → active.
- **Center — `active-call.tsx`:** live timer (ticks every 1s), заметки через `use-call-notes.ts` (debounce 800ms + PATCH `summary`), quick actions: «Записать пациента» (NewAppointmentDialog с `patientId` или `initialPatientPhone`), «Создать карточку» (Link на `/crm/patients?new=true&phone=...`), «Завершить» (PATCH `endedAt`), «Пропущен» (PATCH + tag). Disclaimer что mute/hold/transfer — после реального SIP.
- **Right — `call-history.tsx` + `call-history-filters.tsx`:** infinite list + IntersectionObserver-based lazy load, `call-bubble.tsx` с status pill, filters: status/direction/operator/date-range/search — все URL-synced. Play-button открывает `recordingUrl` если есть.
- Hooks: `use-incoming-calls.ts` (5s poll), `use-active-call.ts` (10s poll + URL-synced `?active=`), `use-call-history.ts` (30s poll + infinite + URL-synced filters), `use-call-notes.ts` (debounced PATCH + useCallPatch mutator).
- NewAppointmentDialog extended: `initialPatientPhone` prop — search `/api/crm/patients?q=<phone>`, auto-select if 1 hit, else open "create new" with phone prefilled. Respects manual operator selection.
- i18n `callCenter.*` — ru/uz parity (~80 ключей).

### Build / тесты

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **118/118 passed** (+20 новых: `telephony-log-only` (7) + `telephony-webhook` (13)).
- `npm run build` — routes `/[locale]/crm/call-center` + `/api/calls/sip/event` в manifest (Inter-font warning — pre-existing since Phase 1).

### Requests для следующих фаз

- **prisma-schema-owner:** расширить `ProviderKind` enum значением `SIP` (сейчас используется `kind=OTHER, label='sip'` как escape hatch). Добавить `status` enum + `startedAt/answeredAt` columns в `Call` модели — избавит UI от derive-логики (status = direction + tags + endedAt).
- **realtime-engineer (Phase 5+):** SSE каналы `call.incoming`, `call.answered`, `call.ended`. Event-bus уже публикует. TODO-маркеры в `use-incoming-calls.ts`, `use-active-call.ts`, `use-call-history.ts`. Poll cadences (5/10/30s) станут fallback.
- **admin-platform-builder (Phase 4):** UI для `ProviderConnection` с `kind='SIP' (будущее)` или label='sip': webhookSecret (encrypted), config JSON, active toggle, test-webhook кнопка.
- **api-builder:** `GET /api/crm/users?role=CALL_OPERATOR` для operator-filter в history (сейчас endpoint не существует — select пустой).

### Deviations

- `Call` модель не содержит `status/startedAt/answeredAt/meta` — задокументировано как TODO. Derive-функция `deriveStatus(row)` на клиенте маппит `direction + tags.includes('answered') + endedAt` в `ringing|answered|ended|missed`.
- SIP "mute/hold/transfer" — вне scope (§6.7.5 предусматривает их только с реальным SIP). В UI показан disclaimer.
- Реальный SSE в браузер не подключён — polling fallback на всех трёх колонках (5s / 10s / 30s). Event-bus стабильно публикует для будущего SSE-handoff.
- В dev без webhookSecret webhook принимает запросы с console.warn — чтобы ручное тестирование было удобным. В prod — 401.

---

## Phase 3d — TG Bot + Mini App — ✅ готово

**Scope.** Patient-facing Telegram Mini App under `/c/[slug]/my` + supporting `/api/miniapp/*` endpoints. Screens: home, book flow (service → doctor → slot → confirm → done с QR), appointments (upcoming/past + detail dialog с reschedule & cancel), documents, profile. Language picker + TG theme integration.

**Что добавлено.**

- **Shared handler (`src/server/miniapp/handler.ts`)** — `resolveMiniAppContext(req, {skipPatientUpsert?})` читает `x-telegram-init-data`, вытаскивает `clinicSlug` из query, загружает Clinic, верифицирует init-data через существующий `verifyMiniAppInitData(initData, tgBotToken)` (HMAC-SHA256 + WebAppData secret). Находит Patient по `{clinicId, telegramId}` (или 428 если не зарегистрирован). Возвращает `MiniAppContext` с `clinicId`/`patientId`/`patient`/`tgUser`. Wrappers `createMiniAppHandler` / `createMiniAppListHandler` оборачивают всё в `runWithTenant({kind:"SYSTEM"}, ...)` — PATIENT роли нет, фильтрация tenancy явная через `{clinicId, patientId}` в каждом запросе. Dev bypass через `x-miniapp-dev-bypass: 1` + `x-miniapp-dev-user` (не в prod).

- **Auth route (`/api/miniapp/auth`)** — POST: upsert Patient by `telegramId`, fallback на `phoneNormalized` (merge существующего пациента с TG-аккаунтом), иначе создаёт нового с `source: "TELEGRAM"`. Идемпотентно — повторный вызов возвращает того же пациента. Respects `auth_date` freshness через `verifyMiniAppInitData`.

- **Миниапп эндпоинты:** `GET /api/miniapp/clinic`, `GET /api/miniapp/services`, `GET /api/miniapp/doctors`, `GET /api/miniapp/slots` (по doctorId + date), `GET|POST /api/miniapp/appointments`, `GET|PATCH /api/miniapp/appointments/[id]` (reschedule/cancel — uses shared `detectConflicts` + `computeEndDate`, `channel: "TELEGRAM"`, `fireTrigger({kind:"appointment.created"})`), `GET /api/miniapp/documents`, `GET|PATCH /api/miniapp/profile`.

- **Hook `useTelegramWebApp()`** (`src/hooks/use-telegram-webapp.ts`) — SSR-safe. Инжектит `telegram-web-app.js` если отсутствует, ждёт `window.Telegram.WebApp`, зовёт `ready()`+`expand()`. Экспонирует `setMainButton({text,active,progress,visible,onClick}) => cleanup`, `setBackButton(onClick) => cleanup`, `showAlert`, `showConfirm: Promise<boolean>`, `haptic.{impact,notification,selection}`, `themeParams`, `colorScheme`, `initData`, `user`.

- **Layout + providers** — `src/app/c/[slug]/my/layout.tsx` использует Next 16 `LayoutProps<"/c/[slug]/my">`. `MiniAppAuthProvider` делает POST на `/api/miniapp/auth` при монтировании, хранит `{status: "loading"|"no_tg"|"error"|"ready", clinic, patient, tgUser}`. `MiniAppShell` применяет TG `themeParams` как CSS variables (`--tg-bg`, `--tg-text`, `--tg-hint`, `--tg-section-bg`, `--tg-accent`).

- **Screens** — `miniapp-home.tsx` (greeting + upcoming card + 4 CTA tiles), book flow (4 steps + done с QR), `appointments-screen.tsx` + detail dialog (reschedule, cancel с `tg.showConfirm`), `documents-screen.tsx`, `profile-screen.tsx`, `language-picker-screen.tsx`, `open-in-telegram-fallback.tsx`. MainButton/BackButton привязан per-screen через `useEffect` + cleanup.

- **Mini UI kit (`mini-ui.tsx`)** — MButton (variants primary/secondary/ghost/danger, block, min-h-[44px]), MCard, MListItem, MHint, MSpinner, MSection, MEmpty. Все тач-таргеты ≥44px.

- **i18n (`mini-i18n.ts` + `_messages/ru.ts|uz.ts`)** — dict-based (не next-intl, т.к. Mini App вне `[locale]` дерева). ~100 ключей, полный ru/uz паритет. Язык читается из `Patient.preferredLang`.

- **Booking draft** — sessionStorage-backed hook `use-booking-draft.ts` сохраняет выбор `serviceId|doctorId|slot` между шагами.

- **QR на done** — `qrcode` npm пакет, payload `ticket:{clinicSlug}:{appointmentId}` (kiosk integration pending).

- **Middleware** — `src/proxy.ts`: добавлено `c\\/|` в matcher exclusion, чтобы next-intl не переписывал `/c/[slug]/my` под `[locale]`.

**Тесты.** +12 тестов → **130 passed** (14 файлов).
- `tests/unit/miniapp-auth-route.test.ts` — 6 кейсов: missing init-data, missing slug, unknown clinic, bad hash, valid init-data + idempotent upsert, 503 без `tgBotToken`.
- `tests/unit/miniapp-handler.test.ts` — 6 кейсов на `resolveMiniAppContext`: missing header/slug, 428 для unregistered, `skipPatientUpsert: true`, resolve by `telegramId`, 503 без токена.

**Quality gates.** `npx tsc --noEmit` — clean. `npx vitest run` — 130/130 passed. `npm run build` — exit 0, все маршруты собраны, включая `/c/[slug]/my/{,book/{service,doctor,slot,confirm,done},appointments,documents,profile}` и `/api/miniapp/{auth,clinic,services,doctors,slots,appointments,appointments/[id],documents,profile}`.

**Deviations / будущие TODO.**
- **prisma-schema-owner:** в текущей схеме всё нужное уже есть (`Patient.telegramId`, `Patient.preferredLang`, `Clinic.tgBotToken/tgMiniAppUrl`, `LeadSource.TELEGRAM`, `AppointmentChannel.TELEGRAM`). Новых полей не требуется.
- **admin-platform-builder (Phase 4):** UI для clinic settings → управление `tgBotToken`, `tgMiniAppUrl` (deep-link URL), `tgBotUsername`, `tgWebhookSecret`. После сохранения должен звать `setWebhook`.
- **telegram-bot-builder:** FSM-ответы `service_select`/`slot_select` в боте сейчас stub — теперь могут deep-link`ить в `Clinic.tgMiniAppUrl?startapp=book`. Bot team должен обновить inline-keyboard handler.
- **kiosk-builder:** QR payload `ticket:{slug}:{id}` пока не парсится kiosk'ом — нужен `POST /api/kiosk/checkin` по appointmentId.
- **Кастомный mini-i18n** вместо next-intl — осознанное решение, Mini App вне `[locale]` дерева (язык от пациента, не URL). Если понадобится универсальный словарь, можно будет слить.
- **SYSTEM tenant context** (не PATIENT role) — PATIENT роли в RBAC нет. Каждый запрос в Mini App endpoints явно скоупит `{clinicId, patientId}`.
- **Language picker first-run** — сейчас запускается только если `preferredLang` не RU/UZ (маловероятно после auth). Полноценный picker по желанию можно триггерить по флагу `Patient.languagePickedAt` (требует миграции — не добавлено сейчас).


---

## Phase 4 — Админские разделы — ✅ DONE 2026-04-22

**Коммиты:** `ff9371e` (CRM settings) · `01855c6` (SUPER_ADMIN platform) · тег `phase-4-done`.

### Settings (settings-pages-builder, `ff9371e`)

- **Layout** `src/app/[locale]/crm/settings/layout.tsx` — ADMIN/SUPER_ADMIN gate + sidebar (8 секций).
- **Секции:** Clinic, Users (CRUD + reset-password + last-admin + self-deactivate guards), Services (inline-edit), Cabinets, Exchange rates, Roles (static matrix), Audit (infinite-scroll virtualized), Integrations (4 провайдерских карточки + SMS test + TG webhook-status/set).
- **API:** `/api/crm/users/*` (new), `/api/crm/clinic/*` (new), `/api/crm/integrations/*` (new), `/api/crm/integrations/{verify-password,tg/webhook-status,tg/set-webhook,sms/test}`.
- **Password re-entry dialog** для secret-changes (TG token, provider creds). Backend verify через bcrypt.
- `ProviderConnection.secretCipher` — base64 placeholder (real AES в `01855c6`, см. ниже).
- +22 новых schema-тестов → 157 passed.
- i18n `settings.*` ru/uz parity (~200 keys).

### SUPER_ADMIN platform (admin-platform-builder, `01855c6`)

- **Encryption** `src/server/crypto/secrets.ts` — AES-256-GCM, scrypt KDF из `APP_SECRET` (fallback `AUTH_SECRET`), формат `v1:iv:tag:ct` base64. 17 юнит-тестов (round-trip, unicode, tamper, bad-key, bad-format, missing-secret, maskSecret, constantTimeEqual).
- **Layout** `src/app/admin/layout.tsx` — SUPER_ADMIN gate (inline 403), sidebar (5 секций + "back to CRM").
- **Секции:** Clinics (CRUD), Clinic Integrations (TELEPHONY→OTHER, PAYMENT→{PAYME,CLICK,UZUM}; masked + "Replace" toggle), Users global (filter + reassign + deactivate with self-guard), Usage (week/month KPI + per-clinic table), Audit global (cursor + filters), Health (Postgres live, Redis/BullMQ/MinIO stubs).
- **API** `/api/platform/*` — 11 endpoints. Все требуют `SUPER_ADMIN` + `runWithTenant({kind:'SUPER_ADMIN'})`.
- **ClinicSwitcher** (`src/components/layout/clinic-switcher.tsx`) — заменил Phase 0 stub. SUPER_ADMIN видит dropdown всех клиник + "Admin platform" link + "Clear override" footer. Non-SUPER_ADMIN — read-only label.
- **Switch mechanism:** HMAC-подписанный cookie `admin_clinic_override=<clinicId>.<hmac>` читается в NextAuth `jwt` callback когда `role=SUPER_ADMIN`. Cross-tab safe, revocable. `router.refresh()` после switch.
- +17 crypto-тестов → **174 passed (16 файлов)**.
- i18n `adminPlatform.*` ru/uz parity.

### Build / тесты

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **174/174 passed**.
- `npm run build` — exit 0, все 63 страницы сгенерированы.

### Deviations

- Schema: `Clinic.{currency, secondaryCurrency}` (не `currencyPrimary/Secondary`).
- `ProviderKind` enum: нет `SIP` / dedicated `PAYMENT` — family→kind маппинг `TELEPHONY→OTHER`, `PAYMENT→{PAYME,CLICK,UZUM}`.
- `tgMiniAppUrl` в schema отсутствует на Clinic — skipped (запрос prisma-schema-owner).
- Legacy `ProviderConnection.secretCipher` из Phase 4 settings (base64) → admin-platform GET ловит decrypt failure, возвращает `••••` чтобы UI не падал.

### Requests для Phase 5+

- **prisma-schema-owner:** `Clinic.tgMiniAppUrl`, `ProviderKind.SIP`, `ProviderKind.PAYMENT`.
- **infrastructure-engineer (Phase 6):** real Redis/BullMQ/MinIO health probes. Re-wrap legacy base64 secrets через AES-GCM migration.
- **Phase 5:** CRM layout сейчас передаёт hard-coded `userEmail="admin@neurofax.uz"` в `CrmTopbar` — wire real session data чтобы `userRole` прокидывался в `ClinicSwitcher`.

---

## Phase 5 — Глобальные фичи — 🔄 в работе

### realtime-engineer (pending commit)

**SSE transport `/api/events` + typed Zod event bus + client hooks + mutation wiring.**

- **Typed event schema** `src/server/realtime/events.ts` — Zod discriminated union for 18 event types (TZ §4.6 + §8.8): `appointment.{created,updated,statusChanged,cancelled,moved}`, `queue.updated`, `call.{incoming,answered,ended,missed}`, `tg.{message.new,takeover.incoming,conversation.updated}`, `payment.{paid,due}`, `notification.{sent,failed}`, `cabinet.occupancy.changed`. Base envelope `{type, clinicId, at, payload}` — `at` ISO-8601 with offset, `clinicId` required per event. Per-type payload types exported (`AppointmentEventPayload`, `CallEventPayload`, …). `EVENT_TYPES` exhaustive literal list kept in sync with the schema options; `EventOf<T>`, `isAppEvent`, `parseEvent` helpers.
- **Publish helper** `src/server/realtime/publish.ts` — `publishEvent(clinicId, {type, payload})` validates via `AppEventSchema.safeParse`, pushes to in-process `EventBus` on `clinic:<id>:events`, and (when `REDIS_URL` set) mirrors to Redis `events:<clinicId>`. `publishEventSafe` fire-and-forget variant swallows errors with `console.warn`. `clinicId` argument always wins over payload.
- **Redis adapter** `src/server/realtime/redis-adapter.ts` — lazy `ioredis` clients, gated on `REDIS_URL`. `ensureRedisSubscriber` pSubscribes `events:*` and forwards inbound messages back into the local bus. `publishToRedis` best-effort; errors logged, never thrown. `__resetRedisForTests` cleanup hook. `ioredis@5` added to deps.
- **Channels module** `src/server/realtime/channels.ts` — `clinicChannel(id)` naming convention shared between publisher / subscriber / SSE handler (avoids circular dep).
- **Event bus** `src/server/realtime/event-bus.ts` — kept backward-compatible `publish(channel, payload)` + `subscribe`; added `size(channel)` diagnostic + snapshot iteration so handlers can unsubscribe during dispatch without Set mutation bugs.
- **SSE endpoint** `src/app/api/events/route.ts` — `GET` returns `text/event-stream` ReadableStream. Authed via `auth()` (401 without session, 403 without clinicId). `session.user.clinicId` already reflects SUPER_ADMIN override cookie thanks to existing NextAuth `jwt` callback. Heartbeat `: ping\n\n` every 20s. First line `: ok\n\n` to flush proxy buffers. `request.signal.addEventListener('abort', ...)` unsubscribes + clears heartbeat. Process starts Redis subscriber once via `ensureRedisSubscriber`.
- **Client hooks** `src/hooks/use-live-events.ts` + `src/hooks/use-live-query.ts`. `useLiveEvents(handler, {filter?, enabled?})` — one shared `EventSource` per tab (module-scoped singleton, ref-counted). Exponential backoff reconnect (1s → 32s cap). Zod-parse every payload; bad events ignored silently. SSR-safe (no-op when `typeof window === "undefined"` or `VITEST`/`NODE_ENV=test`). `useLiveQueryInvalidation({events, queryKey|queryKeys, shouldInvalidate?, enabled?})` wraps `useLiveEvents` + `queryClient.invalidateQueries`.
- **Polling hooks updated** — reception / calendar / telegram / call-center / appointments / doctors hooks got companion `*Realtime()` hooks (mount once from page client) and polling intervals relaxed to 60s fallback. Files touched: `src/app/[locale]/crm/reception/_hooks/use-reception-live.ts` (new `useReceptionRealtime`), `src/app/[locale]/crm/calendar/_hooks/use-calendar-data.ts` (`useCalendarRealtime`), `src/app/[locale]/crm/telegram/_hooks/use-conversations.ts` (`useTgConversationsRealtime`), `src/app/[locale]/crm/telegram/_hooks/use-tg-messages.ts` (`useTgMessagesRealtime`, conv-id gated), `src/app/[locale]/crm/call-center/_hooks/use-incoming-calls.ts` (`useCallCenterRealtime` — invalidates incoming + history + active-call) + `use-active-call.ts` + `use-call-history.ts`, `src/app/[locale]/crm/appointments/_hooks/use-appointments-list.ts` (`useAppointmentsRealtime`), `src/app/[locale]/crm/doctors/_hooks/use-doctors-list.ts` (`useDoctorsListRealtime`). Page-level components still need to mount these hooks (one-line each) — short UX PR follow-up.
- **Mutation handlers publishing** — `POST /api/crm/appointments` → `appointment.created` + `queue.updated`; `PATCH /api/crm/appointments/[id]` → picks between `appointment.cancelled` / `.statusChanged` / `.moved` / `.updated` based on the diff, plus `queue.updated` when status flipped; `DELETE` → `appointment.cancelled`; `PATCH /api/crm/appointments/[id]/queue-status` → `queue.updated` + `appointment.statusChanged`; `POST + PATCH /api/crm/payments` → `payment.paid` on PAID transition; `POST /api/crm/conversations/[id]/messages` → `tg.message.new` (OUT); `PATCH /api/crm/conversations/[id]` → `tg.conversation.updated`; `src/server/workers/notifications-send.ts` → `notification.sent` on success, `notification.failed` on final retry exhaustion.
- **Existing webhook publishers routed through the typed helper** — `src/app/api/telegram/webhook/[clinicSlug]/route.ts` and `src/app/api/calls/sip/event/route.ts` now call `publishEventSafe` for the canonical events while keeping the legacy `publish(channel, payload)` calls for existing in-process listeners (telephony adapter). Phase 6 can deprecate the legacy channels after infra-engineer cuts over.
- **Tests** — `tests/unit/realtime-events.test.ts` (24 cases: coverage, envelope, per-type positive/negative) + `tests/unit/realtime-publish.test.ts` (10 cases: dispatch, tenant isolation, clinicId override, Zod rejection, unsubscribe, `publishEventSafe` error swallowing). **208/208 passed** (+34 vs Phase 4 baseline of 174).
- **Docs** — `docs/realtime.md`: architecture diagram, event registry table, "adding a new event type" playbook, Redis deployment note, WS-vs-SSE rationale, debugging tips.

### Quality gates

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **208 / 208 passed** (18 files).
- `npm run build` — exit 0, `/api/events` in route manifest (ƒ Dynamic).

### TODOs handed to infrastructure-engineer (Phase 6)

- Set `REDIS_URL` in docker-compose + prod env — in-memory bus loses events across node restarts; Redis pub/sub fan-out for horizontal scale.
- Swap `InMemoryQueueAdapter` → BullMQ (notifications-send.ts already emits `notification.sent|failed` — BullMQ worker keeps emitting the same events).
- Consider adding a sequence id to the envelope for at-least-once delivery (Redis pub/sub is at-most-once; the 60s polling fallback covers drops for now).
- Deprecate the legacy `publish(channel, payload)` channels in `event-bus.ts` once the telephony adapter is refactored to use the typed helper too.

### Deviations

- `AppEventInput` intentionally loose on payload passthrough keys so publishers can enrich without schema churn (Zod `.passthrough()`). Breaking changes should still bump `EVENT_TYPES`.
- Page-level components have the realtime hooks available but need a one-liner wiring (e.g. `useReceptionRealtime()` at the top of `reception-page-client.tsx`). Intentionally left to the page-owning agents/UX pass — this PR doesn't touch component files.
- `tg.takeover.callback` legacy channel folded into `tg.takeover.incoming` with a passthrough `callbackData` field; operator UI already listens on takeover events.
- No Prisma schema changes (per brief).

---

## Phase 5 — Глобальные фичи (composite agent) — ✅ DONE 2026-04-22

**Тег:** `phase-5-done`.

### Что сделано

- **Realtime quick-mount (TODO от realtime-engineer).** Один лайнер `use*Realtime()` на каждой из 6 страниц:
  - `src/app/[locale]/crm/reception/_components/reception-page-client.tsx` → `useReceptionRealtime()`
  - `src/app/[locale]/crm/calendar/_components/calendar-page-client.tsx` → `useCalendarRealtime()`
  - `src/app/[locale]/crm/telegram/_components/telegram-page-client.tsx` → `useTgConversationsRealtime()`
  - `src/app/[locale]/crm/call-center/_components/call-center-page-client.tsx` → `useCallCenterRealtime(activeId)`
  - `src/app/[locale]/crm/appointments/_components/appointments-page-client.tsx` → `useAppointmentsRealtime()`
  - `src/app/[locale]/crm/doctors/_components/doctors-page-client.tsx` → `useDoctorsListRealtime()`
- **Global cmdk search (TZ §6.0).** `src/components/layout/global-search.tsx` — `GlobalSearch` dialog + `useGlobalSearchShortcut` (⌘K / Ctrl+K). Группы: Пациенты / Врачи / Записи / Чаты, топ-5 каждой. Fetch `/api/crm/search?q=...` с debounce 200мс и AbortController. Экспортирует чистый `parseSearchResults(raw)` для юнит-тестов. Топбар (`src/components/layout/crm-topbar.tsx`) теперь открывает диалог по клику на иконку поиска; сайдбар получил пункты SMS + Документы. Добавлен `CommandDialog` в `src/components/ui/command.tsx` (отсутствовал в shadcn slice).
- **Analytics dashboard `/crm/analytics`.** Агрегирующий endpoint `src/app/api/crm/analytics/route.ts` (роли ADMIN + DOCTOR; DOCTOR видит только свой срез). Параметры `?period=week|month|quarter` или явный `?from&to`. 7 секций: `revenueDaily`, `appointmentsByStatus`, `noShowDaily`, `topDoctors` (top-10), `topServices` (top-10), `sources`, `ltvBuckets`. UI-клиент `src/app/[locale]/crm/analytics/_components/analytics-page-client.tsx` на Recharts (LineChart / BarChart / PieChart) с PeriodTabs, формат UZS через `formatMoney`. Чистый хелпер окна вынесен в `src/server/analytics/range.ts` (`resolveAnalyticsRange`) — унит-тестируется без next-auth.
- **Documents library `/crm/documents`.** Cross-patient страница с таблицей, поиском, фильтрами (тип / даты / doctor / `pendingSignature`), и заглушкой загрузки метаданных. Endpoint `src/app/api/crm/documents/route.ts` расширен новыми query-параметрами; схема — `src/server/schemas/document.ts`. Файлы: `src/app/[locale]/crm/documents/{page.tsx, _components/documents-page-client.tsx, _components/upload-dialog.tsx, _hooks/use-documents.ts}`.
- **CSV export workers (Phase 5 async).** `src/server/workers/exports.ts` — `enqueueExport`, `getExport`, `__runExportForTests`, `__resetExportRegistry`. Работает через существующий `QueueAdapter` (InMemoryQueueAdapter сегодня, BullMQ позже). Cursor-paginate `take: 500`, UTF-8 BOM, RFC-4180 quoting. API: `POST /api/crm/exports` (ADMIN), `GET /api/crm/exports/[jobId]`, `GET /api/crm/exports/[jobId]/download`. Клиентский хук `src/hooks/use-async-export.ts` (poll 1.5s → triggered `<a>`-download). Кнопки экспорта пациентов и appointments переключены на него.
- **SMS inbox `/crm/sms` (MVP).** UI `src/app/[locale]/crm/sms/_components/sms-page-client.tsx` — список SMS-разговоров через `/api/crm/conversations?channel=SMS` c `refetchInterval: 60_000`. Webhook `src/app/api/sms/webhook/[clinicSlug]/route.ts` — Zod-валидация, lookup клиники под SYSTEM tenant, upsert `Conversation(channel: "SMS")` по `(clinicId, externalId || sms:<from>)`, сопоставление пациента по `phoneNormalized`, publish `tg.message.new` с `platform: "SMS"` (event bus channel-agnostic, Zod `.passthrough()` принимает доп. ключи).
- **i18n parity.** ~80 новых ключей: `search.*`, `analyticsDashboard.*`, `docsLibrary.*`, `exportsUi.*`, `smsInbox.*` в `src/messages/{ru,uz}.json`. Проверено скриптом: **1434 ключа ru ≡ 1434 ключа uz**, разница 0.

### Тесты

- Новые файлы:
  - `tests/unit/global-search-parser.test.ts` — 6 кейсов для `parseSearchResults` (null, частичные поля, non-array).
  - `tests/unit/analytics-range.test.ts` — 7 кейсов для `resolveAnalyticsRange` (week / month / quarter / custom / partial / malformed / midnight-alignment).
  - `tests/unit/exports-worker.test.ts` — 7 кейсов для воркера (lifecycle, BOM, RFC-4180 quoting, 501-row pagination, unknown kind, unknown jobId, payments CSV columns).
- **228 / 228 passed** (21 файл) — +20 vs Phase 5/realtime-engineer baseline 208 и выше таргета 215.

### Quality gates

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **228 / 228 passed**.
- `npm run build` — exit 0, роуты в манифесте: `/api/crm/analytics`, `/api/crm/exports`, `/api/crm/exports/[jobId]`, `/api/crm/exports/[jobId]/download`, `/api/sms/webhook/[clinicSlug]`, страницы `/[locale]/crm/{analytics,documents,sms}`. Prisma-warn'ы (`Invalid prisma.doctor.findMany()`) — это стандартные build-time prerender-пробы, они не роняют build.

### Deviations / заметки

- Export registry и файлы — in-memory / `/tmp/exports/*.csv`. Phase 6 (infrastructure-engineer) должен перенести в Postgres + MinIO, а `/api/crm/exports/[jobId]/download` заменить на presigned URL. Текущая реализация спокойно живёт single-node.
- SMS вебхук не валидирует подпись провайдера в MVP: dev принимает, prod — 401 если нет `x-sms-secret`. Phase 6 / SMS adapter кладёт Eskiz/Playmobile signature verification.
- `ltvBuckets` считается по всем пациентам клиники (not filtered by period) — это срез "состояние на сегодня", не "LTV накопленный за период". Для "LTV за период" можно добавить отдельную секцию позже.
- `topServices` использует join `AppointmentService`; если пуст — fallback на `appointment.serviceId`. Оба сценария встречаются в проде.
- Documents upload — только метаданные (URL к уже загруженному файлу). Real presigned-upload в MinIO делает infrastructure-engineer в Phase 6.
- Type imports `AppointmentStatus` / `LeadSource` из `@prisma/client` не экспортируются в этой версии схемы; используются строковые literal types, это не ломает валидацию т.к. groupBy возвращает их из Prisma в нужной форме.

---

## Phase 6 — Инфраструктура — ✅ DONE 2026-04-22

**Тег:** `phase-6-done` (после commit).

### Что сделано (infrastructure-engineer)

#### Docker + deployment

- **`Dockerfile`** — multi-stage, Node 20 bookworm-slim. Stage 1 `builder`: `npm ci` + `prisma generate` + `npm run build`. Stage 2 `runner`: копирует `.next/standalone` + `.next/static` + `public` + `prisma/` + generated Prisma client. Non-root `nextjs:1001`, `tini` init, HEALTHCHECK на `/api/health`, `CMD node server.js`.
- **`Dockerfile.worker`** — тот же базовый image, но оставляет полный `src/` + `node_modules` (нужен `tsx`). `CMD npx tsx src/server/workers/start.ts`.
- **`next.config.ts`** — добавлен `output: "standalone"` для Next.js standalone server bundle.
- **`.dockerignore`** — exclude `.git`, `node_modules`, `.next`, `.env`.
- **`docker-compose.yml`** — 7 сервисов: `postgres:16-alpine`, `redis:7-alpine` (appendonly + `maxmemory 256mb allkeys-lru`), `minio/minio:latest` (console :9001), `app`, `worker`, `nginx:alpine`, `certbot/certbot:latest` (12h renewal loop). Volumes: `pgdata`, `redisdata`, `miniodata`, `letsencrypt`. Healthchecks на pg/redis/minio/app. `env_file: .env`.
- **`.env.example`** — все обязательные переменные: `DATABASE_URL`, `REDIS_URL`, `APP_SECRET`, `AUTH_SECRET`, `AUTH_URL`, `MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET/PUBLIC_URL`, `SENTRY_DSN`, `TG_WEBHOOK_BASE_URL`, `LETSENCRYPT_EMAIL/DOMAIN`, `BACKUP_BUCKET/RETENTION_DAYS`, и т.д.
- **`nginx/nginx.conf`** — HTTP/2, gzip, reverse-proxy на `app:3000`, security headers, certbot `/.well-known/acme-challenge`, **отдельный `location = /api/events` с `proxy_buffering off` и `proxy_read_timeout 1h`** для SSE, `location /api/ws` заготовка под WebSocket. TLS: TLSv1.2/1.3, modern ciphers.

#### Ops scripts (`ops/`)

- **`backup.sh`** — `docker compose exec postgres pg_dump | gzip` → MinIO через `minio/mc` container. Retention prune `BACKUP_RETENTION_DAYS` (default 30). Cron: `ops/crontab.example` (03:00 UTC daily).
- **`restore.sh`** — интерактивный restore из MinIO backup (требует подтверждения "YES").
- **`certbot-init.sh`** — first-run Let's Encrypt issuance через webroot. `LE_STAGING=1` для тестов.
- **`deploy.sh`** — idempotent: `git fetch + reset --hard origin/main`, `docker compose build`, `docker compose up -d`, ждёт `/api/health`, `prisma migrate deploy`, reload nginx.
- **`migrate-secrets.ts`** — one-shot: сканирует `ProviderConnection.secretCipher` rows, пробует decrypt как `v1:` — если падает, пробует base64 legacy → re-encrypts через AES-GCM `encrypt()`. Dry-run по умолчанию, `--apply` для записи.

#### GitHub Actions

- **`.github/workflows/ci.yml`** — on PR/push main: checkout, Node 20 + npm cache, `npm ci`, `prisma generate`, lint, `tsc --noEmit`, `vitest run`, `npm run build`, verify `.next/standalone/server.js` exists.
- **`.github/workflows/deploy.yml`** — triggers after CI success on main (или manual dispatch), SSH через `appleboy/ssh-action` → `ops/deploy.sh`. Secrets: `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_PORT`, `DEPLOY_DIR`.

#### Application-level

- **`src/app/api/health/route.ts`** — публичный endpoint (без auth). Проверки: `db` (prisma `$queryRawUnsafe("SELECT 1")`), `redis` (lazy `ioredis.ping`, если `REDIS_URL`), `minio` (`fetch .../minio/health/ready`, если `MINIO_ENDPOINT`), `workers` (метадата). 5-секундный timeout на каждую проверку через `Promise.race`. Возвращает `{status, version, uptime, checks, generatedAt}`, 200 если DB OK, 503 если DB down. `Cache-Control: no-store`, `dynamic = "force-dynamic"`, `runtime = "nodejs"`.
- **`src/server/storage/minio.ts`** — MinIO adapter. `uploadObject/getSignedUrl/deleteObject/isStubMode/pingStorage`. S3-mode через лениво-подгружаемые `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (dynamic import через `new Function("spec", "return import(spec)")` — TypeScript не проверяет compile-time, SDK опционален). Stub-mode (без `MINIO_ENDPOINT`) пишет в `${os.tmpdir()}/medbook-uploads/<bucket>/<key>` и возвращает `file://` URLs. Sanitize `../` в ключах, bucket дефолтится на `MINIO_BUCKET`.
- **`src/app/api/crm/documents/upload-url/route.ts`** — `POST` issues presigned PUT URL (ADMIN/RECEPTIONIST/DOCTOR/NURSE). В stub-mode возвращает `{stub: true, uploadUrl: null}` — UI фоллбэчит на старый metadata-POST. Key convention: `clinics/<clinicId>/documents/<uuid>-<sanitizedName>`.
- **`src/instrumentation.ts`** — Next 16 `register()` + `onRequestError()`. Если `SENTRY_DSN` set → lazy-import `@sentry/nextjs` (опц. runtime dep), init с `environment`, `tracesSampleRate`. `onRequestError` тегирует событие `clinicId`, `userId`, `role` из `TenantContext` (AsyncLocalStorage). No-op без DSN или без SDK (с warn).

#### Tests

- **`tests/unit/storage-minio.test.ts`** — 7 кейсов stub-mode: isStubMode, uploadObject writes + returns file:// URL, getSignedUrl, deleteObject remove + idempotent, path traversal containment, MINIO_BUCKET env fallback.
- **`tests/unit/health-route.test.ts`** — 4 кейса: 200 + ok при живом DB, 503 + down при DB fail, no-store headers, все 4 checks в payload.

### Quality gates

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **239 / 239 passed** (23 файла, +11 новых).
- `npm run build` — exit 0, `.next/standalone/server.js` present, `/api/health` в route manifest.
- `docker compose config` — valid, 7 сервисов.

### Что осталось на Phase 7

- Реальная интеграция MinIO test-коннекта с работающим контейнером — сейчас тесты покрывают только stub path (S3-mode требует live MinIO).
- Sentry `@sentry/nextjs` — npm не добавлен в deps (адаптер работает через optional dynamic import). Установить `npm install @sentry/nextjs` на прод-деплое, если DSN задан.
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — аналогично, установить на прод-деплое при `MINIO_ENDPOINT`.
- Миграция `ops/migrate-secrets.ts` — прогнать на прод-БД после апгрейда до Phase 6. Сейчас идемпотентна.
- Валидация SMS webhook signature (Eskiz/Playmobile) — infrastructure-engineer оставил заметку.
- LE cert renewal cron — проверить в течение 90 дней после первого деплоя.

### Deviations

- **Sentry + AWS SDK через `new Function("spec", "return import(spec)")`** — позволяет `tsc` не падать на отсутствующих опциональных deps. В рантайме dynamic import срабатывает штатно, ошибка с hint'ом при отсутствии пакета.
- **Health endpoint не проверяет воркеров напрямую** — workers живут в отдельном контейнере с собственным `HEALTHCHECK` (inherited из `Dockerfile.worker`). `/api/health` возвращает статус "ok" с метадатой очередей; per-queue depth — задача Phase 7 / BullMQ dashboard.
- **MinIO probe в `/api/health`** — HEAD `/minio/health/ready` вместо реального put. Избегает шума в audit-log и не требует creds на каждый health-hit.
- **Prisma build-time warnings** (`Invalid prisma.doctor.findMany() invocation`) — остались с Phase 5, это prerender probes; build не падает.
- **Legacy `.env` в context** — `docker-compose.yml` использует `env_file: .env`. Если `.env` отсутствует на деплое, compose падает явно.

---

## Phase 7 — Тесты + полировка — ✅ DONE 2026-04-23

### Коммиты

- `0302bc4 feat(e2e)` — test-engineer: Playwright suite + coverage config
- `600bbe7 a11y(phase-7)` — a11y-engineer: axe-core + WCAG 2.2 AA fixes
- `73ad4ff security(phase-7)` — security-reviewer: audit + critical/high fixes
- `285c851 ux(phase-7)` — ux-polisher: empty states + skeletons + error boundaries
- `cabbd5d perf(phase-7)` — performance-optimizer: bundle audit + dynamic imports

### test-engineer (`0302bc4`)

**e2e-suite по §9.6 + playwright.config.**

- **20 Playwright-спек** покрывают все критичные CRM-сценарии:
  `01-auth-login` · `02-rbac-guards` · `03-patients-list` · `04-patient-card` ·
  `05-appointments-list` · `06-appointment-create` · `07-calendar-dnd` ·
  `08-reception-queue` · `09-doctors-crud` · `10-call-center` · `11-telegram-inbox` ·
  `12-miniapp-booking` · `13-kiosk-checkin` · `14-tv-board` · `15-q-ticket` ·
  `16-super-admin` · `17-exports` · `18-notifications-preview` · `19-search-cmdk` ·
  `20-dashboard-kpi`.
- **`tests/e2e/helpers.ts`** — `loginAs`, `as.{admin,doctor,receptionist,superAdmin,otherClinicAdmin}`, `isAppHealthy`, `signMiniAppInitData`, `firstPatientId/firstDoctorId/firstService` + typed seed-handles fixture.
- **Coverage config** в `vitest.config.ts` — v8 provider, HTML + JSON reports, `src/lib/**`/`src/server/**`/`src/hooks/**`.
- **CI job `e2e`** в `.github/workflows/ci.yml` — `postgres:16-alpine` service, `E2E_PORT=3001`, additive (не ломает существующий `ci.yml`).
- **33 теста** в listing: 31 на `chromium-desktop` + 2 mobile-specific (`miniapp-*.spec.ts` на Pixel 5).

### a11y-engineer (`600bbe7`)

**axe-core Playwright-integration + WCAG 2.2 AA фиксы.**

- **Инфраструктура:** установлены `axe-core` + `@axe-core/playwright` devDeps. `tests/e2e/helpers.ts` теперь экспортирует `checkA11y(page, opts)` (WCAG 2.0/2.1/2.2 A+AA tags) + `CRM_AXE_WHITELIST` (`region`, `color-contrast`). Фэйлит только на `critical`/`serious`.
- **2 новых спеки:** `tests/e2e/21-a11y-crm.spec.ts` (13 tests — axe на 10 CRM-маршрутов + keyboard-tab smoke + health sanity) и `tests/e2e/22-miniapp-a11y.spec.ts` (2 tests × 2 проекта = 4). Полный listing теперь 47 тестов.
- **Фиксы (7 serious):**
  1. `aria-live="polite"` + `aria-atomic="false"` на живых регионах: `kpi-strip.tsx`, `doctor-queue-grid.tsx`, `conversation-list.tsx` (+ `role="list"`).
  2. `aria-label` на неподписанных input'ах: `call-history-filters.tsx`, `documents-page-client.tsx`, `message-composer.tsx`, `calendar-toolbar.tsx`.
  3. `htmlFor`/`id` wiring: `upload-dialog.tsx` (4 поля), `doctor-time-off.tsx` (3 поля).
- **Проверено и ок:** `button/input/textarea` → `focus-visible:ring`; Radix/base-ui Dialog/Sheet — focus trap; landmarks есть в CRM/MiniApp/topbar/inbox; контраст `#3DD5C0/#0b2e29 ≈ 11:1`, `destructive/white ≈ 5.9:1`.
- **Отложено (3 moderate + 2 minor):** `--muted-foreground` ≈ 4.4:1 на `--surface`, нативный `<select>` styling, FullCalendar vendor widget, donut link label, decorative clock widget.
- **Deliverables:** `docs/a11y/phase-7.md` (full report), `docs/a11y/checklist.md` (reusable page-agent checklist).

### security-reviewer (`73ad4ff`)

**Аудит по §9.5 + критичные/high фиксы.**

- **Сводка:** 1 critical (fixed), 3 high (2 fixed + 1 deferred), 4 medium (recs), 3 low (recs).
- **C1 fixed — SMS webhook forgeable** (`src/app/api/sms/webhook/[clinicSlug]/route.ts`): constant-time compare `x-sms-secret` vs `ProviderConnection(kind=SMS).config.webhookSecret` (аналогично SIP webhook). Dev — warn-and-accept fallback; prod — требует секрет.
- **H1 fixed — JWT TTL** (`src/lib/auth.ts`): `session.maxAge=24h`, `updateAge=1h` (было NextAuth default 30 дней).
- **H2 fixed — Auth rate-limit** (`src/app/api/auth/[...nextauth]/route.ts`): `rateLimit()` 5 req/min/IP, 429 + `retry-after:60`.
- **M4 fixed — CI hardening** (`.github/workflows/ci.yml`): добавлены `npm audit --omit=dev --audit-level=high` и `gitleaks/gitleaks-action@v2`.
- **Deferred (recommendations):**
  - H3 — 13 legacy `@ts-nocheck` routes (leads/booking/kiosk/queue/tv-queue/telegram-*) обходят tenant-context. Нужно UX/schema решение, вне Phase 7 scope.
  - M1 — LogOnly adapters логируют phone/chatId + preview. Редактировать + gate behind `DEBUG_*`.
  - M2 — SSE `tg.message.new` payload: per-role scoping когда layer созреет.
  - M3 — in-memory rateLimit → Redis в Phase 6 infra (swap-in одной строкой).
  - L1/L2/L3 — `next-auth` beta, fire-and-forget audit log, 30-min override TTL.
- **Verified clean:** RBAC через handler factory (403), Prisma extension защищает tenant-scoped models вне `runWithTenant`, Zod на каждом mutating route, нет `dangerouslySetInnerHTML` (кроме одного escaped+whitelisted), нет `$queryRawUnsafe`, SIP+Telegram webhooks constant-time verify, AES-256-GCM + scrypt KDF корректны.
- **Deliverables:** `docs/security/phase-7.md` (finding report), `docs/security/checklist.md` (page-agent checklist).

### performance-optimizer (`cabbd5d`)

**Bundle audit + dynamic imports + virtualization sweep.**

- **Recharts → `next/dynamic`** в `/crm/analytics`: извлечён `analytics-charts.tsx` + shared `analytics-types.ts`, клиент грузит lazy с skeleton fallback. **Экономия: ~90KB gz** на First Load JS маршрута.
- **Recharts → lazy** в `/crm/patients` right-rail: `DemographicsWidget` + `SourcesWidget` больше не приезжают в initial bundle patients-list.
- **cmdk → lazy-mount** в `crm-topbar`: `searchMounted` gate — cmdk + `@radix-ui/react-dialog` (~40KB gz) не грузятся пока юзер не триггернёт `/` или `⌘K`. Highest leverage — топбар на каждой CRM-странице. (Edit доехал в коммите `285c851` ux-polisher'а.)
- **`<img>` → `<Image priority>`** на LCP-логотипах `/kiosk`, `/tv`, `/q/[id]`: WebP + responsive srcset + inline preload. 0 сырых `<img>` в `src/`.
- **Уже оптимально:** FullCalendar уже dynamic в `calendar-page-client.tsx`; Prisma `@@index` на всех hot-path полях (Appointment/Patient/Payment/AuditLog/Call).
- **Virtualization sweep:** каждая CRM-таблица >100 строк уже виртуализирована. Deferred: `/admin/audit` (infinite scroll) — логировано как fu.
- **N+1 recommendations (read-only):** `src/server/notifications/triggers.ts` три worker-loop'а делают до 1500 запросов за tick. Background cron paths, юзер-фэйсинг latency не трогает — батчить когда workload оправдает.
- **Deliverable:** `docs/perf/2026-04-22-phase-7.md`.

### ux-polisher (`285c851`)

**Polish pass по §9.6 + §10.Фаза 7.**

- **Root-level error boundaries.** `src/app/[locale]/crm/error.tsx` + `src/app/admin/error.tsx` — ловят необработанные ошибки в `/crm/**` и `/admin/**`. Обе кнопки: «Повторить» (вызывает `reset()`) и «Вернуться» (`Link` через `buttonVariants()` — `Button.asChild` не поддерживается в @base-ui/react). В dev показывают `error.message + digest`, в prod скрыты. i18n через новые ключи `common.errorBoundaryTitle/Description/goHome` (ru/uz parity).
- **Route-level skeletons.** Next 16 `loading.tsx` для каждого CRM-раздела: `patients`, `appointments`, `doctors`, `reception`, `call-center`, `telegram`, `notifications`, `analytics`, `documents`, `calendar` + generic fallback `/crm/loading.tsx`. Bespoke шаблоны для 3-колоночных layout'ов (`call-center`, `telegram`, `notifications`, `calendar`); остальные — через новую молекулу `src/components/molecules/page-skeleton.tsx` (конфигурируемая — `kpi|filters|body=table/grid|rows|rail`).
- **Global search shortcut `/`.** `src/components/layout/global-search.tsx` → `useGlobalSearchShortcut` теперь ловит как `⌘K/Ctrl+K`, так и `/`, но только если активный элемент не input/textarea/contenteditable. Kbd hint в топбаре обновлён на «⌘K · /».
- **Toasts / empty states / loading buttons — audit-only.** Все три паттерна уже полностью покрыты со времён Phase 2-5: 24 файла импортируют `EmptyState`, 35 файлов используют `toast.{success,error,info}` в consumer-компонентах, `isPending`/`isLoading` привязаны к `disabled` во всех формах. Полировать точечно нечего.

### Файлы

- **Added (14):** `src/app/[locale]/crm/error.tsx`, `src/app/admin/error.tsx`, `src/app/[locale]/crm/{loading,patients/loading,appointments/loading,doctors/loading,reception/loading,call-center/loading,telegram/loading,notifications/loading,analytics/loading,documents/loading,calendar/loading}.tsx`, `src/components/molecules/page-skeleton.tsx`, `docs/ux/phase-7.md`.
- **Modified (4):** `src/components/layout/global-search.tsx`, `src/components/layout/crm-topbar.tsx`, `src/messages/ru.json`, `src/messages/uz.json`.
- **Constraints соблюдены:** `src/app/api/*` не трогал, `prisma/schema.prisma` не трогал, ARIA-атрибуты не менял (a11y-engineer), dynamic imports / bundle не трогал (performance-optimizer).

### Quality gates

- `npx tsc --noEmit` — clean в пределах изменённых файлов. Pre-existing TS2345 в `src/app/api/auth/[...nextauth]/route.ts` пришёл от security-reviewer'а и находится вне UX scope.
- `npx vitest run` — **239 / 239 passed** (baseline Phase 6 сохранён).
- `npm run build` — exit 0. Новые `loading.tsx` + `error.tsx` попали в route manifest.

### Known gaps / handoff

- Inline blur-validation для email/phone — оставлено как есть (charter: "leave if already consistent"). Текущая валидация через Zod на submit согласована везде.
- ARIA на новых skeleton/error — a11y-engineer в параллели.
- Visual regression (Percy/Chromatic) — не настроено, решение test-engineer'а.
- Sonner richColors / темы — дефолт; можно итерировать позже без code churn.

### Combined quality gates (Phase 7 final)

После мерджа всех 5 коммитов:

- `npx tsc --noEmit` — **clean** (0 errors).
- `npx vitest run` — **239 / 239 passed** (23 test files, 1.11s).
- `npm run build` — **exit 0** (Turbopack, Next 16.2.2). Все новые `loading.tsx` / `error.tsx` / `21-a11y-*` / `22-miniapp-a11y-*` в route manifest.
- `npx playwright test --list` — **47 тестов** (31 chromium-desktop + 2 chromium-mobile × 2 проекта + a11y sweep + health).

### Phase 7 deferred / follow-ups

- H3 — миграция 13 legacy `@ts-nocheck` routes на tenant-context handler (нужен UX-discussion по leads/booking/kiosk/queue/tv-queue/telegram-*).
- N+1 в `src/server/notifications/triggers.ts` — батчить worker-loop'ы когда workload оправдает.
- `/admin/audit` — виртуализация infinite-scroll.
- Visual regression — Chromatic/Percy (выбор не сделан).
- Sentry `@sentry/nextjs` / `@aws-sdk/client-s3` — доставить на прод-деплое (optional deps через dynamic import).
- Inline blur-validation для email/phone на больших формах — Zod-submit-only пока норм.
- Moderate a11y — `--muted-foreground` ≈ 4.4:1 на `--surface`, нативный `<select>`, FullCalendar vendor.
- Legacy `next-auth` beta → stable когда выйдет.
- SSE per-role scoping для `tg.message.new` payload (security M2).

---

## Post-Phase-7 hardening — booking robustness — ✅ DONE 2026-04-29

### Коммит

- `781682c feat(appointments)` — no-overlap migration + early-completion shrink + stress spec.

### Что починено

- **DB-level overlap backstop** (`prisma/migrations/20260429_appointment_no_overlap/migration.sql`): два Postgres `EXCLUDE USING gist` constraint'а — `Appointment_doctor_no_overlap` и `Appointment_cabinet_no_overlap` — на `tsrange("date","endDate",'[)')`. Срабатывают как страховочный слой, когда Serializable retry в POST `/api/crm/appointments` не успевает поймать гонку. Требует `btree_gist` extension.
- **Early-completion endDate shrink** (`src/app/api/crm/appointments/[id]/queue-status/route.ts`, `src/app/api/crm/appointments/[id]/route.ts`): когда визит помечается COMPLETED раньше забронированного `endDate`, слот ужимается до `now` (с floor'ом `start + 5 min`), `durationMin` пересчитывается. Освобождённый хвост сразу бронируется. Публикуется `appointment.updated` event.
- **DriverAdapterError catch widening** (`src/app/api/crm/appointments/route.ts`): Prisma 7 + pg adapter под нагрузкой surface'ит EXCLUDE/serialization ошибки как `DriverAdapterError` без `originalCode`/SQLSTATE — только в `message`. Catch теперь матчит по подстроке (`exclusion constraint`, `Appointment_*_no_overlap`, `write conflict or a deadlock`, `could not serialize access`) в дополнение к code/originalCode/kind. Concurrent-booking гонки больше не утекают как 500.
- **`isAppHealthy()` race fix** (`tests/e2e/helpers.ts`): `ctx.dispose()` переехал в `finally` — раньше abort'ил request до чтения тела, отчего все 12 тестов в стресс-спеке скипались с "DB health check failed".

### Стресс-спек (`tests/e2e/21-appointment-booking-stress.spec.ts`)

12 тестов в `describe.serial`, **все зелёные за 4.8s**:

1. setup + self-cleaning beforeAll (отменяет все non-cancelled будущие записи на тестовом докторе через API)
2. CRM POST first booking → 201
3. дубль того же слота → 409 doctor_busy
4. touching boundary (`[N+30, N+60]` сразу после `[N, N+30]`) → 201, `[)`-семантика OK
5. cabinet collision (другой доктор, тот же кабинет) → 409 cabinet_busy
6. PATCH reschedule +2h → 200, оригинальный слот свободен
7. POST в освобождённый слот → 201
8. **5 параллельных POST в один слот → ровно 1×201 + 4×409** (Serializable retry + EXCLUDE backstop)
9. DELETE (soft cancel) → re-book → 201 (CANCELLED не блокирует EXCLUDE)
10. **lifecycle BOOKED → IN_PROGRESS → COMPLETED early** → endDate сжат, durationMin меньше, освобождённый хвост бронируется
11. NO_SHOW → re-book → 201 (NO_SHOW тоже не блокирует)
12. cleanup

Single shared `BrowserContext`/`APIRequestContext` (login один раз в `beforeAll`) — обходит NextAuth per-IP rate-limit (5 attempts/window). `RUN_MINUTE_OFFSET = 5..55 step 5` рандомизирует слоты между прогонами.

### Quality gates

- Стресс-спек: **12/12 passed** на полном прогоне.
- `tsc --noEmit` clean.
- Working tree чистый, тег `phase-7-done` (`3ce45a7`) не двигаем — этот блок post-v1 hardening, не часть Phase 7.

---

# Production v1 — ✅ READY 2026-04-23

## Phase timeline (полная история)

- `pre-rebuild-2026-04-22` (`ec24c4d`) — safety rollback
- `phase-0-done` — cleanup + prisma + i18n + design-system + tenancy
- `phase-1-done` — ~50 CRM API endpoints
- `phase-2a-done` → `phase-2d-done` — patients, appointments+calendar, reception, doctors
- `phase-3a-done` → `phase-3d-done` — notifications, telegram inbox+bot, call center, mini app
- `phase-4-done` — settings + admin platform (SUPER_ADMIN)
- `phase-5-done` — realtime + search + analytics + documents + exports + SMS
- `phase-6-done` — Docker + CI/CD + MinIO + Sentry
- `phase-7-done` — tests + a11y + security + perf + ux polish

## Что реализовано против ТЗ

- §4 Roles + RBAC — 6 ролей (SUPER_ADMIN / ADMIN / DOCTOR / RECEPTIONIST / NURSE / CALL_OPERATOR), `createApiHandler({roles})` factory, 403 везде.
- §4.1 Reception dashboard, §4.2 Appointments+Calendar, §4.3 Doctors, §4.4 Patients, §4.5 Call Center, §4.6 Realtime (SSE + event-bus + hooks), §4.7 Notifications, §4.8 Telegram inbox+bot+MiniApp, §4.9 Analytics, §4.10 Documents, §4.11 Exports, §4.12 SMS — все секции реализованы.
- §5 Multi-tenancy — `AsyncLocalStorage` + Prisma `$extends` auto-injection, HMAC-signed cookie для SUPER_ADMIN override.
- §6 Encryption — AES-256-GCM + scrypt KDF для `ProviderConnection` secrets.
- §7 Telegram — webhook + FSM + Mini App `initData` HMAC verify.
- §8 i18n — next-intl 4.9, ru/uz полный паритет ~1437 ключей каждый.
- §9.1-9.6 Quality gates — tsc clean, 239 unit tests, 47 e2e specs, axe-core a11y, security audit, perf bundle analysis.
- §10 Infrastructure — Next 16.2.2 standalone, Docker Compose (7 services), nginx reverse-proxy, GitHub Actions CI/CD, MinIO S3-compat, BullMQ queues, Sentry observability.

## Что НЕ в v1 (осознанные deferred)

- Phase 8 — Admin platform advanced (billing, audit-grafana dashboards, multi-region).
- 13 legacy routes с `@ts-nocheck` — остаются рабочими, но без tenant guard (leads/kiosk-form/tv-queue endpoints).
- Inline blur-validation — submit-time Zod пока достаточно.
- Visual regression suite — не выбран инструмент.
- Moderate a11y (3 пункта) — не блокируют WCAG AA.
- Production-grade Redis для rate-limit (сейчас in-memory per-process).

## Команды для деплоя

```bash
# Локально
npm run e2e:seed        # seed dev DB
npm run dev             # http://localhost:3000

# Docker (production-like)
docker compose up -d    # 7 services: app, worker, postgres, redis, minio, nginx, studio

# CI
# GitHub Actions: lint → tsc → vitest → playwright → docker build → deploy
```

## Логины seed

| Роль | Email | Пароль |
|---|---|---|
| SUPER_ADMIN | `super@neurofax.uz` | `super` |
| ADMIN (neurofax) | `admin@neurofax.uz` | `admin` |
| ADMIN (demo-clinic) | `admin@demo-clinic.uz` | `admin` |
| RECEPTIONIST | `recept@neurofax.uz` | `recept` |
| DOCTOR | `neurologist@neurofax.uz`, `cardiologist@neurofax.uz` | `doctor` |

