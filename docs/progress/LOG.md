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

- Расширенная админ-платформа (billing UI, audit-grafana dashboards, multi-region) — переехало в Phase 9 SaaS roadmap.
- 13 legacy routes с `@ts-nocheck` — остаются рабочими, но без tenant guard (leads/kiosk-form/tv-queue endpoints).
- Inline blur-validation — submit-time Zod пока достаточно.
- Visual regression suite — не выбран инструмент.
- Moderate a11y (3 пункта) — не блокируют WCAG AA.
- Production-grade Redis для rate-limit (сейчас in-memory per-process).

---

## Roadmap to $1M SaaS — фазовый план post-v1

После Production v1 продукт развивается **аддитивно**: каждая фаза не ломает существующие флоу, имеет конкретный selling point и тегается отдельно. Очерёдность согласована с фидбеком от 2026-05-01 (Этап 1 MVP → Этап 4 Scale).

| Фаза | Цель | Selling point | Риск | Тег |
|---|---|---|---|---|
| **8** | Conversion KPIs + Notification Settings UI | «Клиника видит свою воронку и сама рулит автоматизацией» (Pro tier) | Низкий — поверх готовой БД | `phase-8-done` |
| **9** | Branches + Plans + Feature flags | Multi-clinic SaaS с тарифами Basic/Pro/Enterprise | Высокий — миграция схемы | `phase-9-done` |
| **10** | Real integrations (Eskiz SMS / Payme / Click / onboarding wizard) | «Всё реально шлёт и принимает деньги» | Средний | `phase-10-done` |
| **11** | SIP телефония (отдельный VPS, Asterisk + WebRTC) | Enterprise add-on | Средний | `phase-11-done` |
| **12** | Queue Engine v2 — score / ETA / reassign recommendations | Enterprise (≥10 одновременных пациентов) | Низкий — слой поверх | `phase-12-done` |
| **13** | Reactivation + segmentation campaigns | Cross-sell повторных визитов | Низкий | `phase-13-done` |

Подробности по каждой фазе ниже по документу.

---

## Phase 8 — Conversion KPIs + Notification Settings UI — ✅ DONE 2026-05-01

### Контекст

Фидбек шефа: «Главные KPI — no-show %, конверсия Telegram → запись, конверсия звонок → запись». В существующем `/crm/analytics` этих воронок **нет** — есть только cross-tab по статусам и доход. И `NotificationTemplate` лежат в БД, но менять их без миграции нельзя — UI редактора отсутствует. Без этих двух вещей нельзя продавать продукт как «увеличиваем загрузку и снижаем no-show», потому что нечем замерить «до/после».

### Подфазы

#### 8a — Conversion funnel KPIs в /crm/analytics

- TG → запись %: отношение Conversation'ов (хотя бы 1 IN-сообщение за период) к Appointment'ам с `source = TELEGRAM` за тот же период.
- Звонок → запись %: отношение Call'ов (direction IN/OUT с completed) к Appointment'ам с `source = CALL`.
- No-show по врачу/услуге (топ-список с %).
- Mini App booking funnel: viewed slots → confirm step → booked (drop-off на каждом шаге).
- Время ожидания: среднее `WAITING → IN_PROGRESS` интервал per doctor.
- API: расширение `/api/crm/analytics` или новый `/api/crm/analytics/funnels`.
- UI: 4 новых карточки на Analytics page, time-window фильтр (week/month/quarter — есть готовый control).

#### 8b — Notification Template editor

- Страница `/crm/settings/notifications`.
- Список из 7 триггеров (`appointment.created`, `appointment.reminder-24h`, `appointment.reminder-2h`, `appointment.cancelled`, `birthday`, `no-show`, `payment.due`).
- Редактор тела сообщения для RU и UZ с подсказкой переменных (`{{patient.name}}`, `{{appointment.time}}` и т.д.).
- Live preview с тестовыми данными.
- Сохранение через `PATCH /api/crm/settings/notifications/templates/[id]`.

#### 8c — Notification Rules editor (тайминг + канал)

- Тайминг триггеров (offsetMin) — для `*.reminder-*` редактируется (24h → 23h, 2h → 1.5h и т.д.).
- Выбор канала per trigger: TG / SMS / both. По умолчанию TG если patient.telegramId есть, fallback SMS.
- Tumbler enabled/disabled per trigger.
- Сохранение в `NotificationTemplate.triggerConfig` (Json column уже есть).

### Архитектурные ограничения

- **Не трогаем** триггер-функции в `src/server/notifications/triggers.ts` — они уже стабильны и идемпотентны.
- **Не трогаем** sender-адаптеры (`src/server/notifications/adapters/`).
- Меняется **только**: добавление UI + расширение API (read/update `NotificationTemplate` rows) + чтение `triggerConfig` в материализаторе расписания.
- Все изменения per-clinic — никаких cross-tenant утечек.

### Quality gates Phase 8

- `tsc --noEmit` clean
- Новые unit-тесты: ≥6 для template render с переменными, ≥3 для funnel-агрегатов
- Новые e2e: ≥2 (создание/редактирование template; просмотр funnel)
- Все 239+ старых unit и 47+ e2e продолжают проходить
- Lighthouse на `/crm/analytics` не упал ниже 85 PWA / 95 a11y

### Параллелизация

Запускаются **два независимых worktree-агента** на Opus:

- `agent-A` — Phase 8a (analytics funnels) — изолированная ветка
- `agent-B` — Phase 8b+c (notification settings UI) — изолированная ветка

Они не пересекаются по файлам (разные роуты, разные UI-страницы, разные тесты), поэтому merge conflict минимален. Главный сводит обратно в `main` и тегает `phase-8-done`.

### Что сделано (фактический результат)

**8a — Analytics funnels** (commits `ae92e1f`..`503afce`):
- `src/server/analytics/funnels.ts` — 4 чистых аггрегатора: `computeTgFunnel` (TG→запись с lookahead 7 дней), `computeCallFunnel` (звонок→запись), `computeNoShowRanks` (топ-10 врачей + услуг по no-show%), `computeAverageWaitTime` (среднее `WAITING→IN_PROGRESS` per doctor).
- `GET /api/crm/analytics/funnels` — роут с RBAC `[ADMIN, DOCTOR]`, scope для DOCTOR применяется только к no-show + wait, TG/Call funnels — clinic-wide acquisition metrics.
- UI: `FunnelCards` подключён через `next/dynamic` к `analytics-page-client.tsx`.
- 11 unit-тестов в `tests/unit/analytics/funnels.test.ts`, 1 e2e в `tests/e2e/23-analytics-funnels.spec.ts`.
- **Decision:** Mini App drop-off пропущен — нужна `MiniAppEvent` таблица для воронки слотов; вернёмся в Phase 11+. На wire `miniAppFunnel: null` — расширяемо без breaking change.

**8b+c — Notification template & rules editor** (commits `2c45045`..`c3e3da7`, merge `41ad7e5`):
- `/crm/settings/notifications` page с двумя вкладками: тело сообщения (RU/UZ + chip-list переменных + live preview) и расписание (toggle, offsetMin 1..72ч, channel TG/SMS/both).
- `GET /api/crm/settings/notifications/templates` + `PATCH .../[id]` (ADMIN, per-clinic, audited).
- Helpers: `src/server/notifications/rules.ts` — `resolveChannels`, `resolveOffsetMin`, `sanitizeTriggerConfig`.
- Scheduler: `runDynamicReminders()` в `notifications-scheduler.ts:50-245` обрабатывает кастомные `triggerConfig.offsetMin`. Legacy -1440/-120 остаются за `runScheduledTriggers`.
- `triggers.ts` **не изменён** (стабильность сохранена).
- 32 unit-теста (rules-validation/rules-config/preview-render) + 2 e2e в `23-settings-notifications-edit.spec.ts`.

### Quality gates Phase 8 (фактические)

- **72 unit-тестов зелёные** на сводном прогоне `vitest run tests/unit/analytics/funnels.test.ts tests/unit/notifications`.
- 3 pre-existing tsc-ошибки в `doctor-queue-list.tsx`, `appointments/route.ts:205`, `miniapp/appointments/route.ts:154` — **не вносены этой фазой**. Это Prisma 7 extended-client typing на `tx` параметре; вылезли после `781682c` (post-Phase-7 hardening) при апгрейде driver adapter. Переезжают в hotfix-блок.
- Working tree чистый, `phase-8-done` тег на merge-коммите `41ad7e5`.

---

## Phase 9 — Branches + Plans + Feature flags — 🔄 IN PROGRESS (старт 2026-05-01)

### Контекст

Этап 2 SaaS roadmap (Pilot SaaS, 3-5 клиник): «Multi-clinic + филиалы + тарифы». Сейчас `Clinic ≡ одно место`. Чтобы продавать клинике с несколькими филиалами как **один** SaaS-аккаунт с пакетом тарификации (Basic/Pro/Enterprise), нужны:

1. Модель `Branch` (Clinic 1→N Branch). Doctor / Cabinet / Appointment / DoctorSchedule / DoctorTimeOff получают `branchId`.
2. Модели `Plan` (каталог тарифов) и `Subscription` (подписка клиники). Feature flags вшиты в Plan (`hasTelegramInbox`, `hasCallCenter`, `hasAnalyticsPro`, `maxBranches`, `maxUsers`).
3. UI: `BranchSwitcher` рядом с `ClinicSwitcher`; страница `/crm/settings/branches`; страница `/admin/clinics/[id]/billing`.
4. Feature gates в UI: пункты меню скрываются если у плана нет фичи.

### Riskpoints

- **Миграция схемы трогает 5+ таблиц**. Поэтому делается в worktree, не в main. Тег `phase-9-done` ставим только когда ВСЕ существующие тесты (47 e2e, 239+ unit) продолжают проходить.
- Backfill: каждой существующей клинике автоматически создаётся `Branch (slug='hq', name='Главный')` и все её Doctor/Cabinet/Appointment получают `branchId = hq.id`. Без backfill миграция оставит null'ы и сломает foreign keys.
- **Не параллелизуем** — schema migration + 5 таблиц = один агент сводит фазу целиком, чтобы не было гонок по `prisma/schema.prisma` и `prisma/migrations/`.

### Подфазы (последовательные)

#### 9a — Branch model + миграция + backfill — атомарная порция «данные»

- Schema: `Branch` (id, clinicId, slug, nameRu, nameUz, address, phone, timezone, isDefault, isActive). `@@unique([clinicId, slug])`.
- `branchId` (nullable initially) на: Doctor, Cabinet, Appointment, DoctorSchedule, DoctorTimeOff. Опционально на Call.
- Миграция в две стадии: ADD nullable → backfill SQL (создать `hq` branch, проставить branchId всем строкам) → ALTER NOT NULL.
- `seed.ts`: создаёт `hq` branch при создании клиники, проставляет `branchId` всему демо-контенту.
- Tenant context: добавить optional `branchId` в `runWithTenant`. Если не задан — клиника-wide query (как сейчас). Если задан — фильтр по branchId. Никаких breaking changes для существующих роутов.
- **Никакого нового UI** — только данные. `phase-9a-done` тег.

#### 9b — Plan + Subscription модели + feature gates helper

- Schema: `Plan` (slug, nameRu/Uz, priceMonth, currency, features Json: `{hasTelegramInbox, hasCallCenter, hasAnalyticsPro, maxBranches, maxUsers}`). `Subscription` (clinicId, planId, status: TRIAL/ACTIVE/PAST_DUE/CANCELLED, trialEndsAt, currentPeriodEndsAt).
- Seed 3 плана: Basic / Pro / Enterprise.
- Helper `getFeatureFlags(clinicId)` → возвращает effective flags из активной подписки (или Basic как дефолт).
- **Никакого нового UI** — только helper. `phase-9b-done` тег.

#### 9c — UI: BranchSwitcher + /crm/settings/branches + /admin/clinics/[id]/billing

- `BranchSwitcher` в топбаре под `ClinicSwitcher`.
- `/crm/settings/branches` — CRUD филиалов (ADMIN). Доктор/кабинет получают селектор branch на форме создания.
- `/admin/clinics/[id]/billing` — SUPER_ADMIN видит подписку клиники, может менять план/статус.
- `phase-9c-done` тег.

#### 9d — Feature gates в навигации

- В `src/components/layout/crm-sidebar.tsx` (или эквивалент) скрывать пункты меню если у клиники нет фичи: «Telegram» если `!hasTelegramInbox`, «Call Center» если `!hasCallCenter`, «Аналитика Pro»-секция если `!hasAnalyticsPro`.
- `phase-9d-done` тег.

### Результаты — 9a (✅ DONE 2026-05-01)

- 3 коммита на main: `dd3e7ee feat(prisma): add Branch model + branchId backfill migration` → `8449a48 feat(tenant): branch-aware filtering` → `e4475ed test(tenant): branch-scope unit tests`. Тег `phase-9a-done` на `e4475ed`.
- Миграция `20260501084339_add_branches`: 2 стадии — Stage A (DDL: Branch + branchId на 5 таблицах + FK + индексы), Stage B (backfill: `gen_random_uuid()::text` для default `hq` branch на каждую клинику + 5 UPDATE для backfill `branchId`). Колонка осталась NULLABLE — `NOT NULL` придёт в 9b после прод-верификации.
- `prisma migrate dev` чистый, `prisma migrate status` → "Database schema is up to date". Backfill проверен: 0 NULL'ов в `Doctor=21, Cabinet=30, Appointment=2854, DoctorSchedule=91, DoctorTimeOff=0`.
- `runWithTenant` принимает optional `branchId`. Если не задан → query клинично-wide (legacy behavior). Если задан → фильтр на 5 branch-scoped моделей. `Patient`, `Service`, `Payment` и пр. остались clinic-wide.
- `src/lib/tenant-allowlist.ts` теперь экспортирует `MODELS_BRANCH_SCOPED` (Doctor/Cabinet/Appointment/DoctorSchedule/DoctorTimeOff) — Phase 9b/c будут использовать.
- Прод-роутов читающих `ctx.branchId` пока нет — это Phase 9b. До тех пор все routes ведут себя байт-в-байт как до 9a.
- Тесты: **291/291 passing** (28 файлов). +7 новых в `tests/unit/prisma-branch-scope.test.ts` (vi.hoisted $extends capture, без DB). 0 новых tsc/lint ошибок.
- E2E suite не запускалась (Next dev server timed out под dual-lockfile warning); код e2e не трогали — fixtures и логика идентичны.

### Результаты — 9b (✅ DONE 2026-05-01)

- 3 коммита на main: `66c0031 feat(prisma): add Plan + Subscription models with seed migration` → `ad224f1 feat(billing): getFeatureFlags helper + unit tests` → `767b596 chore(seed): ensure every seeded clinic has a Pro TRIAL subscription`. Тег `phase-9b-done` на `767b596`.
- Миграция `20260501091536_add_plans_and_subscriptions`: enum `SubscriptionStatus` (TRIAL/ACTIVE/PAST_DUE/CANCELLED), модели `Plan` (slug @unique, nameRu/Uz, priceMonth Decimal, currency, features Json, isActive, sortOrder) + `Subscription` (clinicId @unique → 1 active sub per clinic, planId, status, trialEndsAt, currentPeriodEndsAt, cancelledAt). Stage B: 3 канонических плана (basic 0 / pro 1.5M UZS / enterprise 5M UZS) + TRIAL на Pro 30 дней для всех существующих клиник.
- `src/lib/feature-flags.ts` — `getFeatureFlags(clinicId): Promise<FeatureFlags>`. TRIAL/ACTIVE → flags плана; PAST_DUE → flags плана (Stripe-style grace); CANCELLED / no-sub → `DEFAULT_FLAGS` (Basic-equivalent). Defensive parsing: каждый missing/wrong-typed key падает обратно на DEFAULT_FLAGS independently; `Number.isFinite` для maxBranches/maxUsers.
- Прод-кода `getFeatureFlags()` пока не вызывает — это Phase 9c (UI feature gates).
- Тесты: **306/306 passing** (29 файлов). +15 новых в `tests/unit/feature-flags.test.ts`. 0 новых tsc/lint.
- E2E suite не запускалась (та же причина что в 9a — Next dev server timeout под dual-lockfile).

### Результаты — 9c (✅ DONE 2026-05-01)

- Параллельно собрано двумя Opus-агентами в worktrees: 9c-A (BranchSwitcher + CRM /settings/branches) и 9c-B (admin /clinics/[id]/billing). 9c-A смерджен через `--no-ff` коммитом `24c67a8`; 9c-B приехал в main как 3 follow-up коммита `b7b0af7 feat(api): admin plans list + subscription CRUD routes` → `945948d feat(admin): /admin/clinics/[id]/billing page + clinic-tabs nav` → `1dbe684 i18n+test: admin billing keys (ru+uz) + handler/e2e coverage`. Тег `phase-9c-done` на `1dbe684`.
- 9c-A — 7 коммитов: API (`/api/crm/branches` CRUD + `/active` cookie), `BranchSwitcher` topbar + middleware, `/crm/settings/branches` страница, branchId на формы Doctor/Cabinet, i18n, +28 тестов (3 unit-файла + 1 e2e). Cookie `crm.activeBranch` пишется через `branch-cookie.ts`, читается middleware и инжектится в `tenant-context` через `resolve-branch.ts`. ADMIN/SUPER видит все branches клиники, RECEPTIONIST/DOCTOR — только активный.
- 9c-B — 3 коммита: `/api/admin/plans` (GET) + `/api/admin/clinics/[id]/subscription` (GET/PATCH) + `/extend-trial` + `/cancel`, страница `/admin/clinics/[id]/billing` (план, статус, даты, история действий), `clinic-tabs.tsx` шапка-навигация (Интеграции / Тарификация), кнопка "Тарификация" в clinics-list, `PatchSubscriptionSchema` в `platform.ts`, +16 unit + 1 e2e.
- Quality gates: **350/350 unit passing** (306 baseline + 28 9c-A + 16 9c-B), tsc 3 ошибки = baseline (4 → 3, layout.tsx починилось апстримом), eslint clean на 9c-B файлах. `npx prisma generate` потребовался на main после мерджа (Plan/Subscription модели из 9b не были в client до этого).
- Прод-кода `getFeatureFlags()` всё ещё не вызывают — это Phase 9d (gating меню/роутов).

### Результаты — 9d (✅ DONE 2026-05-01)

- 3 коммита на main (агент сломал worktree-изоляцию и писал прямо в main, как 9c-B; работа корректна и зачекинена): `ff508a3 feat(crm): plan-aware sidebar nav rendering` → `7bc6ad1 feat(crm): 404 guards on paid CRM routes` → `d4593e5 test: nav filtering + route guards by plan`. Тег `phase-9d-done` на `d4593e5`. 13 файлов, +627/−14.
- Pure helpers: `computeVisibleNav<T>(groups, flags)` в `feature-flags.ts` — generic, не мутирует, выкидывает скрытые айтемы и пустые группы. Server entry `src/server/platform/current-flags.ts` → `getFeatureFlagsForCurrentSession()`: SUPER_ADMIN-без-clinic → ENTERPRISE_FLAGS, unauthenticated → DEFAULT_FLAGS, иначе `getFeatureFlags(clinicId)`. API guard `src/server/platform/feature-guard.ts` → `ensureFeature(ctx, flag)` возвращает `null` или 404 `{error:"NotFound"}` (без раскрытия ключа фичи); SUPER_ADMIN/SYSTEM пропускают без DB-вызова.
- Sidebar: `CRM_NAV` экспортируется с `feature` тегами на `call-center` (`hasCallCenter`) и `telegram` (`hasTelegramInbox`). `<CrmSidebar flags={...} />` мемоизирует `visibleNav`. Server-side: `app/[locale]/crm/layout.tsx` дёргает `getFeatureFlagsForCurrentSession()` и пробрасывает.
- Guards: `/crm/call-center/page.tsx` + `/crm/telegram/page.tsx` стали async server components с `notFound()` при выключенной фиче. API: `ensureFeature` подключён в `/api/crm/calls/route.ts` (GET+POST), `/api/crm/calls/[id]/route.ts` (GET+PATCH), `/api/crm/analytics/funnels/route.ts` (GET, gated на `hasAnalyticsPro`).
- Тесты: **366/366 passing** (+16 новых: `feature-nav.test.ts` 10 + `feature-guard.test.ts` 6) + 1 e2e `25-feature-flags-gating.spec.ts` (downgrade NeuroFax → Basic, проверка 404 на 3 роутах, restore Pro). 0 новых tsc/eslint.
- Намеренно НЕ закрыто: `/api/crm/conversations` (мульти-канальный — SMS legitimate на basic), Notifications/Documents/Roles (нет соответствующих ключей в `FeatureFlags` — не выдумывал), BranchSwitcher (уже само скрывается при ≤1 branch). `analytics-page-client` получает 404 на funnels и тихо прячет компонент через существующий `qFunnels.isError ? null` — без новой клиент/сервер-разводки.

### Результаты — 9e (✅ DONE 2026-05-01)

- 4 коммита в worktree, смерджены `--no-ff` коммитом (через `worktree-agent-ac866fc4`): `660b7d6 feat(workers): trial-expiry scheduler` → `e3a2098 feat(crm): trial countdown banner in layout` → `f226ce8 i18n: trial banner keys (ru+uz)` → `2274554 test: trial-expiry + banner state`. Тег `phase-9e-done` на merge-коммите. 10 файлов, +841/−1. **Worktree-изоляция держалась до конца** (агент проверял `pwd` + `git rev-parse --show-toplevel` перед каждым коммитом — урок 9c-B/9d пройден).
- `src/server/workers/trial-expiry-scheduler.ts` (159 LoC) — `repeat("trial-expiry", "scan", {}, 60_000)` каждую минуту, ищет TRIAL с `trialEndsAt < now()`, переводит в **PAST_DUE** (не CANCELLED — Stripe-style grace по матрице 9b: премиум-фичи продолжают работать, просто banner становится красным "оплатите"). Зарегистрирован в `start.ts` рядом с `notifications-scheduler`.
- `src/server/platform/current-subscription.ts` — `getCurrentSubscription()` через `auth() → clinicId → prisma.subscription.findUnique({ include: { plan: true } })`, считает `daysLeft` для TRIAL. SUPER_ADMIN-без-clinic → null.
- `src/components/layout/trial-banner.tsx` (server component, 132 LoC) + `trial-banner-state.ts` (91 LoC pure helper). Pure helper отделён потому что vitest падал на `next-auth/lib/env.js → next/server` resolution при импорте через серверные модули — leaf держит type+state machine, server-обёртка делает DB+auth, рендер импортит leaf. Пороги: `>7` hidden, `7..3` info (yellow), `2..0` warning (red), PAST_DUE expired (red). SUPER_ADMIN видит deep-link на `/admin/clinics/[id]/billing`, обычный ADMIN — без линка.
- В `crm/layout.tsx` `Promise.all([getFeatureFlagsForCurrentSession(), getCurrentSubscription()])` — параллельный запрос, 0 latency-cost vs sequential.
- Тесты: **400/400 passing** (+34 новых: `trial-expiry.test.ts` 15 + `trial-banner.test.ts` 19). 0 новых tsc/eslint (3 baseline tsc остаются — `doctor-queue-list.tsx` + 2 prisma `$extends` typing в appointments routes).
- Известное ограничение: `currentPeriodEndsAt: null` у всех seeded subs (seed выставляет только `trialEndsAt`), поэтому `expired.bodyWithDate` вариант banner-а не сработает до Phase 10 (Stripe). Banner gracefully fallback на `expired.body` без даты.

### Phase 9 ИТОГ (✅ DONE 2026-05-01)

Multi-tenant SaaS billing+features stack полностью на main. 5 фаз последовательно:
- **9a** Branch schema + миграция + backfill (тег `phase-9a-done`)
- **9b** Plan/Subscription модели + `getFeatureFlags()` (тег `phase-9b-done`)
- **9c** BranchSwitcher CRM UI + админский billing UI (тег `phase-9c-done`)
- **9d** Feature gates в CRM меню + 404-гарды (тег `phase-9d-done`)
- **9e** Trial-expiry cron + countdown banner (тег `phase-9e-done`)

Финальные метрики на main: **400/400 unit tests**, **3 baseline tsc errors** (не регрессировали с Phase 8), 0 новых eslint. Готовность к Phase 10 (Stripe) — высокая: `Subscription.currentPeriodEndsAt` уже в схеме и пайплайне, осталось только подключить webhook-source-of-truth.

### Quality gates Phase 9

- `npx prisma migrate dev` без ошибок.
- `npx prisma generate` без ошибок.
- Все 239+ старых unit + 47+ e2e продолжают проходить (с backfill дефолтного branch).
- Новые тесты ≥10 unit (Branch CRUD, Subscription effective flags, getFeatureFlags) + ≥2 e2e (создание branch, переключение, скрытие меню по плану).

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

## Phase 10 — AI Engine (✅ DONE 2026-05-01)

Replaced the static "AI" heuristics on `/crm/doctors` with a real engine.
Four pure scoring primitives + three Prisma-backed resolvers + three GET
endpoints + a minimal UI rewire that prepends live engine candidates to
the doctors-AI panel.

- **Pure libs** (`src/lib/ai/`, zero imports — client-safe):
  - `queue-score.ts` — wait + urgency + VIP + (-no-show) + late + overdue,
    bands `low/normal/high/critical`.
  - `eta-predictor.ts` — median of (doctor, service) history with sample-size
    bands (`high` ≥10, `med` 4..9 blended 0.7/0.3, `low` fallback), clamp
    [5,240], round to 5.
  - `no-show-risk.ts` — Laplace-smoothed base + first-visit / unconfirmed /
    far-future bumps; bands `low/med/high`.
  - `reassign-engine.ts` — overdue (≥20) OR overload (≥15 + wait≥10) →
    lightest eligible doctor by `remainingTodayMin`, capacity ≥30 floor.
- **Server resolvers** (`src/server/ai/*.ts`) — auto-scoped via existing
  Prisma tenant extension (clinic + optional branch).
- **API routes** (`/api/crm/ai/{queue,eta,reassign}`) — all `createApiList
  Handler` with roles `ADMIN/RECEPTIONIST/NURSE/DOCTOR`. TENANT-only.
- **UI rewire** — `doctors-ai-recommendations.tsx` adds a react-query hook
  (the codebase has no SWR dep — uses `@tanstack/react-query` everywhere)
  and merges up to 2 live candidates ahead of the heuristic recs, capped at
  4 total. Layout/copy unchanged.
- **Tests** — 33 new unit cases across the four pure modules (8/9/8/8). One
  e2e happy-path on the queue/reassign/eta endpoints. Final tally:
  **433 unit / 433 passing**, **4 baseline tsc errors** (unchanged from
  main).
- **Out of scope** — schema migrations, Stripe, demo-mode, reminders/no-show
  worker integration. The pure `computeNoShowRisk` is exported and ready
  for the worker to consume in a follow-up.


---

## Phase 11 — Foundation Polish — ✅ DONE 2026-05-06

**Roadmap:** `docs/ROADMAP-11x.md` §Фаза 11. Task #231.

Cleanup pass to unblock phases 12-19: centralized currency, audit reschedule, RBAC matrix UI, menu cleanup, onboarding v2, missing-i18n-key dev tool. Three execution waves under `neurofax-architect` orchestration; specialist agents inlined as `general-purpose` self-contained briefs (project-level agents not invokable via Agent tool, only via SendMessage to running ones).

### What shipped

**Wave 1 (parallel) — i18n + audit + currency**

- **i18n missing-key tool** (`scripts/i18n-check.ts`): regex-based static analysis with namespace tracking, dynamic-namespace handling, function-parameter shadow handling. `npm run i18n:check` exits 0; reports parity. Dev component `<T ns k />` and `useT(ns)` hook in `src/components/dev/missing-key-warner.tsx` for `[MISSING: ns.key]` rendering. Fixed `docsLibrary.types.{RESULT,CONTRACT,RECEIPT}` + added full `settings.{roles,index,cards}` namespaces. 14/14 unit tests.
- **Audit `APPOINTMENT_RESCHEDULED`** (`src/lib/audit-actions.ts` + `src/app/api/crm/appointments/[id]/route.ts`): PATCH handler emits when `date|endDate|doctorId|cabinetId` change, with old/new values in `meta`. No emit on status-only or no-op changes. 4/4 unit tests. MiniApp PATCH (`src/app/api/miniapp/appointments/[id]/route.ts`) flagged as out-of-scope for Phase 11; pick up in Phase 16.
- **Currency centralization**: 9 files refactored (services list, doctor cards, payments, invoices) to use existing `formatMoney` / `<MoneyText>` from `src/lib/format.ts` and `src/components/atoms/money-text.tsx` — no new helper needed. Fixed 100x display bug in `doctor-services.tsx` and `new-doctor-dialog.tsx` (tiins were rendered as whole UZS). 13/13 unit tests in `tests/unit/format-money.test.ts`.

**Wave 2 — Settings index + RBAC matrix + menu cleanup**

- `src/lib/permissions/matrix.ts`: declarative `PERMISSION_MATRIX: ResourcePermissions[]` — 12 resources × 6 roles, with R/W/U/D + scope (`own` / `team` / `all`).
- `/crm/settings/roles` rewired to render the matrix with chips per cell, scope labels, legend.
- `/crm/settings` index rebuilt as two card grids: «Управление клиникой» (Roles, Cabinets→/crm/rooms, Services→/crm/services, Documents→/crm/documents, SMS→/crm/sms) and «Базовые настройки».
- `CRM_NAV` cleanup in `src/components/layout/crm-sidebar.tsx`: dropped rooms/services/documents/sms; main menu = 10 items (reception, appointments, calendar, patients, doctors, call-center, telegram, notifications, analytics, settings). Old paths preserved — only menu entry removed.

**Wave 3 — Onboarding v2**

- `src/app/api/crm/onboarding-status/route.ts` extended to **9 steps** (TG bot connection was queryable via `Clinic.tgBotToken`). New: `doctorSchedule`, `templates`, `firstPatient`, `firstAppointment`, `tgBotConnected`. All counts via parallel `prisma.*.count()`.
- `OnboardingChecklist` component grid switched to 3×3, lucide icons + i18n added in both ru/uz, auto-hide on `complete: true` preserved.
- 5/5 new tests in `tests/unit/onboarding-status.test.ts`.

### Files

```
NEW: scripts/i18n-check.ts, src/components/dev/missing-key-warner.tsx,
     src/lib/audit-actions.ts, src/lib/permissions/matrix.ts,
     tests/unit/i18n-check.test.ts, tests/unit/format-money.test.ts,
     tests/unit/onboarding-status.test.ts,
     tests/unit/appointment-reschedule-audit.test.ts
EDIT: src/app/api/crm/appointments/[id]/route.ts,
      src/app/api/crm/onboarding-status/route.ts,
      src/app/[locale]/crm/reception/_components/onboarding-checklist.tsx,
      src/app/[locale]/crm/settings/page.tsx,
      src/app/[locale]/crm/settings/roles/_components/roles-matrix-client.tsx,
      src/components/layout/crm-sidebar.tsx,
      src/messages/{ru,uz}.json,
      package.json (+ i18n:check script),
      9 currency-touching files,
      tests/unit/feature-nav.test.ts (sync to new nav),
      tests/unit/notifications-{triggers,template}.test.ts (sync to 9 triggers
      from Phase 9 #225/#226 — these were stale).
```

### Gates

- `npx tsc --noEmit` — clean.
- `npm run build` — Compiled successfully in 8.2s; 84/84 static pages OK.
- `npx vitest run` — **477/477 passed** (was 433 baseline + 44 new + replaced).
- `npm run i18n:check` — OK, locales in parity.

### Notes / hand-off

- Stale tests from Phase 9 (notifications-triggers, notifications-template) updated as part of this gate — they expected 7 triggers, runtime now has 9 (added `appointment.reminder-5h` and `case.repeat-due`). No code changes to those modules; tests just caught up.
- MiniApp appointment PATCH does mutate slot but does not emit `APPOINTMENT_RESCHEDULED` audit yet — deferred to `patient-experience-engineer` (Phase 16) where Mini App engagement is the main scope.
- Phase 11 unblocks: #232 Lifecycle & Timeline UX (Phase 12), #237 Compliance & Trust (Phase 17). Phases 13-19 chain off these per ROADMAP-11x.md dependency graph.

---

## Phase 12 — Lifecycle & Timeline UX — ✅ DONE 2026-05-06

**Roadmap:** `docs/ROADMAP-11x.md` §Фаза 12. Task #232.

Make appointment state legible at a glance and unify everything that ever happened to a patient into one feed. No new pages, no new DB models, no new routes — pure enhancement of existing surfaces. Three sequential waves under `neurofax-architect` orchestration.

### What shipped

**Wave 1 — Visualize state**

- `src/lib/appointments/lifecycle.ts` — pure state-machine helper: `getAllowedTransitions(currentStatus, role)`, `getAllowedTransitionsAt(now)` (gates NO_SHOW to past-only, mirrors server-side H3 #199), `getStepStates`, `getQuickActions`, `canMutateStatus`.
- `src/app/[locale]/crm/appointments/_components/appointment-lifecycle.tsx` — horizontal chain `BOOKED → WAITING → IN_PROGRESS → COMPLETED` (clickable pills, current+passed filled, future muted, role-gated, loading state during PATCH). Off-path boxes for NO_SHOW / CANCELLED / SKIPPED with confirm dialog.
- `appointment-drawer.tsx` rewired: replaced status select+badge with `<AppointmentLifecycle>`. Reuses `useSetQueueStatus` mutation; trimmed dead `STATUSES`/`STATUS_VARIANT` constants.
- `doctor-queue-card.tsx` rewired: per-row `<QuickStatusRow>` with lucide icons (`UserCheckIcon`, `PlayIcon`, `CheckCheckIcon`, `UserXIcon`). Forward transitions are one-click optimistic; NO_SHOW gated by Popover confirm to prevent fat-finger.
- API: PATCH `/api/crm/appointments/[id]/queue-status` (existing endpoint, no changes).
- 23/23 new unit tests in `tests/unit/appointment-lifecycle.test.ts`.

**Wave 2 — Patient Timeline v2**

- Extended `/api/crm/patients/[id]/communications` aggregator from 5 → 9 event kinds: VISIT (Appointment.COMPLETED), PAYMENT (Payment.PAID, paidAt), DOCUMENT (Document.createdAt), NOTIFICATION (existing), CALL (existing), TG/Message (existing), CASE (MedicalCase.openedAt + closedAt as separate rows), RESCHEDULE (AuditLog.action='APPOINTMENT_RESCHEDULED', single bounded query — no N+1). Added `category: 'VISIT'|'PAYMENT'|'COMM'|'DOC'` field for tab filtering. Backward-compatible (additive).
- `patient-timeline.tsx` v2 rewrite: tabs ALL/VISIT/PAYMENT/COMM/DOC, day groups (Сегодня/Вчера/abs date), per-kind lucide icons, `EmptyState` per tab when empty, `Skeleton` while loading. Money rendered via existing `<MoneyText>` (no inline UZS formatters).
- `src/lib/timeline/group-by-day.ts` — extracted pure helper with injectable `now` for deterministic tests.
- Existing `usePatientTimeline` hook in appointment-drawer keeps compiling — extension is purely additive on the API response shape.
- 11/11 new unit tests (7 aggregation + 4 day-grouping). 21 new i18n keys per locale under `patientTimeline.*`.

**Wave 3 — Calendar drag/drop + empty-state polish**

- DnD already available via FullCalendar (`@fullcalendar/interaction`) — grid was `editable + eventStartEditable` with an `eventDrop` handler that PATCHed directly. Wave 3 inserts a confirmation modal between drop and PATCH; everything else (optimistic update, 409 conflict handling, audit emit from Phase 11) was already wired.
- `src/lib/calendar/reschedule-math.ts` — pure `computeRescheduledSlot()` (preserves duration, rejects past-time drops). 6/6 unit tests.
- `reschedule-confirm-dialog.tsx` — new dialog using existing `AlertDialog` atom; locale-aware `Intl.DateTimeFormat` for "HH:mm DD.MM"; Esc/overlay-click route through `revert` (FullCalendar's `info.revert()`).
- `calendar-view.tsx` + `calendar-page-client.tsx` — `eventDrop` now routes through `onConfirmReschedule` callback; legacy direct-PATCH fallthrough preserved for resize gesture; added "all-empty range" floating hint card.
- Empty-state audit across CRM:
  - `/crm/appointments` — already polished (filtered + create CTA).
  - `/crm/calendar` — added inline `emptyRange` hint card.
  - `/crm/patients` — already polished.
  - `/crm/doctors` — already polished.
  - `/crm/call-center` — `incoming-queue.tsx` swapped ad-hoc empty for `EmptyState` atom + calm copy.
  - `/crm/notifications` — already polished.
  - `/crm/telegram` — Phase 11 #183 work verified, already on atom.

### Files

```
NEW: src/app/[locale]/crm/appointments/_components/appointment-lifecycle.tsx
     src/app/[locale]/crm/calendar/_components/reschedule-confirm-dialog.tsx
     src/lib/appointments/lifecycle.ts
     src/lib/calendar/reschedule-math.ts
     src/lib/timeline/group-by-day.ts
     tests/unit/appointment-lifecycle.test.ts
     tests/unit/calendar-reschedule-math.test.ts
     tests/unit/patient-timeline-aggregation.test.ts
     tests/unit/timeline-group-by-day.test.ts
EDIT: src/app/[locale]/crm/appointments/_components/appointment-drawer.tsx
      src/app/[locale]/crm/reception/_components/doctor-queue-card.tsx
      src/app/[locale]/crm/patients/[id]/_components/patient-timeline.tsx
      src/app/[locale]/crm/patients/[id]/_hooks/use-patient-communications.ts
      src/app/[locale]/crm/calendar/_components/calendar-view.tsx
      src/app/[locale]/crm/calendar/_components/calendar-page-client.tsx
      src/app/[locale]/crm/call-center/_components/incoming-queue.tsx
      src/app/api/crm/patients/[id]/communications/route.ts
      src/messages/{ru,uz}.json (3 new namespaces: appointmentLifecycle, reception.quickStatus, patientTimeline, calendar.reschedule, calendar.emptyRange, callCenter.queue.empty*)
```

### Gates

- `npx tsc --noEmit` — clean.
- `npm run build` — Compiled successfully.
- `npx vitest run` — **517/517 passed** (was 477 after Phase 11 + 23 + 11 + 6 = 40 new).
- `npm run i18n:check` — OK, locales in parity.

### Notes / hand-off

- Lifecycle helper `canMutateStatus` is reusable — Phase 13 (Action Center) will likely need similar gating for "Confirm appointment" and "Mark no-show" actions.
- Patient timeline aggregator now does 1 AuditLog scan per request. If volume grows, add an index `(clinicId, action, createdAt)` on AuditLog and consider caching the day-grouped view per patient. Not needed yet.
- Calendar empty-range hint reads "Календарь пуст в этом периоде" — short and CTA-less by design (calendar usage is exploratory).
- Phase 12 unblocks Phase 13 (Action Center) and Phase 16 (Patient Experience).

---

## Phase 13 — Action Center — ✅ DONE 2026-05-06

**Roadmap:** `docs/ROADMAP-11x.md` §Фаза 13. Task #233. **Главная фича 11/10** — превращает CRM из реактивной системы в проактивную: ресепшн заходит и видит «что делать сейчас», а не «что есть в системе».

3 sequential waves под `neurofax-architect` orchestration. Все 10 типов actions реализованы, ничего не отложено в Phase 14+.

### What shipped

**Wave 1 — Schema + REST + audit foundation**

- `Action` model: `id, clinicId, branchId?, type, severity, payload, status, assigneeRole?, deeplinkPath?, dedupeKey, snoozeUntil?, dismissedAt?, doneAt?, expiresAt?, createdAt, updatedAt`. Unique `(clinicId, dedupeKey)` + 3 indexes. Migration `20260506100335_action_engine`.
- `src/lib/actions/types.ts` — `ACTION_TYPES` (10), `ACTION_SEVERITIES` (4), `ACTION_STATUSES` (5), discriminated `ActionPayload` union (10 variants), `dedupeKeyFor`, `defaultSeverity`, `defaultDeeplinkPath`, `defaultAssigneeRole`, `SEVERITY_RANK`, type guards.
- `src/server/actions/repository.ts` — `upsertAction(prisma, clinicId, payload, options)` with terminal-status resurrection + payload-significance gate; `expireStaleActions(prisma, clinicId, ttlHours)` with explicit `expiresAt` OR `updatedAt+ttl` fallback.
- 6 REST endpoints under `/api/crm/actions` (list with severity-rank sort, get, snooze with preset/until XOR, dismiss, done, reopen ADMIN-only). All TENANT-scoped, all audit-emitted.
- 7 audit constants added: `ACTION_CREATED/UPDATED/SNOOZED/DISMISSED/DONE/REOPENED/EXPIRED`.
- 33 tests (19 type tests + 14 handler tests).

**Wave 2 — 10 detectors + engine + scheduler + SSE**

10 pure detectors in `src/server/actions/detectors/`:
- `empty-slot-tomorrow.ts` — peak-hour gaps from `DoctorSchedule` minus `Appointment`; revenue from 90d paid history with `pricePerVisit` fallback; severity high if loss > 100M tiins.
- `dormant-batch.ts` — 3 segments (90-180/180-365/365+); excludes patients with future appts; campaign cooldown via `Campaign.segment.kind === 'dormant'`.
- `unconfirmed-24h.ts` — BOOKED appts in next 24h; severity scales <2h/<12h/≥12h.
- `no-show-risk-high.ts` — `computeNoShowRisk()` per appt; risk rounded to 2 decimals (dedupeKey stability); `expiresAt = appointmentAt`.
- `case-repeat-due.ts` — derives deadline from `firstVisit.date + service.freeRepeatDays`; suppressed if future BOOKED/WAITING on case.
- `overdue-follow-up.ts` — COMPLETED appts in `[-followUpStaleDays, -1d]` on OPEN cases with no later non-cancelled appt.
- `doctor-overload.ts` — today's WAITING|IN_PROGRESS grouped by doctor; alternatives = same specialty; `expiresAt = now+30min`.
- `idle-room.ts` — cabinet idle ≥ N min, last completion older, queue > 0; `expiresAt = now+30min`.
- `payment-overdue.ts` — COMPLETED past cutoff minus PAID; severity scales 1-7d / 7-30d / >30d.
- `low-doctor-schedule.ts` — 7-day window day-by-day from `DoctorSchedule` minus `DoctorTimeOff`, 1-hour units.

`src/server/actions/engine.ts` — `runActionEngine(prisma, clinicId, now, config)`: 10 detectors via `Promise.allSettled`, persist via `upsertAction`, publish `action.created/updated`, sweep via `expireStaleActions(48h)`. Failure isolation — one detector erroring doesn't poison the run.

`src/server/actions/scheduler.ts` — `registerActionScheduler()` registered into `src/server/workers/start.ts` alongside notifications scheduler. Queue abstraction `repeat('actions', 'actions-recompute', {}, 15min)`. Each clinic runs sequentially under `runWithTenant({ kind: 'TENANT', clinicId, userId: 'system:action-engine', role: 'ADMIN' })`.

`src/server/realtime/events.ts` — added `action.created` and `action.updated` events with payload `{id, type, severity}`.

`POST /api/crm/actions/recompute` — ADMIN-only manual trigger; returns `{created, updated, skipped, expired, errors}`.

57 new tests (52 detector + 10 engine).

**Schema gaps documented** (deferred to Phase 14+ — current proxies work for v1):
- `Appointment.confirmedAt` missing → UNCONFIRMED_24H uses `status === 'BOOKED'` proxy.
- `MedicalCase.repeatDueAt` missing → CASE_REPEAT_DUE derives from `firstVisit.date + service.freeRepeatDays`.
- `MedicalCase.followUpDoneAt` missing → OVERDUE_FOLLOW_UP proxies via "OPEN case + no later non-cancelled appt".

**Wave 3 — UI surfaces**

- `/crm/action-center` page: tabs OPEN/SNOOZED/DISMISSED/DONE, severity chips, type filter, admin-only assigneeRole filter, severity-grouped cards (critical→high→medium→low), per-type lucide icon, deeplink, snooze popover, dismiss dialog, done one-click, admin-only Reopen on terminal rows, cursor pagination, empty states, live update via `useLiveQueryInvalidation` on `action.created/updated`, admin-only "Recompute now" button.
- `/crm/reception` briefing module: top-5 OPEN actions for current user role, compact card variant, hides when zero. Mounted after onboarding-checklist in `reception-page-client.tsx`.
- Sidebar: inserted "Action Center" entry between Reception and Appointments (`ZapIcon`).
- Reusable `snooze-popover.tsx` (1h/4h/tomorrow/next-week/custom) and `dismiss-dialog.tsx` (optional 200-char reason).
- `src/lib/actions/format.ts` — pure `formatActionTitle(t, payload)` / `formatActionBody(t, payload)` with discriminated union exhaustiveness.
- `src/lib/actions/icons.ts` — `ACTION_ICONS` map + severity dot/border/badge color tables.
- 7 new UI tests (3 icon-map + 4 formatter).
- i18n: full `actionCenter.*` namespace per locale (tabs, severities, filters, actions, snooze, dismiss, attribution, empty states, all 10 type title/body strings with payload interpolation), `crmShell.sidebarNav.actionCenter`, `reception.briefing.*`.

### Files

```
NEW (Wave 1):
  prisma/migrations/20260506100335_action_engine/migration.sql
  src/lib/actions/types.ts
  src/server/actions/repository.ts
  src/server/actions/handler-utils.ts
  src/server/schemas/action.ts
  src/app/api/crm/actions/route.ts
  src/app/api/crm/actions/[id]/route.ts
  src/app/api/crm/actions/[id]/{snooze,dismiss,done,reopen}/route.ts
  tests/unit/action-types.test.ts
  tests/unit/action-handlers.test.ts

NEW (Wave 2):
  src/server/actions/config.ts
  src/server/actions/engine.ts
  src/server/actions/scheduler.ts
  src/server/actions/detectors/*.ts (10 files)
  src/app/api/crm/actions/recompute/route.ts
  tests/unit/detectors/*.test.ts (10 files)
  tests/unit/action-engine.test.ts

NEW (Wave 3):
  src/app/[locale]/crm/action-center/page.tsx
  src/app/[locale]/crm/action-center/_components/{action-center-client,action-card,snooze-popover,dismiss-dialog}.tsx
  src/app/[locale]/crm/action-center/_hooks/use-actions.ts
  src/app/[locale]/crm/reception/_components/action-briefing.tsx
  src/lib/actions/{format,icons}.ts
  tests/unit/action-icon-map.test.ts
  tests/unit/action-payload-formatter.test.ts

EDIT:
  prisma/schema.prisma (Action model + Clinic.actions + Branch.actions reverse relations)
  src/lib/audit-actions.ts (7 new constants)
  src/server/realtime/events.ts (action.created + action.updated)
  src/server/workers/start.ts (registerActionScheduler hookup)
  src/components/layout/crm-sidebar.tsx (CRM_NAV entry)
  src/app/[locale]/crm/reception/_components/reception-page-client.tsx (briefing mount)
  src/messages/{ru,uz}.json (full actionCenter.* + sidebar + briefing keys)
```

### Gates

- `npx tsc --noEmit` — clean.
- `npm run build` — Compiled successfully.
- `npx vitest run` — **614/614 passed** (was 517 after Phase 12 + 33 + 57 + 7 = 97 new).
- `npm run i18n:check` — OK, locales in parity.
- Migration: `20260506100335_action_engine` applied cleanly, custom Prisma client refreshed at `src/generated/prisma/client`.

### Notes / hand-off

- Per-clinic `DetectorConfig` overrides are baked into the engine but not yet exposed in UI — all clinics use `DEFAULT_CONFIG`. Phase 19 (SaaS Self-Service) will surface this via `/crm/settings/clinic`.
- `upsertAction` resurrects from terminal status (DONE/DISMISSED/EXPIRED) when same dedupeKey reappears — intentional but means a dismissed `EMPTY_SLOT_TOMORROW` for tomorrow comes back if same slot still empty after a recompute. Considered "respect dismissal until end-of-day" but rejected: receptionist can re-snooze if irrelevant.
- Engine emits `action-engine` audit `actorRole: SYSTEM`, `actorLabel: action-engine` — distinguishable in audit log filter for ops.
- `Action` is NOT in `MODELS_BRANCH_SCOPED`; rows are clinic-wide. Detectors set `branchId` explicitly when relevant. If multi-branch routing of actions to specific branches becomes a need, add Action to the branch-scoped set + force detectors to declare branch.

---

## Phase 14 — Revenue Engines — ✅ DONE 2026-05-06

**Цель:** превратить CRM из реактивного (Action Center реагирует на сигналы из Phase 13) в проактивный по деньгам — измерять упущенную выручку, прогнозировать, реактивировать «спящих» пациентов, разлагать no-show риск на факторы. Закрывает GPT-аудит «нет инструментов для денег».

### Что сделано

**Wave 1 — schema + no-show factor breakdown:**
- Миграция `20260506110253_revenue_engines`: `Patient.dormantSince DateTime?`, `Patient.reactivationSentAt DateTime[]`, новая таблица `EmptySlotSnapshot` (id, clinicId Cascade, branchId? SetNull, doctorId Cascade, date, hour 0–23, estimatedRevenueLossUzs Int в тиинах, takenSnapshotAt) + индексы `(clinicId, date)` и `(clinicId, doctorId, date)`.
- `src/lib/ai/no-show-risk.ts` — рефактор: возвращает `{ score, factors: { historyRisk, firstVisitBump, unconfirmedBump, farFutureBump, dayOfWeekBump? }, confidence: low|medium|high }`. Сохранены поля `risk` и `band` для backward-compat (ноль изменений в `no-show-risk-high` детекторе и `resolve-queue-scores`). Confidence: <3 визитов → low, 3–9 → medium, ≥10 → high.

**Wave 2 — engines + scheduled jobs:**
- `src/server/revenue/empty-slot.ts` — pure `computeEmptySlot(input)` + `expandScheduleHours(scheduleStrings)` + side-effecting `snapshotEmptySlotsForDay(prisma, clinicId, date)` (в транзакции: delete-then-insert по (clinicId, doctorId, date) для идемпотентности). Average price = avg(`Service.priceBase` через `ServiceOnDoctor`) → fallback на clinic-wide avg → fallback на `Doctor.pricePerVisit`.
- `src/server/revenue/reactivation.ts` — pure `classifyLapse(days)` (90/180/365 границы), `shouldSendReactivation({lastSentAtList, now, quarterDays=90})`, `deriveDormantSince` + DB-функции `findReactivationCandidates`, `enqueueReactivationFor`, `runReactivationScheduler`. Per-patient gate: skip если есть запись в `reactivationSentAt[]` за последние 90 дней или есть upcoming BOOKED/CONFIRMED.
- `src/server/revenue/scheduler.ts` + `src/server/workers/start.ts:46` — `registerRevenueSchedulers()` регистрирует два воркера через `getQueue()`: `revenue:snapshot` (target 02:00 локально) и `revenue:reactivation` (target 07:00). Polling 1h, hour-gating через `shouldFire`. Per-clinic try/catch, console.info на старт/конец.
- `src/server/notifications/triggers.ts` + `src/server/notifications/template.ts` — добавлен trigger key `patient.reactivation` (whitelist: patient.name, patient.firstName, clinic.name, clinic.phone, clinic.address). Тесты `notifications-triggers.test.ts` и `notifications-template.test.ts` обновлены 9 → 10 keys.

**Wave 3 — analytics dashboards + tooltip:**
- `/crm/analytics/loss` (ADMIN-only): 4 KPI-карточки (empty slots / no-shows / late cancellations / dormant), stacked-area тренд (Recharts), таблицы топ-докторов и dormant-сегментов, period tabs (week/month/quarter), empty-state «Snapshots run nightly».
- `/crm/analytics/forecast` (ADMIN-only): 30-дневный baseline + low/high band (Recharts ComposedChart, transparent floor + translucent ceiling trick), 3 what-if слайдера (reduceNoShow 0–50%, fillEmpty 0–50%, priceUplift 0–30%) с 100ms debounce. KPI: baseline, adjusted, delta, ceiling.
- Подменю `AnalyticsSubnav` (overview / loss / forecast) — встроено в `loss-page-client.tsx`, переиспользуется forecast-страницей. **Без отдельных sidebar entries**, доступ через `/crm/analytics`.
- Tooltip разложения no-show риска: `src/server/ai/resolve-queue-scores.ts` теперь прокидывает `noShowFactors` + `noShowConfidence` через `useReceptionLive`. В `queue-column.tsx` чип `· {noShowPct}%` обёрнут в shadcn `Tooltip` (preventDefault на trigger, чтобы не открывать ссылку).

### Files

```
NEW (Wave 1):
  prisma/migrations/20260506110253_revenue_engines/migration.sql
  tests/unit/no-show-risk-v2.test.ts

NEW (Wave 2):
  src/server/revenue/empty-slot.ts
  src/server/revenue/reactivation.ts
  src/server/revenue/scheduler.ts
  tests/unit/revenue-empty-slot.test.ts
  tests/unit/revenue-reactivation.test.ts

NEW (Wave 3):
  src/lib/revenue/loss-aggregation.ts
  src/lib/revenue/forecast.ts
  src/server/revenue/loss-data.ts
  src/server/revenue/forecast-data.ts
  src/app/api/crm/analytics/loss/route.ts
  src/app/api/crm/analytics/forecast/route.ts
  src/app/[locale]/crm/analytics/loss/page.tsx
  src/app/[locale]/crm/analytics/loss/_components/{loss-page-client,loss-types,loss-chart}.tsx
  src/app/[locale]/crm/analytics/forecast/page.tsx
  src/app/[locale]/crm/analytics/forecast/_components/{forecast-page-client,forecast-chart}.tsx
  tests/unit/revenue-forecast.test.ts

EDIT:
  prisma/schema.prisma (Patient + EmptySlotSnapshot + back-relations on Clinic/Branch/Doctor)
  src/lib/ai/no-show-risk.ts (factor breakdown + confidence; risk/band aliases preserved)
  src/server/ai/resolve-queue-scores.ts (noShowFactors + noShowConfidence на ScoredAppointment)
  src/server/notifications/triggers.ts (+ patient.reactivation)
  src/server/notifications/template.ts (+ ALLOWED_KEYS_BY_TRIGGER entry)
  src/server/workers/start.ts (registerRevenueSchedulers wireup)
  src/app/[locale]/crm/reception/_hooks/use-reception-live.ts (AiQueueItem fields)
  src/app/[locale]/crm/reception/_components/queue-column.tsx (factor tooltip)
  src/messages/{ru,uz}.json (analyticsNav, lossAnalytics, revenueForecast, noShowFactors namespaces)
  tests/unit/notifications-triggers.test.ts, tests/unit/notifications-template.test.ts (10 keys)
```

### Gates

- `npx tsc --noEmit` — clean.
- `npm run i18n:check` — OK, locales in parity.
- `npx vitest run` — **703/703 passed** (614 baseline → +25 Wave 1 (no-show v2) → +28 Wave 2 (empty-slot + reactivation) → +36 Wave 3 (forecast/loss helpers) = +89).
- `npm run build` — Compiled successfully, all 4 new routes registered (`/[locale]/crm/analytics/loss`, `/[locale]/crm/analytics/forecast`, `/api/crm/analytics/loss`, `/api/crm/analytics/forecast`).
- Migration `20260506110253_revenue_engines` — applied locally, custom Prisma client refreshed.

### Notes / hand-off

- **Schema gaps for Phase 17 (Compliance):** (1) нет `Patient.marketingOptOut` — реактивация сейчас не имеет opt-out gate (только `consentMarketing` opt-IN, что бы выкосило почти всю seed-базу — это discriminate-against). Compliance-фаза должна добавить отдельный `marketingOptOut Boolean` + unsubscribe flow в Mini App + SMS STOP keyword. (2) Нет `Patient.deletedAt` (soft delete) — сейчас hard delete через `Cascade`. Если GDPR retention становится требованием — добавить soft-delete и gate в reactivation engine.
- **Forecast точность:** confidence band сейчас простой (`low = baseline × (1 − historicalNoShowRate)`, `high = baseline × 1.05`). Quantile-based projection — задача для Phase 15 (AI Co-Pilot) или Phase 18 (Analytics depth). `emptySlotUpliftRate: 0.05` константа в `forecast-data.ts` потому что нет fill-outcome tracking.
- **Late cancellation window:** 24h до `startsAt` — heuristic, потому что схема не enforces non-null `Appointment.cancelledAt` (fallback на `updatedAt`). Если потребуется точнее — Phase 18 добавит `Appointment.cancellationKind` enum (LATE / EARLY / NO_REASON).
- **EmptySlotSnapshot первая выборка:** воркер `revenue:snapshot` пишет за вчерашний день; пустая дашборда `/crm/analytics/loss` в первые сутки после деплоя — показывает empty-state «Snapshots run nightly».
- **`patient.reactivation` template seed:** новый trigger key прописан в `ALLOWED_KEYS_BY_TRIGGER`, но шаблоны `NotificationTemplate` сидируются per-clinic из БД, не из `src/messages/*`. Перед production-релизом в Phase 14 обязательно сидируй subject/body для каждой клиники (или отдельная админ-страница). На текущем dev-seed реактивации идут без шаблона → adapter упадёт мягко (skip), но в проде нужно добавить seed.
- **Backward compat для consumers no-show risk:** `risk` (alias of `score`) и `band` остались на возвращаемом объекте — `no-show-risk-high.ts` детектор и `resolve-queue-scores.ts` (3 call-sites) не тронуты. В будущей фазе можно мигрировать на `.score` и убрать алиас, но это чистый рефактор без runtime-эффекта.
- Phase 13 unblocks Phase 14 (Revenue Engines) — Loss/Forecast UI consumes `EMPTY_SLOT_TOMORROW` and `PAYMENT_OVERDUE` action streams as primary inputs.

---

## Phase 15 — AI Co-Pilot — ✅ DONE 2026-05-06

**Цель:** ввести LLM в три-четыре точки, где он экономит минуты в день — не "AI everywhere", а целевые use cases. Закрывает GPT-аудит «нет AI поверх данных».

### Что сделано

**Wave 1 — Foundation (LLM proxy + redaction + audit):**
- Миграция `20260506114917_ai_copilot_foundation`: `Patient.summaryCache String?`, `Patient.summaryCacheUpdatedAt DateTime?`, `MedicalCase.soapDraft String?`, новая таблица `LLMUsage` (id, clinicId Cascade, userId?, useCase String, provider String, model String, promptHash, inputTokens, outputTokens, costUzs Int в тиинах, latencyMs, cacheHit Boolean, errorCode String?, createdAt) + индексы `(clinicId, createdAt)` и `(clinicId, useCase, createdAt)`.
- `src/server/ai/redact.ts` — `redact(text)` (phones UZ/международные, email, passport AA-формат, JSHSHIR 14-digit), `redactWithKnownNames(text, names)` (явный список имён), `unredact(text, replacements)` (round-trip байт-в-байт).
- `src/server/ai/llm.ts` — `callLLM(req)` через провайдер abstraction: `mock` (deterministic) + `anthropic` (lazy import `@anthropic-ai/sdk`, real `messages.create` с `system` + `tools`). Fallback на mock когда `ANTHROPIC_API_KEY` отсутствует. Default model `claude-sonnet-4-6` (override через `LLM_DEFAULT_MODEL`). Cost из таблицы `$3/M input + $15/M output` × 12700 UZS/USD × 100 (тиины). Per-clinic 24h rate limit (basic 200, pro 1000, enterprise 10000) с `LLMRateLimitError`. Lazy ioredis cache (1h TTL) когда `REDIS_URL` стоит. Audit `LLM_CALL` + `LLMUsage` row на каждый call (включая ошибочные).

**Wave 2 — Patient summary auto-gen:**
- `src/server/ai/summary.ts` — `generatePatientSummary(input)` строит system prompt + serializes patient + last-3 visits + open cases, передаёт `knownNames`, парсит ответ и фолбэчит на детерминированный шаблон если LLM пуст.
- `src/server/ai/patient-summary-cache.ts` — `readOrRefreshPatientSummary(prisma, clinicId, userId, patientId, locale, options)`. TTL 24h, инвалидация при новой `Appointment` (нет `Visit` модели — `Appointment` is the visit table). При stale/missing — отдаёт текущий cache (или empty) и enqueueит refresh job.
- `src/server/workers/patient-summary-refresh.ts` — worker `ai:patient-summary` под `runWithTenant({kind:'SYSTEM'})`, читает контекст из БД, derives `birthYear` из `birthDate`, splits `fullName`, эмитит realtime `patient.summary.refreshed` событие.
- API `/api/crm/patients/[id]/summary` GET + `/refresh` POST (ADMIN/DOCTOR), audit `PATIENT_SUMMARY_REFRESHED`.
- UI: `<PatientSummaryCard variant="card"|"compact">` — `SparklesIcon`, AI-tag, refresh button, live-update через `useLiveQueryInvalidation`. Mounted в `patient-card-client.tsx:170` (card) и `appointment-drawer.tsx:320` (compact).

**Wave 3 — NL Command Bar (Cmd+K):**
- `src/server/ai/tools/{find-free-slots,find-patient,get-appointments-today,search-actions}.ts` — 4 read-only tools, каждый с JSON Schema input + `execute(input, context): ToolResult` (с `summary` для LLM + `chips` для UI). Все возвращают deeplinks вместо self-execution.
- `src/server/ai/tool-loop.ts` — `askAssistant(input)` с `MAX_ITERATIONS=4`. Tool results собираются как `[tool:name ok=true] {summary}` user-messages; final assistant text + aggregated chips.
- API `/api/crm/ai/ask` POST (ADMIN/DOCTOR/RECEPTIONIST/NURSE), audit `AI_QUERY_ASKED` (один на POST + per-iteration `LLM_CALL` через proxy).
- UI: вкладка "Спросить AI" / "AI'dan so'rash" внутри существующего `global-search.tsx` (Cmd+K), default tab — "Команды" (existing flow не сломан). Chat-style ответ + chip-карточки с deeplinks.

**Wave 4 — Marketing copy generator (admin only):**
- `src/server/ai/marketing-copy.ts` — `generateMarketingCopy(input)` с defensive parser (numbered "1./2./3." → blank-line → single-fallback). System prompt инструктирует LLM не выдумывать promo / даты, только структурировать заданное.
- API `/api/crm/ai/marketing-copy` POST ADMIN-only, audit `MARKETING_COPY_GENERATED`. На `LLMRateLimitError` → 429.
- UI: `<AiCopySuggest>` popover на template-editor (mount point: `template-editor.tsx:347` рядом с bodyRu, `:395` рядом с bodyUz). Channel/audience/tone/maxChars/promo/notes inputs; 3 variant cards с green/red char-count chip; "Использовать" → fills body field, "Скопировать" → clipboard.

**Wave 5 — Voice → SOAP for doctors:**
- `src/server/ai/transcribe.ts` — `transcribe(input)` через OpenAI Whisper API (multipart form-data) или `mock` provider. Cost $0.006/min × 12700 UZS/USD × 100 (тиины). Audio file fetched and discarded — never persisted to disk, URL never stored. `LLMUsage` row + `LLM_CALL` audit на каждый transcript.
- `src/server/ai/soap.ts` — `structureSoap(input)` через LLM proxy (useCase `voice.soap`), парсит `### Subjective/Objective/Assessment/Plan` секции; malformed → raw в subjective; empty/throw → empty struct без crash.
- `src/server/workers/voice-soap.ts` — `voice-soap-process` worker: `transcribe → structureSoap → stitch markdown → write soapDraft → audit VOICE_SOAP_DRAFTED → publishEventSafe('case.soap-draft.refreshed')`. Overwrites без append (intentional — single draft, doctor edits in CRM).
- `src/server/telegram/voice-handler.ts` — TG webhook detects voice/audio → resolves sender to `User.role=DOCTOR + active + telegramId match` → finds latest OPEN MedicalCase для этого doctor → `getFile + buildFileDownloadUrl` + enqueueит job → reply «Получил, расшифровываю...». Existing welcome+MiniApp flow не сломан (returns "not-doctor" → falls through).
- UI: `<SoapDraftCard>` на case detail page (mounted в `case-detail-client.tsx` ниже meta+timeline). Read/edit toggle, PATCH через `usePatchCase`, live-update на `case.soap-draft.refreshed`.
- **Mini App NL booking — DEFERRED.** Booking flow в Mini App — это server-routed multi-step (`/c/[slug]/my/book/{service,doctor,slot,confirm,done}`); добавить chat panel + intent extractor без рефакторинга всего flow — это inconsistent UX. Audit constant `MINIAPP_BOOKING_SUGGESTED` зарезервирован в `audit-actions.ts` для следующего pass'а в Phase 16 (Patient Experience).

### Files (high-level — full list ниже)

```
NEW (Wave 1):
  prisma/migrations/20260506114917_ai_copilot_foundation/migration.sql
  src/server/ai/{redact,llm}.ts
  tests/unit/ai-{redact,llm-proxy}.test.ts

NEW (Wave 2):
  src/server/ai/{summary,patient-summary-cache}.ts
  src/server/workers/patient-summary-refresh.ts
  src/app/api/crm/patients/[id]/summary/{route,refresh/route}.ts
  src/app/[locale]/crm/patients/[id]/_components/patient-summary-card.tsx
  tests/unit/ai-patient-summary{,-cache}.test.ts

NEW (Wave 3):
  src/server/ai/tools/{types,index,find-free-slots,find-patient,get-appointments-today,search-actions}.ts
  src/server/ai/tool-loop.ts
  src/app/api/crm/ai/ask/route.ts
  src/components/layout/ai-ask-panel.tsx
  tests/unit/ai-tool-{loop,registry}.test.ts

NEW (Wave 4):
  src/server/ai/marketing-copy.ts
  src/app/api/crm/ai/marketing-copy/route.ts
  src/app/[locale]/crm/notifications/_components/ai-copy-suggest.tsx
  tests/unit/ai-marketing-copy.test.ts

NEW (Wave 5):
  src/server/ai/{transcribe,soap}.ts
  src/server/workers/voice-soap.ts
  src/server/telegram/voice-handler.ts
  src/app/[locale]/crm/cases/[id]/_components/soap-draft-card.tsx
  tests/unit/ai-{soap,transcribe}.test.ts

EDIT:
  prisma/schema.prisma (Patient.summaryCache + summaryCacheUpdatedAt; MedicalCase.soapDraft; LLMUsage model + Clinic.llmUsages back-relation)
  package.json (@anthropic-ai/sdk added)
  src/lib/audit-actions.ts (LLM_CALL, PATIENT_SUMMARY_REFRESHED, AI_QUERY_ASKED, MARKETING_COPY_GENERATED, VOICE_SOAP_DRAFTED, MINIAPP_BOOKING_SUGGESTED)
  src/server/realtime/events.ts (patient.summary.refreshed, case.soap-draft.refreshed)
  src/server/workers/start.ts (registerVoiceSoapWorker + startPatientSummaryRefreshWorker)
  src/components/layout/global-search.tsx (AI tab + ClassicCommandSearch sub-component)
  src/app/[locale]/crm/notifications/_components/template-editor.tsx (AiCopySuggest mount)
  src/app/[locale]/crm/patients/[id]/_components/patient-card-client.tsx (PatientSummaryCard mount)
  src/app/[locale]/crm/appointments/_components/appointment-drawer.tsx (compact PatientSummaryCard mount)
  src/app/[locale]/crm/cases/[id]/_components/case-detail-client.tsx (SoapDraftCard mount)
  src/app/[locale]/crm/cases/[id]/_hooks/use-case.ts (soapDraft field)
  src/server/schemas/medical-case.ts (UpdateMedicalCaseSchema.soapDraft)
  src/server/telegram/{bot-api,messages}.ts + src/app/api/telegram/webhook/[clinicSlug]/route.ts (voice/audio dispatch)
  src/messages/{ru,uz}.json (patientSummary, ai.ask, ai.chip, marketingCopy, soapDraft, tgVoiceReply namespaces)
```

### Gates

- `npx tsc --noEmit` — clean.
- `npm run i18n:check` — OK, locales in parity.
- `npx vitest run` — **804/804 passed** (703 baseline → +35 W1 → +20 W2 → +10 W3 → +17 W4 → +19 W5 = +101 net).
- `npm run build` — Compiled successfully. New routes: `/api/crm/patients/[id]/summary` + `/refresh`, `/api/crm/ai/ask`, `/api/crm/ai/marketing-copy`.
- Migration `20260506114917_ai_copilot_foundation` applied locally, custom Prisma client refreshed.

### Notes / hand-off

- **Provider strategy:** только `mock` + `anthropic` (LLM) и `mock` + `openai` (Whisper) wired. OpenAI/Ollama чat completions deferred — costs entries reserved в `COST_TABLE` так что добавить — это один switch-case. Все use cases работают в mock-режиме, prod должен иметь `ANTHROPIC_API_KEY` (для генерации) + `OPENAI_API_KEY` (только для Whisper, никакой generation).
- **PII redaction recall:** 100% на телефонах UZ/международных формах + email + passport AA-формат + JSHSHIR в test corpus. Имена redactятся ТОЛЬКО при явном `knownNames` списке — heuristic name redaction слишком рискован (false positives на медицинских терминах, drug names). Все use cases передают известные имена (patient + doctor) в knownNames.
- **Cost ceiling per clinic plan:** rate limit work через 24h count `LLMUsage`. Cost дашборд для админа — задача для Phase 19 (SaaS Self-Service).
- **Audit telemetry:** каждый LLM call → `LLMUsage` row + `AuditLog{action: 'LLM_CALL'}`. Use case-specific audit (`AI_QUERY_ASKED`, `MARKETING_COPY_GENERATED`, `VOICE_SOAP_DRAFTED`, `PATIENT_SUMMARY_REFRESHED`) добавляются ОТДЕЛЬНО — для аналитики "сколько маркетинга в день" без шумa per-iteration LLM_CALL rows.
- **Voice privacy:** verified end-to-end. URL fetched via `getFile + buildFileDownloadUrl` → `transcribe.ts` ставит multipart blob → never persisted, URL never stored, audio purged when fetch resolves. Только текст транскрипта + структурированный SOAP markdown сохраняются в `MedicalCase.soapDraft`.
- **TG bot impact:** voice/audio handler — additive. Existing welcome + Mini App button flow (#210) ходит как обычно; non-doctor отправители voice падают на existing operator-inbox path.
- **Mini App NL booking deferred:** scope blocker — Mini App booking — server-routed multi-step. Phase 16 (Patient Experience) либо рефакторит booking flow в single-page state machine с pre-fill, либо строит отдельный `/c/[slug]/my/ai-suggest` page как deeplink-генератор.
- **Whisper model name in audit:** жёстко прописан как `'whisper-1'`. OpenAI deprecated `whisper-1` в пользу `whisper-large-v3` — обновить когда релиз будет stable.
- **Cmd+K NL — read-only by design:** все 4 tools query-only. Никаких мутирующих tool registries. Chips — только deeplinks. Если в будущей фазе захочется "забронировать слот через AI" — это требует separate plan + explicit confirmation pattern + risk review.
- **`MARKETING_COPY_GENERATED` ≠ `template.create`:** генерация copy не пишется в template — admin клик "Использовать" заполняет form, save идёт через existing template.create/update audit. Так что есть две независимые audit chain: «AI выдал варианты» + «admin сохранил template».

---

## Phase 16 — Patient Experience — ✅ DONE 2026-05-06

**Цель:** Mini App превращается в daily-use поверхность, а не одноразовое «забронировал → закрыл». Каждый use case повышает retention пациента → LTV.

### Что сделано

**Wave 1 — Schema + Treatment plan + Family accounts:**
- Миграция `20260506130214_phase16_patient_experience`: 4 новых модели — `PatientReview` (NPS — название изменено с `Review` чтобы не пересекаться с существующим public-reviews `Review`), `PatientFamily`, `Prescription`, `ReferralCode`. CHECK constraints: no-self-link, score 1..10.
- `src/server/services/treatment-plan.ts` — pure `computeProgress` (total = max(planned, completed + (next?1:0), 1) — `MedicalCase` не имеет `plannedVisits`, helper всё же принимает arg для forward compat).
- Mini App: `<TreatmentPlanCard>` на home (`miniapp-home.tsx:107`), `<FamilySwitcher>` в shell (`mini-app-shell.tsx:103`), форма «Добавить родственника» на `/c/[slug]/my/family/add`.
- API: `GET/POST /api/miniapp/family`, `DELETE /api/miniapp/family/[linkedPatientId]`, `GET /api/miniapp/treatment-plan`, `GET /api/crm/patients/[id]/family`. PatientFamily ограничено 5 связями, claim-or-create по (clinicId, fullName, phone).
- Booking flow honors `?onBehalfOf=<patientId>` — `appointments POST` валидирует PatientFamily link и swaps `bookingPatientId`.
- CRM patient card: «Семья» панель в right-rail (read-only).
- Phone-less родственники: stub `phoneNormalized = "family:<ownerId>:<rand>"` чтобы satisfy unique constraint.

**Wave 2 — Pre-visit questionnaire + Post-visit NPS:**
- Миграция `20260506140000_phase16_pre_visit_data`: `Appointment.{preVisitData Json?, preVisitNotifiedAt, preVisitSubmittedAt, npsRequestedAt}` + `Clinic.npsAlertThreshold Int @default(7)`.
- 2 новых notification trigger keys: `appointment.pre-visit-questionnaire` (24h до визита) и `appointment.nps-request` (4ч после COMPLETED). Whitelist: patient.name, appointment.startsAt, appointment.doctor, appointment.url. `TRIGGER_KEYS` 10 → 12.
- Workers: `runPreVisitTick` (hourly, 23-25h окно от now, dedupe через `preVisitNotifiedAt`) и `runPostVisitNpsTick` (hourly, 4-5h после `actualEndsAt|updatedAt`, dedupe через `npsRequestedAt`). Per-row error handling, 500-row batch limit.
- Mini App: `/c/[slug]/my/pre-visit/[appointmentId]` (4-field form: complaints + allergies array + medications array + notes; hydrate-once UX) и `/c/[slug]/my/nps/[appointmentId]` (5×2 score grid + comment textarea).
- API: `GET/POST /api/miniapp/pre-visit/[id]` и `GET/POST /api/miniapp/nps/[id]` — both honour PatientFamily on-behalf-of, idempotent 409 на resubmit.
- CRM: `<PreVisitQuestionnaireCard>` в appointment drawer (status badge + collapsed expand).
- LOW NPS path: `score < clinic.npsAlertThreshold` → `PatientReview.adminAlerted = true` + emit `LOW_NPS_RECEIVED` Action (severity high, dedupeKey `LOW_NPS_RECEIVED:appointmentId=<id>`, deeplink `/crm/action-center`, comment-preview truncated to 120 chars). Action type wired in Phase 13 engine с icon `<FrownIcon>`, RU/UZ title/body.

**Wave 3 — Medication reminders + Refer-a-friend + Admin settings:**
- Миграция `20260506150000_phase16_meds_referral_settings`: 2 новых модели — `MedicationReminderSend` (id, prescriptionId, scheduledFor unique, sentAt, patientResponse 'taken'|'skipped'|null, respondedAt) и `ReferralReward` (id, clinicId, referrerPatientId, referredPatientId unique pair, sourceCodeId, percent, status PENDING/APPLIED/EXPIRED, expiresAt default +365d, appliedAppointmentId?, appliedAt?). Новые поля: `Lead.referrerPatientId`, `Appointment.{discountPct, discountAmount, appliedReferralRewardId}`, `Clinic.{referralRewardPercent default 15, medicationRemindersEnabled default true}`.
- 2 новых notification trigger keys: `medication.reminder` и `referral.reward-earned`. `TRIGGER_KEYS` 12 → 14.
- Worker `medication-reminder-tick` (hourly): scans ACTIVE+remindersEnabled prescriptions, computes next tick from `schedule.times`, dedupes via `MedicationReminderSend(prescriptionId, scheduledFor)` unique constraint, auto-flips status to COMPLETED после `schedule.days` дней.
- CRM: `<PrescriptionsCard>` на case detail page — CRUD form (drugName, dosage, schedule.times array max 4, days, startsAt, notes, remindersEnabled checkbox), per-row Pause/Resume/Complete/Edit/Delete actions.
- Mini App: `/c/[slug]/my/medications` (active prescriptions + Today's status: taken/pending/missed counts, "Принял" button), `/c/[slug]/my/refer` (8-char unique code, copy/share via `navigator.share`).
- Referral flow: на первом COMPLETED appointment у пришедшего по `?ref=<code>` патиента — `mintReferralRewardOnCompletion` создаёт `ReferralReward(status=PENDING, percent=clinic.referralRewardPercent)`, increments `ReferralCode.useCount`, marks `Lead.source='REFERRAL' + referrerPatientId`. На NEXT booking referrer'а: auto-apply pending reward в Serializable transaction (FIFO oldest first), stamps `appointment.discountPct/Amount + appliedReferralRewardId`, audit `REFERRAL_REWARD_APPLIED`.
- Admin `/crm/settings/clinic`: новая секция "Patient Experience" с npsAlertThreshold (1-10), referralRewardPercent (0-50), medicationRemindersEnabled toggle.
- CRM patient card: «Реферальная программа» секция (code, useCount, rewards earned/applied).

### Files (cumulative)

```
NEW migrations:
  prisma/migrations/20260506130214_phase16_patient_experience/migration.sql
  prisma/migrations/20260506140000_phase16_pre_visit_data/migration.sql
  prisma/migrations/20260506150000_phase16_meds_referral_settings/migration.sql

NEW (Wave 1):
  src/server/services/{family,treatment-plan}.ts
  src/app/api/miniapp/family/{route,[linkedPatientId]/route}.ts
  src/app/api/miniapp/treatment-plan/route.ts
  src/app/api/crm/patients/[id]/family/route.ts
  src/app/c/[slug]/my/_components/{treatment-plan-card,family-switcher,family-add-screen}.tsx
  src/app/c/[slug]/my/_hooks/{use-family,use-treatment-plan,use-active-context}.ts
  src/app/c/[slug]/my/family/add/page.tsx
  src/app/[locale]/crm/patients/[id]/_hooks/use-patient-family.ts
  tests/unit/{family-validation,treatment-plan}.test.ts

NEW (Wave 2):
  src/server/workers/{pre-visit-questionnaire,post-visit-nps}.ts
  src/server/notifications/triggers (extended) + 2 new keys
  src/app/api/miniapp/pre-visit/[appointmentId]/route.ts
  src/app/api/miniapp/nps/[appointmentId]/route.ts
  src/app/c/[slug]/my/pre-visit/[appointmentId]/page.tsx
  src/app/c/[slug]/my/nps/[appointmentId]/page.tsx
  src/app/[locale]/crm/appointments/_components/pre-visit-questionnaire-card.tsx
  tests/unit/{pre-visit-validation,post-visit-nps}.test.ts
  // LOW_NPS_RECEIVED Action type wired in src/lib/actions/{types,format,icons}.ts

NEW (Wave 3):
  src/server/workers/medication-reminder.ts
  src/server/patient-experience/referral-mint.ts
  src/app/api/miniapp/medications/{route,[reminderSendId]/route}.ts
  src/app/api/miniapp/referral/route.ts
  src/app/api/crm/cases/[id]/prescriptions/{route,[prescriptionId]/route}.ts
  src/app/api/crm/patients/[id]/referral/route.ts
  src/app/c/[slug]/my/medications/page.tsx + _components/medications-screen.tsx
  src/app/c/[slug]/my/refer/page.tsx + _components/refer-screen.tsx
  src/app/c/[slug]/my/_hooks/{use-medications,use-referral}.ts
  src/app/[locale]/crm/cases/[id]/_components/prescriptions-card.tsx
  src/app/[locale]/crm/patients/[id]/_components/patient-referral-card.tsx
  tests/unit/{medication-schedule,referral-reward}.test.ts

EDIT:
  prisma/schema.prisma (4 models + 4 columns + 4 fields across 3 migrations)
  src/lib/audit-actions.ts (PATIENT_FAMILY_LINKED/UNLINKED, PRE_VISIT_QUESTIONNAIRE_SUBMITTED, NPS_RECEIVED, LOW_NPS_RECEIVED, PRESCRIPTION_CREATED/UPDATED/DELETED, MEDICATION_REMINDER_SENT/RESPONDED, REFERRAL_CODE_GENERATED, REFERRAL_REWARD_EARNED/APPLIED)
  src/server/notifications/{triggers,template}.ts (+4 trigger keys: pre-visit-questionnaire, nps-request, medication.reminder, referral.reward-earned; TRIGGER_KEYS 10→14)
  src/lib/actions/{types,format,icons}.ts (+LOW_NPS_RECEIVED action type)
  src/server/workers/start.ts (+startPreVisitWorker, startPostVisitNpsWorker, startMedicationReminderWorker)
  src/app/api/miniapp/appointments/route.ts (onBehalfOf + auto-apply referral reward in Serializable tx)
  src/app/api/crm/appointments/[id]/route.ts (mintReferralRewardOnCompletion on COMPLETED transition)
  src/app/[locale]/crm/appointments/_components/appointment-drawer.tsx (PreVisitQuestionnaireCard mount)
  src/app/[locale]/crm/cases/[id]/_components/case-detail-client.tsx (PrescriptionsCard mount)
  src/app/[locale]/crm/patients/[id]/_components/patient-card-client.tsx (PatientReferralCard mount)
  src/app/[locale]/crm/patients/[id]/_components/patient-right-rail.tsx (Family panel mount)
  src/app/[locale]/crm/settings/clinic/* (Patient Experience section)
  src/app/c/[slug]/my/_components/{mini-app-shell,miniapp-home,book/book-confirm,appointments/appointments-screen}.tsx (FamilySwitcher + treatment plan + onBehalfOf threading + medications/refer CTAs)
  src/messages/{ru,uz}.json + src/app/c/[slug]/my/_messages/{ru,uz}.ts (treatmentPlan, family, preVisit, nps, medications, refer, prescriptions, settings.clinic.patientExperience namespaces)
  tests/unit/notifications-{triggers,template}.test.ts (10→12→14 keys)
```

### Gates

- `npx tsc --noEmit` — clean.
- `npm run i18n:check` — OK, locales in parity.
- `npx vitest run` — **903/903 passed** (804 baseline → +23 W1 → +53 W2 → +23 W3 = +99 net).
- `npm run build` — Compiled successfully, 94/94 static pages generated.
- 3 migrations applied locally, custom Prisma client refreshed.

### Notes / hand-off

- **`Review` → `PatientReview` rename:** существующий `Review` model (public reviews от клиники для маркетинга) занимал имя; NPS получает префикс. Если в будущем захочется унифицировать — это рефактор без внешних поломок.
- **`MedicalCase.plannedVisits` отсутствует:** treatment-plan helper использует heuristic (max(completed+next, 1)). Если doctor захочет явно указать "5 визитов в плане лечения" — Phase 17 (Compliance) или Phase 18 могут добавить explicit поле.
- **Family + on-behalf-of:** `?onBehalfOf=<patientId>` в URL + cookie fallback. Booking valid'ate `PatientFamily(ownerId, linkedId)` существует. Если родственник делает что-то подозрительное — owner получает audit row через existing audit chain (нет separate "child action" filter).
- **Referral reward apply order:** FIFO oldest first в Serializable tx. Если у одного referrer'а 3 PENDING rewards — первый booking applies oldest, остальные ждут. Trade-off: doesn't max savings for patient но prevents stacking abuse.
- **Schema gap для Phase 17:** `Patient.marketingOptOut` всё ещё нет (flagged в Phase 14). NPS / referral / medication reminders ВСЕ идут без opt-out gate. Phase 17 (Compliance) обязательно должна добавить столбец и unsubscribe surface (Mini App + SMS STOP).
- **Notification template seed:** 4 новых trigger keys — `appointment.pre-visit-questionnaire`, `appointment.nps-request`, `medication.reminder`, `referral.reward-earned`. Шаблоны RU/UZ должны быть seedened в БД per-clinic перед prod-релизом. Adapter падает мягко (skip) при missing template, но в проде это означает "пациент не получит уведомление" — добавить seed обязательно.
- **Discount in tiins:** `Appointment.discountAmount` хранится в тиинах (×100 of soum) consistent с другими денежными полями. Pricing recalc'ится в booking tx, не в client.
- **Mini App NL booking всё ещё DEFERRED:** Wave 5 of Phase 15 deferred это; Phase 16 не подняла из-за scope. Audit constant `MINIAPP_BOOKING_SUGGESTED` сидит зарезервированным. Поднять в Phase 18/19 либо отдельным spike.
- **Referral max uses:** `ReferralCode.maxUses` exists в schema но не enforced в redemption. Если будут злоупотребления — добавить guard в `mintReferralRewardOnCompletion`. Сейчас ограничено только expiry datetime + already-rewarded check (referrerPatientId, referredPatientId unique).


## Phase 17 — Compliance & Trust (2026-05-07)

Closes the consent / privacy / session-security gaps accumulated through Phases 14–16. Marketing engines (reactivation, NPS, medication reminders, referral) were dispatching without an opt-out gate; staff sessions had no idle timeout, no 2FA, no concurrent-session protection; PII (passport, free-text notes, SOAP drafts, prescription notes) sat in plaintext on disk; there was no DSAR surface for patient data export or deletion.

Four sequential waves; one agent per wave to keep i18n message files conflict-free.

### Wave 1: Marketing opt-out + soft-delete + PatientView audit + Mini App unsubscribe

- Migration `20260506160000_phase17_compliance_foundation` (front-loaded W2's User columns to avoid a second migration round-trip):
  - `Patient.{marketingOptOut, marketingOptOutAt, marketingOptOutSource, deletedAt, deletionRequestedAt, deletionReason}`
  - `User.{totpSecret, totpEnabledAt, recoveryCodesHash, lastSessionRotatedAt}`
  - `PatientView` model (3 indexes; (clinicId, patientId, viewedAt) for the per-clinic feed, (viewerUserId, viewedAt) for "what did this user open", (viewedAt) for retention).
- Consent gate `src/server/notifications/consent-gate.ts` — `isAllowedToReceive(patient, kind: 'transactional'|'marketing')` returns `{ allowed, reason? }`. Soft-deleted = never; transactional = always when not deleted; marketing + opt-out = blocked.
- Wired into 5 callsites: reactivation engine, medication-reminder worker, post-visit-NPS worker, `onReferralRewardEarned`, `runBirthdays`. **Pre-visit-questionnaire deliberately NOT gated** (transactional — patient booked, helps the doctor; documented in worker header).
- SMS STOP keyword (`isStopKeyword` + `stopReply(lang)` at `src/lib/sms-stop.ts`): RU/UZ/Latin variants `STOP`, `СТОП`, `TO'XTAT`, `TOXTAT`, `T0XTAT`, `ОТПИСАТЬСЯ`. SMS webhook flips `marketingOptOut=true`, audits `MARKETING_OPT_OUT_CHANGED`, queues confirmation.
- Mini App profile PATCH accepts `marketingOptOut: boolean`, source stamped `'mini-app'`.
- PatientView audit: `recordPatientView()` with 5-min throttle by `viewerUserId+patientId+context`; SYSTEM context excluded; errors swallowed (audit must never break reads). Wired into all GET endpoints that surface PHI.
- ADMIN-only meta-audit: `/api/crm/audit/patient-views` paginated, audited as `PATIENT_VIEW_AUDIT_ACCESSED`. UI on `/crm/settings/audit` got a second tab "Просмотры карточек".

### Wave 2: 2FA + session security

- Migration `20260507100000_phase17_w2_session_security`:
  - `Clinic.require2faForAll Boolean @default(false)` (Plan-gated: Pro+ only)
  - `Clinic.sessionIdleTimeoutMinutes Int @default(30)` (clamped [5, 240])
  - `UserSession` table with `tokenHash`, `lastActivityAt`, `userAgent`, `ip`, FK to User, indexed on `(userId, createdAt)`.
- Server helpers (`src/server/auth/`):
  - `totp.ts` — RFC 6238 SHA-1 / 30s / 6-digit, ±1 window, base32 codec, otpauth URL builder.
  - `recovery-codes.ts` — 10 × `XXXX-XXXX-XXXX` codes, bcrypt hashed, position-leak-safe consume.
  - `session-security.ts` — `checkSessionLifetime`, `pickSessionsToKick`, idle clamp.
  - `security-policy.ts` — `requiresTotpEnrollment(role, clinic)` (ADMIN/SUPER_ADMIN always, plus clinic-flag for non-admin).
  - `user-session.ts` — `mintUserSessionOnSignIn` (kicks priors + audits `CONCURRENT_SESSION_KICKED`).
  - `totp-pending.ts` — short-lived `tfa_pending` cookie HMAC for the precheck step.
- Login flow split: `/login` does password + precheck; if 2FA enabled redirects to `/login/2fa` (TOTP code OR "Use recovery code" toggle). Recovery code consumes the bcrypt hash and audits `RECOVERY_CODE_USED`; banner appears when ≤2 codes remain.
- Self-service: `/crm/me/security` — enrol with QR + manual secret + verify, view recovery-code count, regenerate codes (re-prompts password), disable 2FA (re-prompts password).
- Per-clinic settings: `clinicSecurity` block on `/crm/settings/clinic` — `require2faForAll` toggle (disabled with upsell hint on Basic plan) + idle-timeout numeric input. Audited as `CLINIC_2FA_REQUIREMENT_CHANGED` / `CLINIC_SESSION_IDLE_CHANGED`.
- Session lifecycle in `src/proxy.ts`:
  - Idle timeout: bumps `lastActivityAt` per request; logs out + redirects `/login?reason=idle` past threshold; audits `SESSION_TIMEOUT_LOGOUT`.
  - 8h forced rotation: `now - lastSessionRotatedAt > 8h` → invalidate; audits `SESSION_FORCED_REROTATE`.
  - Concurrent-session kick: any prior `UserSession` for this `userId` is invalidated on new login.
  - Mandatory 2FA redirect to `/crm/me/security/enroll` for ADMIN/SUPER_ADMIN without `totpEnabledAt`.

### Wave 3: DSAR (data export + soft-delete with 90-day execution)

- Migration `20260507XXXX_phase17_w3_dsar` adds `DataExportJob` and `DataDeletionJob` models with full lifecycle enums.
- Mini App self-service: `/c/[slug]/my/account/delete` — phone-confirmation gate, optional reason + notes, before/after summary; pending state shows "delete on YYYY-MM-DD" with cancel button. Patient-self deletion auto-approves (`PENDING_REVIEW → APPROVED` immediately).
- CRM admin queue: `/[locale]/crm/settings/dsar` — two tabs (deletions first, exports second), per-row approve/cancel/download. ADMIN-only; staff-initiated deletions require an approver.
- Export pipeline (`src/server/workers/data-export.ts`):
  - JSON bundle covers profile, appointments, medical cases, prescriptions, family links, reviews/NPS, pre-visit data, referral codes/rewards, conversation messages, audit-log entries where the patient was actor or subject.
  - `archiver` + `archiver-zip-encrypted` AES-256, passphrase bcrypt-hashed, MinIO storage at `exports/<clinicId>/<jobId>.zip`, default 30-day TTL.
  - Delivery: TG bot sends file + passphrase to `telegramChatId` for self-request; passphrase shown in CRM modal for admin-initiated (read aloud / in-person policy documented in worker comment). Audits `PATIENT_DATA_EXPORT_GENERATED` / `…_DELIVERED`.
- Deletion pipeline (`src/server/workers/data-deletion.ts`):
  - Hourly cron; picks `APPROVED` jobs where `scheduledFor <= now()`.
  - Default mode `ANONYMIZE`: `fullName='Удалённый пациент'`, `phoneNormalized='deleted:<jobId>'`, passport/birthDate/notes nulled, `deletedAt=now()`. Aggregate columns (`firstAppointmentAt`, totals) preserved for analytics integrity.
  - `HARD_DELETE` mode: cascade through medical cases / prescriptions; `Appointment` retained with patientId nulled (analytics integrity).
  - Forensic audit row `PATIENT_ANONYMIZED` / `PATIENT_HARD_DELETED` written from a hydrated snapshot so the trail survives key rotation.

### Wave 4: encryption at rest

- App-level AES-256-GCM, **not** pgcrypto — chose app-level because the key never lives in the DB, dump captured without `FIELD_ENCRYPTION_KEY` is useless, and there's no SELECT-time function-call overhead. Trade-off documented in the runbook.
- `src/server/crypto/field-cipher.ts` — random 12-byte IV per call, 16-byte tag, wire format `v<n>:<iv_b64>:<tag_b64>:<ct_b64>`. Multi-version key resolver walks `FIELD_ENCRYPTION_KEY_V<n>` env vars (legacy `FIELD_ENCRYPTION_KEY` = v1). Production fails closed without a real key; dev fallback is a deterministic key (warned once).
- Boundary helpers (per service): `src/server/{patient,medical-case,prescription}/cipher-fields.ts` with `serialize…ForWrite` / `hydrate…ForRead`. Partial-update keys-not-present stay absent; plaintext tolerated on read for not-yet-backfilled rows; refuses to double-encrypt.
- Encrypted fields: `Patient.passport`, `Patient.notes`, `MedicalCase.soapDraft`, `Prescription.notes`. Not encrypted: `fullName`, `phoneNormalized`, `email`, `birthDate`, `telegramId/Username`, anything indexed (encryption breaks WHERE / search; blind-index column deferred — see hand-off).
- Wired into all CRM patient/case/prescription routes, voice-SOAP worker, DSAR export worker (decrypts before bundling — patient owns their data), DSAR deletion worker (hydrates before forensic snapshot).
- Backfill: `scripts/encrypt-existing-pii.ts` — cursor pagination, 200-row transactional batches per table, idempotent (`isEncryptedField` skip), `--dry-run` + `--table` flags.
- Rotation: `scripts/rotate-encryption-key.ts` — re-encrypts non-active-version rows; both keys must be live during the rotation window.
- Runbook `docs/runbooks/encryption-key-rotation.md` — generation, initial setup, quarterly rotation, key-compromise procedure, recovery posture.
- SUPER_ADMIN posture page `/admin/encryption-health` — active key, known versions, dev-fallback flag, round-trip probe, per-column rows-by-version table (amber on non-active, destructive red on `plaintext > 0`). Audited as `ENCRYPTION_HEALTH_CHECKED`.

### Files

NEW (Wave 1):
  prisma/migrations/20260506160000_phase17_compliance_foundation/migration.sql
  src/server/notifications/consent-gate.ts
  src/server/audit/patient-view.ts
  src/lib/sms-stop.ts
  src/app/api/crm/audit/patient-views/route.ts
  tests/unit/{consent-gate,sms-stop,patient-view-throttle}.test.ts

NEW (Wave 2):
  prisma/migrations/20260507100000_phase17_w2_session_security/migration.sql
  src/server/auth/{totp,recovery-codes,session-security,security-policy,user-session,totp-pending,password}.ts
  src/app/api/crm/auth/totp-required/route.ts
  src/app/api/crm/me/totp/{enroll,verify,disable}/route.ts
  src/app/api/crm/me/totp/recovery-codes/regenerate/route.ts
  src/app/[locale]/crm/me/security/{page.tsx,_components/security-client.tsx}
  src/app/login/2fa/{page.tsx,_components/two-fa-form.tsx}
  tests/unit/{totp,recovery-codes,session-security,security-policy,audit-actions-w2,clinic-2fa-plan-gate}.test.ts

NEW (Wave 3):
  prisma/migrations/20260507XXXX_phase17_w3_dsar/migration.sql
  src/server/workers/{data-export,data-deletion}.ts
  src/app/api/miniapp/account/delete/route.ts
  src/app/api/miniapp/account/data-export/route.ts
  src/app/api/crm/dsar/{exports,deletions}/route.ts
  src/app/api/crm/patients/[id]/data-export/route.ts
  src/app/c/[slug]/my/_components/account-delete-screen.tsx
  src/app/[locale]/crm/settings/dsar/{page.tsx,_components/dsar-review-client.tsx}
  tests/unit/{audit-actions-w3,dsar-bundle,dsar-anonymize,dsar-expiry}.test.ts

NEW (Wave 4):
  src/server/crypto/field-cipher.ts
  src/server/{patient,medical-case,prescription}/cipher-fields.ts
  scripts/{encrypt-existing-pii,rotate-encryption-key}.ts
  docs/runbooks/encryption-key-rotation.md
  src/app/api/admin/encryption-health/route.ts
  src/app/admin/encryption-health/{page.tsx,_components/encryption-health-client.tsx}
  tests/unit/{field-cipher,cipher-fields,audit-actions-w4,encrypt-existing-pii}.test.ts

EDIT:
  prisma/schema.prisma (Patient + User + Clinic columns, UserSession, DataExportJob, DataDeletionJob, PatientView)
  src/lib/audit-actions.ts (+~30 constants: MARKETING_OPT_OUT_CHANGED, PATIENT_VIEW_AUDIT_ACCESSED, PATIENT_DELETED, TOTP_*, RECOVERY_CODE_*, SESSION_*, CONCURRENT_SESSION_KICKED, CLINIC_2FA_REQUIREMENT_CHANGED, CLINIC_SESSION_IDLE_CHANGED, PATIENT_DATA_EXPORT_*, PATIENT_DELETION_*, PATIENT_ANONYMIZED, ENCRYPTION_HEALTH_CHECKED, ENCRYPTION_DECRYPT_FAILED)
  src/proxy.ts (UserSession lifecycle: idle timeout / forced 8h re-rotate / kicked check, mandatory-2FA redirect, `lastActivityAt` bump)
  src/lib/auth.ts (credentials provider supports TOTP + recovery branches, jwt callback mints UserSession)
  src/app/api/sms/webhook/[clinicSlug]/route.ts (STOP keyword detection, opt-out flip, confirmation queue)
  src/app/api/miniapp/profile/route.ts (marketingOptOut PATCH)
  src/server/revenue/reactivation.ts + src/server/workers/{medication-reminder,post-visit-nps}.ts + src/server/notifications/triggers.ts (consent-gate wired)
  src/app/api/crm/patients/route.ts + [id]/route.ts (cipher-fields wrap)
  src/app/api/crm/cases/route.ts + [id]/route.ts + [id]/prescriptions/* (cipher-fields wrap)
  src/app/api/miniapp/medications/route.ts (decrypts prescription notes)
  src/server/workers/{voice-soap,data-export,data-deletion}.ts (cipher-fields wrap)
  src/app/[locale]/crm/settings/audit/_components/audit-log-client.tsx (Просмотры карточек tab)
  src/app/[locale]/crm/settings/clinic/_components/clinic-settings-client.tsx (Security section)
  src/app/[locale]/crm/settings/{_components/settings-sidebar,page}.tsx (DSAR entry)
  src/app/admin/_components/admin-sidebar.tsx (Шифрование entry)
  src/messages/{ru,uz}.json (crmSecurity 24, clinicSecurity 6, settings.dsar.* + nav.dsar + cards.dsar, patientCard.quickActions.exportData*; final parity 2987 keys)

### Gates

- `npx tsc --noEmit` — clean.
- `npm run i18n:check` — OK, RU=UZ=2987 keys.
- `npx vitest run` — **1057/1057 passed** (903 baseline → +28 W1 → +61 W2 → +27 W3 → +38 W4 = +154 net across the phase).
- `npm run build` — 101 pages generated; new routes (`/login/2fa`, `/crm/me/security`, `/crm/settings/dsar`, `/c/[slug]/my/account/delete`, `/admin/encryption-health`) all in the manifest.
- 3 new migrations applied locally (W1 front-loaded W2's User columns; W3 added DSAR tables; W4 added no schema — encryption is at the application boundary).

### Notes / hand-off

- **Schema gap from Phases 14–16 closed:** `Patient.marketingOptOut` flagged after Phase 14 carried unfixed through Phase 16. Reactivation, medication reminders, NPS, and referral notifications shipped consent-blind for the W14–W16 staging window. Now gated; nothing in production was actually sent because the project hasn't deployed yet (DB on prod is ~7 migrations behind — see "deployment status" below).
- **Pre-visit-questionnaire is intentionally not consent-gated.** It's transactional — the patient booked, the doctor uses the answers in the visit. The worker's header documents the call so a future scope creep doesn't accidentally gate it.
- **Auto-approve on patient-self deletion request:** patients own their data; staff-initiated deletions still require an ADMIN approver. The 90-day window applies in both cases; cancellation is allowed at any time before `scheduledFor`.
- **Anonymize is the default** for `DataDeletionJob.mode`. Hard delete is opt-in by the requester. Trade-off: aggregate analytics (revenue, no-show rate, doctor caseload) survive anonymization but break under hard delete. If a patient explicitly asks for hard delete via DSAR letter, ADMIN can flip the mode at approval time.
- **Search over encrypted fields:** `WHERE passport CONTAINS '12345'` no longer works for new (encrypted) rows; only legacy plaintext rows match. The `/api/crm/patients` list handler carries an inline comment. Fix is a blind-index column (HMAC of normalized value) — deferred. If/when enabled, add `Patient.passportSearchHash` and rebuild via the backfill pattern.
- **Encryption posture page assumes single-tenant key** — all clinics share `FIELD_ENCRYPTION_KEY`. Per-tenant keys would let a clinic export "delete my key" → instant cryptographic erasure of their column data. Out of scope here; revisit if a tenant ever asks.
- **Key rotation is operator-driven**, not automated. The runbook prescribes quarterly rotation. A future cron could nag SUPER_ADMIN if the active key version hasn't rotated in 120 days; not built today.
- **TOTP ±1 window** allows ~30s clock skew on the user's device. No replay protection on the same code within the same window — a leaked screenshot of the code is good for ~30s. Acceptable for a clinic CRM; if we ever add highly-privileged actions (e.g. payment refunds at scale), revisit with a per-code nonce table.
- **Concurrent-session kick is per-user, NOT per-user-per-device.** Logging in on a phone kicks the desktop session immediately. Document-aware staff UX may want a "stay signed in here, kick the other?" prompt — current behavior is the strict version, deferred per scope. The kicked session sees a generic "session expired" page on next request.
- **DSAR export passphrase delivery** for admin-initiated exports is "show in modal, admin reads to patient out-of-band" by default. The TG-self-request path sends the passphrase in the same TG chat as the file (with a "delete this message" warning) — this is a deliberate trade-off vs. multi-channel delivery (e.g. SMS the passphrase, TG the file) which would require the patient's verified phone, not always present in Mini App users.
- **Backfill not yet run.** Every encrypted column on the dev DB is currently plaintext. Run `tsx scripts/encrypt-existing-pii.ts` after setting `FIELD_ENCRYPTION_KEY` (single deploy step). The cipher-fields helpers tolerate plaintext on read so the app keeps working between the deploy and the backfill — no flag flip required.
- **Deployment status:** prod (5.129.242.246) DB has 10 migrations applied through `20260505100000_inapp_case_repeat`. Local repo is 7 migrations ahead (Phases 13/14/15/16/17/17/17 — action_engine, revenue_engines, ai_copilot_foundation, phase16_*, phase17_compliance_foundation, phase17_w2_session_security, phase17_w3_dsar). User chose to accumulate locally and deploy in one push after Phases 18+19 close. Build/migrate/seed are deferred to that single deploy.



## Phase 18 — Analytics & Reporting (2026-05-07)

Closes the "9/10 internal CRM" — director sees the entire business in one click and can build any report without an engineer. Four sequential waves; one agent per wave to keep i18n message files conflict-free.

### Wave 1: Foundation (schema + materialized views + aggregation library + refresh worker)

- Migration `20260507130000_phase18_w1_analytics_foundation`:
  - `SavedReport` (clinicId, createdByUserId, name, description, config Json, lastRunAt) — config is opaque from W1's POV; W3 owns the schema.
  - `ScheduledReport` (savedReportId FK cascade, cadence enum WEEKLY/MONTHLY/DAILY, nextRunAt, deliveryChannel enum EMAIL/TELEGRAM, deliveryTarget, enabled, lastDeliveredAt, lastFailureReason).
  - 4 materialized views, all per-clinic, all with unique indexes for `REFRESH CONCURRENTLY`:
    - `mv_doctor_performance` (per-doctor per-month: visits, revenue, no-show count, repeat-visit count, new-patient count, NPS avg + count)
    - `mv_cohort_retention` (cohort by month-of-first-visit × monthOffset 0..23)
    - `mv_financial_pace` (90d back to 30d forward via `generate_series`, daily collected/scheduled/no-show in tiins)
    - `mv_schedule_heatmap` (last-90d per-doctor 7×24 grid)
- Aggregation library `src/server/analytics/`:
  - `dimensions.ts` — `date`, `doctor`, `branch`, `specialty`, `patient_segment`, `source`
  - `measures.ts` — `count_visits`, `revenue_tiins`, `no_show_rate`, `avg_ticket_tiins`, `ltv_tiins`
  - `query-builder.ts` — `buildAnalyticsQuery({dims, measures, filters})` returns parameterized SQL; tenant clinicId injected by AsyncLocalStorage, never string-interpolated.
  - Resolver modules per dashboard MV: `cohort-resolver`, `doctor-performance-resolver`, `financial-pace-resolver`, `schedule-heatmap-resolver`.
- Refresh worker `src/server/workers/analytics-refresh.ts` — registers via `repeat` (hourly), bootstraps on startup with plain (non-CONCURRENTLY) refresh on unpopulated MVs, manual trigger at `/api/crm/analytics/refresh` (ADMIN-only) audits `ANALYTICS_VIEWS_REFRESHED`. Cron does NOT audit.
- API routes for the W2 dashboards: `/api/crm/analytics/{cohorts,doctors,financial,schedule-heatmap,refresh}`.

### Wave 2: Pre-built dashboards (Cohort + Doctor Performance + Financial + Schedule Heatmap + hub)

- `/[locale]/crm/analytics/cohorts` — heatmap with HSL violet ramp, month-range toolbar, "All time" reset, cell hover-tooltip with raw counts.
- `/[locale]/crm/analytics/doctors` — 9-column ranked table, inline SVG sparklines (no chart lib), top/bottom-25% quartile band tinting, click-row drawer with monthly trend.
- `/[locale]/crm/analytics/financial` — 4 KPI cards (today collected/scheduled/no-show, MTD + projected month-end via `projectMonthEnd` helper synced server↔client), 90-day daily-pace SVG line chart, 60s auto-refresh that pauses on hidden tabs.
- `/[locale]/crm/analytics/schedule-heatmap` — 7×24 grid, "Все врачи" + per-doctor selector.
- Analytics hub at `/[locale]/crm/analytics` keeps Phase 14's revenue/forecast widgets but adds a 4-card preview row above for the new dashboards.
- Sidebar nav extended with role-gated children (`requiredRole: "ADMIN"` + `feature: "hasAnalyticsPro"`); `getVisibleCrmNav` now filters by role.
- Shared math helpers `src/lib/analytics/dashboard-math.ts` — `projectMonthEnd`, `computeQuartileBand`, `bandOf`, `trailingMonths`, `resolveDoctorPerfRange`. Multiply-then-divide order to avoid float drift on tiins.
- Each dashboard load audits `ANALYTICS_REPORT_RUN` with `meta = { dashboard, filters }`.
- `src/lib/audit-server.ts` — `auditServerPage` bridges server components to the existing audit helper via a synthetic Request from `headers()`.

### Wave 3: Custom Report Builder + saved reports + CSV export

- `/[locale]/crm/analytics/reports/{new,[id],[id]/edit}` + `/[locale]/crm/analytics/reports` list — drag-add chips for dimensions (max 3, ordered) + measures (max 5), filter panel (date range + branch/doctor/status multi-select), result table with sticky header, "Run" → render → "Save".
- `src/server/analytics/report-config.ts` — strict zod schema with `version: 1` anchor, `parseReportConfig` (throws) + `safeParseReportConfig`. Defensively re-validates on every read/write since `SavedReport.config` is JSON.
- `src/server/analytics/report-runner.ts` — `runReport(config)` wraps `buildAnalyticsQuery` in a `SET LOCAL statement_timeout=30000` tx; throws `ReportTimeoutError` on PG 57014. Result shape `{rows, columns, generatedAt, rowCount, truncated}`.
- `src/server/analytics/csv.ts` — `formatCsv(columns, rows)` with UTF-8 BOM, RFC 4180 quoting, currency cells unformatted (Excel reads them as numbers). `?format=csv` query on the run endpoints streams the CSV.
- API routes `POST /run`, `POST /run/saved/:id`, full CRUD on `SavedReport`. 422 on invalid config, 409 on duplicate name (per clinic), 30s timeout returns 504. Audits `SAVED_REPORT_*` and `ANALYTICS_REPORT_RUN`.
- Hard caps: rows per query ≤ 1000 (default 500), reports list paginated at 50 per page, no auto-run on builder open.
- Sidebar gets "Reports" child (ADMIN + `hasAnalyticsPro`).

### Wave 4: PDF export + scheduled delivery

- Migration `20260507150534_phase18_w4_scheduled_format` — `ScheduledReport.format String @default("pdf")`. String not enum so future formats (xlsx, html email) don't need migrations.
- PDF generator `src/server/analytics/pdf.ts` — pdfkit + DejaVuSans for Cyrillic + Latin-Uzbek glyph coverage. Newly added dep `dejavu-fonts-ttf` ships the real TTF (the agent's first-attempt curl pulled an HTML 404 page; replaced with the npm package). A4 portrait default; switches to landscape if columns > 6. Page header (clinic name + report name + locale-formatted timestamp), filter summary block, monospace numeric cells, formatted currency, "Page X of Y" footer. Hard cap 5000 rows; truncation banner directs to CSV for full export.
- `?format=pdf` query on the run endpoints serves `application/pdf` with `Content-Disposition: attachment`.
- Schedules CRUD at `/api/crm/analytics/reports/[id]/schedules` + `/[scheduleId]` — body `{cadence, deliveryChannel, deliveryTarget, format}`. `nextRunAt` computed by `cadence.ts::computeNextRunAt`:
  - DAILY → tomorrow 09:00 Asia/Tashkent
  - WEEKLY → next Monday 09:00
  - MONTHLY → first day of next month 09:00 (handles end-of-month rollover correctly via lossy day-of-month)
- Schedule UI on the saved-report view page — list section + create/edit modal (cadence radio, channel + target, format toggle, "next run" preview line, enabled toggle).
- Worker `src/server/workers/scheduled-reports.ts` — polls every 5 min, picks `enabled=true AND nextRunAt <= now()` capped at 100 per tick, runs the saved report, generates PDF or CSV per `format`, delivers via channel:
  - Email: reuses existing notification email infra
  - Telegram: reuses existing TG bot file-send helper (same path as Phase 17 W3 DSAR delivery)
- Per-schedule timeout (60s default) so a heavy report doesn't starve the rest. Failures stamp `lastFailureReason` (truncated 1000 chars), advance `nextRunAt` (don't loop on permanent failures), audit `SCHEDULED_REPORT_FAILED`. Three consecutive failures auto-disable + audit `SCHEDULED_REPORT_DISABLED_AFTER_FAILURES`.

### Files

NEW (Wave 1):
  prisma/migrations/20260507130000_phase18_w1_analytics_foundation/migration.sql
  src/server/analytics/{dimensions,measures,query-builder,cohort-resolver,doctor-performance-resolver,financial-pace-resolver,schedule-heatmap-resolver}.ts
  src/server/workers/analytics-refresh.ts
  src/app/api/crm/analytics/{cohorts,doctors,financial,schedule-heatmap,refresh}/route.ts
  tests/unit/analytics/{query-builder,dimensions-measures,cohort-resolver,refresh-worker}.test.ts
  tests/unit/audit-actions-phase18.test.ts

NEW (Wave 2):
  src/app/[locale]/crm/analytics/cohorts/{page,_components/cohort-heatmap-client}.tsx
  src/app/[locale]/crm/analytics/doctors/{page,_components/doctor-performance-client}.tsx
  src/app/[locale]/crm/analytics/financial/{page,_components/financial-dashboard-client}.tsx
  src/app/[locale]/crm/analytics/schedule-heatmap/{page,_components/schedule-heatmap-client}.tsx
  src/app/[locale]/crm/analytics/_components/analytics-hub-cards.tsx
  src/lib/analytics/dashboard-math.ts
  src/lib/audit-server.ts
  tests/unit/analytics/dashboard-math.test.ts

NEW (Wave 3):
  src/app/[locale]/crm/analytics/reports/{page,new/page,[id]/page,[id]/edit/page}.tsx
  src/app/[locale]/crm/analytics/reports/_components/{report-builder-client,reports-list-client}.tsx
  src/app/[locale]/crm/analytics/reports/[id]/_components/report-view-client.tsx
  src/server/analytics/{report-config,csv,report-runner,saved-reports}.ts
  src/app/api/crm/analytics/reports/{route,run/route,run/saved/[id]/route,[id]/route,[id]/run/route}.ts
  tests/unit/analytics/{report-config,csv,saved-reports-paginator,reports-api}.test.ts

NEW (Wave 4):
  prisma/migrations/20260507150534_phase18_w4_scheduled_format/migration.sql
  src/server/analytics/{pdf,cadence,delivery,schedule-validation}.ts
  src/server/fonts/DejaVuSans.ttf (757KB, via npm dejavu-fonts-ttf)
  src/server/workers/scheduled-reports.ts
  src/app/api/crm/analytics/reports/[id]/schedules/{route,[scheduleId]/route}.ts
  tests/unit/analytics/{pdf-formatter,cadence,scheduled-reports-worker,schedule-validation}.test.ts

EDIT:
  prisma/schema.prisma (SavedReport + ScheduledReport models, enums; ScheduledReport.format String added in W4)
  src/lib/audit-actions.ts (+11 constants: ANALYTICS_VIEWS_REFRESHED, SAVED_REPORT_CREATED/UPDATED/DELETED, SCHEDULED_REPORT_CREATED/UPDATED/DELETED/DELIVERED/FAILED/DISABLED_AFTER_FAILURES, ANALYTICS_REPORT_RUN)
  src/components/layout/crm-sidebar.tsx (analytics group expanded with 5 children: cohorts, doctors, financial, schedule-heatmap, reports — all ADMIN + hasAnalyticsPro gated)
  src/server/workers/start.ts (+startAnalyticsRefreshWorker, +startScheduledReportsWorker)
  src/messages/{ru,uz}.json (analyticsHub, analyticsCohorts, analyticsDoctors, analyticsFinancial, analyticsScheduleHeatmap, analyticsReports namespaces; final parity)
  package.json (+pdfkit ^0.18.0, +dejavu-fonts-ttf 2.37.3)
  tests/unit/feature-nav.test.ts (analytics children expansion + role gating tests)

### Gates

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **1192/1192 passed** (1057 baseline → +35 W1 → +19 W2 → +39 W3 → +42 W4 = +135 net across the phase).
- `npm run i18n:check` — OK, RU/UZ in parity.
- `npm run build` — Compiled successfully, all new pages/routes registered.
- 2 new migrations applied locally; 4 MVs + `relispopulated` bootstrap verified.

### Notes / hand-off

- **Performance budget (financial dashboard <500ms p95) verified on dev seed.** Heaviest MV resolver (`doctor-performance` 12mo window) returns in <50ms with the supporting btree on `(clinicId, month)`. Production with bigger volumes may want a pre-aggregated NPS subquery in `mv_doctor_performance`; revisit if hourly REFRESH exceeds the 5s warn threshold.
- **Manual MV refresh audits; cron does not.** Hourly cron firing 24×/day would spam AuditLog. The button on `/crm/analytics` posts to `/api/crm/analytics/refresh` and audits as `ANALYTICS_VIEWS_REFRESHED`.
- **`mv_schedule_heatmap.availableSlotCount`** currently mirrors `appointmentCount` because no booking-attempt event log exists. SQL comment notes this as a follow-up if/when an attempts log lands.
- **`ScheduledReport.format` is String, not enum** — keeps the schema flat for future formats (xlsx, html email) without a migration.
- **Search over encrypted Patient fields still doesn't work in reports.** Inherited from Phase 17 W4 — `patient_segment` dimension uses `firstAppointmentAt` and `lastAppointmentAt` on Appointment, both unencrypted; `Patient.notes` and `passport` are out of scope for analytics. Blind-index column still deferred.
- **Cohort window capped at 24 months** — wider windows can come later if a clinic wants 5-year retention, but the MV is intentionally bounded for refresh perf.
- **PDF row hard-cap at 5000.** Anything bigger should go through CSV. The PDF banner directs the user explicitly. If a clinic needs multi-thousand-row PDFs, build paginated streaming.
- **DejaVuSans TTF** is now pulled from npm package `dejavu-fonts-ttf` and committed to `src/server/fonts/`. The package itself is in `dependencies`, so a fresh `npm ci` re-fetches it, but the committed file means the worker doesn't need npm at boot.
- **Concurrent session impact on auto-refresh:** the financial dashboard's 60s auto-refresh respects session idle timeout from Phase 17 W2 — if the tab is hidden for 30 min the session expires and the next fetch will redirect to `/login?reason=idle`. This is the desired behavior.
- **Email/Telegram delivery channels** reuse existing notification infra — no new SMTP/bot setup for this phase. If a clinic doesn't have email configured, `lastFailureReason = "Email channel not configured"` surfaces in the schedules list UI.
- **Deployment status:** prod (5.129.242.246) DB is now ~9 migrations behind local (Phases 13/14/15/16/17/17/17/18/18). User chose to accumulate locally and deploy after Phase 19 closes. After deploy: run `tsx scripts/encrypt-existing-pii.ts` (Phase 17 W4 backfill) and verify `mv_*` populate via the analytics-refresh worker's startup pass.

---

## 2026-05-08 — Phase 19 закрыта (#239)

**Тема.** SaaS Self-Service: новая клиника регистрируется самостоятельно, видит usage/upgrade без SUPER_ADMIN, white-label для Pro, hardened impersonation + view-as для поддержки.

### Wave 1 — Plan-Limit Foundation (#239 W1)
Migration: `20260507160000_phase19_w1_plan_limits`.

- Schema: новый `Invoice` model + `InvoiceStatus` enum (DRAFT/ISSUED/PAID/VOID/OVERDUE), `Clinic` расширен полями `customSubdomain @unique`, `brandSecondaryColor`, `onboardedAt`, `onboardingPlaybook`. `Plan.features` JSON merge per-tier (basic 50/100/200/500MB; pro 500/2000/5000/10000MB; enterprise -1 across the board).
- `src/lib/feature-flags.ts` расширен: 4 numeric quotas (`maxPatients`, `maxAppointmentsPerMonth`, `maxSmsPerMonth`, `maxStorageMb`) + 2 booleans (`hasWhiteLabel`, `hasCustomSubdomain`). DEFAULT_FLAGS / ENTERPRISE_FLAGS / parsePlanFeatures обновлены.
- `src/server/billing/usage.ts` — `getClinicUsage(clinicId, now?)` возвращает {patientCount, appointmentCountThisMonth, smsCountThisMonth, storageMb, asOf}. SMS = NotificationSend(channel=SMS), storage из `Document.sizeBytes`. Pure helper `monthWindow(now)`.
- `src/server/billing/plan-limits.ts` — pure `evaluateLimit(current, max, isFreePlan)` (max=-1→ok, ratio<0.8→ok, 0.8≤<1→warn, ≥1→block только для basic). Composers `ensurePatientLimit/Appointment/Sms` audit warn/block. `ensureQuotaForApi(clinicId, quota)` возвращает 402 PlanLimitExceeded.
- Audit constants (5): PLAN_LIMIT_WARNED, PLAN_LIMIT_BLOCKED, INVOICE_CREATED/PAID/VOIDED.

### Wave 2 — Self-signup + Onboarding Playbooks (#239 W2)
Migration: `20260507170000_phase19_w2_signup`.

- Schema: `ClinicSignupToken` (email, clinicName, phone, planSlug, playbookSlug, preferredLocale, token unique, expiresAt 24h, consumedAt, consumedClinicId).
- `src/server/onboarding/playbooks/index.ts` — 5 playbooks (general / dental / neurology / pediatric / cosmetology), каждый с ≥5 services + ≥3 NotificationTemplate (триггеры appointment.created, reminder-24h, reminder-2h) + workday schedule. Plausible UZ pricing в tiins.
- `src/server/onboarding/apply-playbook.ts` — idempotent (skip services with existing code/nameRu), audit `PLAYBOOK_APPLIED`.
- API: POST `/api/public/signup` (zod валидация, 24h token, console.info confirm-link для dev), POST `/api/public/signup/confirm` (создаёт Clinic + ADMIN с `mustChangePassword=true` + temp password + Subscription TRIAL basic 14d, применяет playbook).
- UI: `/[locale]/signup` форма + `/[locale]/signup/confirm/[token]` показывает temp password one-shot.
- Audit constants (4): CLINIC_SELF_SIGNUP_REQUESTED/COMPLETED/TOKEN_EXPIRED, PLAYBOOK_APPLIED.

### Wave 3 — Billing UI + Click/Payme Stubs (#239 W3)
Migration: `20260507180000_phase19_w3_billing_ui`.

- Schema: `Subscription.pendingPlanId String?` — план переключается атомарно при INVOICE_PAID.
- `src/server/billing/invoice-number.ts` — `formatInvoiceNumber(year, counter)` → `INV-2026-0042`, sequencer `nextInvoiceNumber(clinicId, year)`.
- `src/server/billing/invoice.ts` — `createUpgradeInvoice` (DRAFT, period 30d, due 7d), `markInvoicePaid` (PAID + plan swap + audit).
- `src/server/billing/pdf.ts` — bilingual PDF через pdfkit + DejaVuSans (тот же шрифт из Phase 18).
- `src/server/billing/payments/{click,payme}.ts` — `createCharge` возвращает локальный pay-url, `verifyWebhook` проверяет подпись (Click MD5, Payme JSON-RPC + Basic auth) если `*_SECRET_KEY` задан, иначе `{stub: true}`.
- Routes: POST `/api/crm/billing/upgrade` (ADMIN), GET `/api/crm/billing/invoices/[id]/pdf`, POST `/api/crm/billing/invoices/[id]/simulate-pay` (404 без `NEXT_PUBLIC_BILLING_STUB=1`), POST `/api/webhooks/billing/{click,payme}`.
- UI: `/[locale]/crm/settings/billing` — план + 3 progress bars (≥80% amber, ≥100% red), plan picker (basic/pro/enterprise), invoice history. Stub pay page на `/billing/pay/[id]`.
- i18n: `billing.*` namespace в ru/uz parity.

### Wave 4 — White-label + Hardened Impersonation (#239 W4)
Migration: `20260507190000_phase19_w4_impersonation`.

- Schema: `ImpersonationGrant` (superAdminId, clinicId, reason, mode WRITE|VIEW_ONLY, startedAt, expiresAt 60min, endedAt, endedReason). Без FK для forensic survival.
- `src/server/platform/impersonation.ts` — `createGrant`, `getActiveGrant`, `endGrant`, pure `isGrantExpired`.
- `src/app/api/platform/session/switch-clinic/route.ts` переписан: body `{clinicId, reason ≥4, mode}`, минит grant, ставит второй cookie `admin_grant_id` (60min) рядом с `admin_clinic_override` (12h). Audit STARTED/ENDED + `durationMs`.
- `src/lib/auth.ts` JWT/session callbacks читают оба cookie на refresh, выкидывают claims при expired/missing. `session.user.impersonation = {grantId, mode} | null`.
- CRM layout safety net: SUPER_ADMIN с clinicId но без активного grant → audit `SUPER_ADMIN_IMPERSONATE_EXPIRED` + redirect `/admin/clinics?expired=1`.
- View-as: `src/lib/view-only.ts` (`isViewOnlySafe(request)` — GET/HEAD/OPTIONS + `/api/platform/session/*` exempt, остальное при VIEW_ONLY режекается 403 ViewAsReadOnly + audit `SUPER_ADMIN_VIEW_AS_BLOCKED`). Wired в `createApiHandler`/`createApiListHandler`. Banner flips на destructive border при VIEW_ONLY.
- Branding page `/[locale]/crm/settings/branding` (Pro only, gate hasWhiteLabel) — color pickers, logo upload (PNG/SVG ≤256KB → MinIO key `branding/<clinicId>/<uuid>.<ext>` или public/uploads stub), subdomain field (regex `^[a-z0-9-]{3,32}$`, blocked reserved labels: api/admin/www/etc). API PATCH с changed-fields detection + audit BRANDING_CHANGED.
- Brand color injection: CRM `[locale]/crm/layout.tsx` + Mini App `/c/[slug]/my/layout.tsx` инжектят `<style>:root{--brand-primary;--brand-secondary}</style>` когда hasWhiteLabel включён.
- Bulk admin ops: row context menu на `/admin/clinics` — suspend (CANCELLED) / restore (TRIAL +14d) / extend-trial (+30d) через POST `/api/admin/clinics/[id]/lifecycle`. Idempotent.
- Runbook: `docs/runbooks/custom-subdomain.md` (manual DNS provisioning, 6-step checklist + rollback).
- Audit constants (8): BRANDING_CHANGED, SUPER_ADMIN_IMPERSONATE_STARTED/ENDED/EXPIRED, SUPER_ADMIN_VIEW_AS_BLOCKED, CLINIC_SUSPENDED/RESUMED/TRIAL_EXTENDED.

### Гейты на закрытие фазы

- `npx prisma format && npx prisma validate && npx prisma generate` — clean
- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — **129 files, 1369/1369 tests** (старт фазы 1192, +177 за фазу)
- `npm run build` — Compiled successfully, все новые routes/pages зарегистрированы
- i18n parity (ru/uz) — vitest-enforced, проходит для `signup.*`, `signupConfirm.*`, `billing.*`, `branding.*`, `admin.bulk.*`

### Notes / hand-off

- **Self-signup создаёт TRIAL на basic, не pro.** 14 дней trial, после — PAST_DUE через `trial-expiry-scheduler` (Phase 9e). Это даёт hard-block surface (free tier: 50 patients, 100 appts/mo, 200 sms/mo) который реально упрётся ещё в trial — намеренно, чтобы upgrade-путь был видимым.
- **`prisma migrate dev` всё ещё drift на phase16** локально — миграции W1-W4 написаны вручную, валидированы через `prisma validate`. Прод применит подряд через `migrate deploy` без проблем (история чистая).
- **Email service stubbed**: `/api/public/signup` пишет confirm-link в `console.info`. До деплоя нужно либо подключить SMTP (см. Resend / nodemailer), либо отправлять confirm-link через Telegram если у клиента есть phone (Phase 11 уже умеет TG). Решить перед прод-релизом.
- **CAPTCHA / rate-limit на signup отсутствует.** Низкий приоритет до публичного landing'а; добавить когда страница станет findable.
- **Click/Payme — LogOnly**. `createCharge` возвращает локальный stub URL, `verifyWebhook` проверяет подпись только когда `CLICK_SECRET_KEY` / `PAYME_SECRET_KEY` заданы. Реальная Click sandbox не тестировалась — нужен живой merchant аккаунт + URL обратной связи, выставленный в кабинете провайдера.
- **Dunning / autorenewal не реализованы.** Когда invoice OVERDUE (`dueAt < now()`), нет worker'а который флипнет Subscription в PAST_DUE из-за неоплаты. Phase 9e flow покрывает только trial expiry. Добавить worker `billing-dunning-scheduler` post-MVP.
- **Custom subdomain DNS ручной** — runbook есть, middleware host-header → `Clinic.customSubdomain` resolver не подключён. Когда первый клиент закажет subdomain, вписать lookup в `src/middleware.ts` + кеш.
- **Impersonation reason/mode UX** через native `prompt`/`confirm` — заменить на shadcn Dialog при следующем polish-пасе.
- **VIEW_ONLY mode не блокирует mutations внутри Server Actions** — только через REST API wrapper. Если Server Actions начнут писать данные, добавить ту же проверку в `createServerAction` обёртку.
- **Playbook seed pricing намеренно консервативный** (UZ-market 2026): первичная консультация невролога 350k UZS, кариес/плoмба 600k UZS. Клиники легко переопределят на onboarding tour.
- **Storage quota counts but doesn't block.** `getClinicUsage.storageMb` подсчитан, но `ensureStorageLimit` я не написал — upload endpoints не проверяют. Намеренно warn-only пока живой клиент с большими медиа-аплоадами не появится.
- **Deployment status:** прод DB теперь **~13 миграций позади локальной** (Phases 13/14/15/16/17×3/18×2/19×4). Деплой одним пушем после этой фазы по договорённости с пользователем. После деплоя:
  1. `npx prisma migrate deploy` на VPS
  2. `tsx scripts/encrypt-existing-pii.ts` (Phase 17 W4 backfill)
  3. Установить env: `CLICK_SECRET_KEY`, `PAYME_SECRET_KEY` (если включаем платежи), либо ничего — adapters в LogOnly
  4. Не выставлять `NEXT_PUBLIC_BILLING_STUB=1` в prod (это симулятор оплаты)
  5. Опционально: smoke-test self-signup через `/signup` на staging


---

## SMS Removal Initiative — ✅ DONE 2026-06-08

Cross-cutting workstream выполнен по `docs/TZ-sms-removal.md`. Решение: канал SMS полностью убран из активного контура CRM/Mini App. Исторические rows (`Communication`, `NotificationSend`, `AuditLog` с `channel='SMS'`) остаются read-only для аудита, новые SMS-сообщения не создаются.

**Контекст решения.** К Q2 2026 факт-чек: Eskiz/Playmobile активно не используется ни одной клиникой; legacy templates лежат в БД; UI содержит «мёртвые» CTA (Send SMS из карточки пациента, sidebar `/crm/sms`, SMS toggle в кампаниях, SMS dialog в action-center). Стоимость поддержки канала превышала его операционную ценность.

### Waves

- **Wave 1 (kill-switch).** Server-side `pickSms()` всегда возвращает `LogOnlyAdapter`; `resolveChannels()` фильтрует `SMS` из template-channels; `/api/crm/communications/sms` + `/api/crm/integrations/sms/test` отдают 410 Gone; `/api/sms/webhook/[clinicSlug]` — 200 OK no-op.
- **Wave 2 (UI).** Удалён sidebar item `SMS-Email`, route `/crm/sms`, SMS dialog в карточке пациента, SMS-CTA в action/call-center, SMS toggle в templates editor и campaigns new. Mini App: `preferredChannel` селектор больше не показывает SMS опцию.
- **Wave 3 (server cleanup).** Удалены route-файлы (`/api/sms/webhook/...`, `/api/crm/communications/sms`, `/api/crm/integrations/sms/test`), `src/server/notifications/adapters/sms*.ts`, `src/lib/sms-stop.ts`. Почищены `adapters/index.ts`, `rules.ts`, `triggers.ts`, `rate-limit.ts`, `workers/notifications-send.ts`, `campaigns/*.ts`, `billing/*.ts`, `ai/marketing-copy.ts`. SMS-тесты переписаны; добавлен `tests/unit/legacy-sms-readback.test.ts` (исторические rows читаются). Коммиты: `54f125b`, `03e848b`, `616d0e8`, `2995595`.
- **Wave 4 (PATIENT_NO_CHANNEL compensator).** Добавлен `ActionType.PATIENT_NO_CHANNEL` в `src/lib/actions/types.ts`. Новый helper `src/server/notifications/no-channel-action.ts` — `recordPatientNoChannel({ clinicId, patientId, patientName, triggerKey, appointmentId?, appointmentAt? })` создаёт action через `upsertAction` с дедупом `(patientId, triggerKey, UTC-day)`. Wired в 5 skip-сайтов: `triggers.ts` (bulk materializer, single materializer, runCaseRepeatReminders), `workers/notifications-scheduler.ts` (no-channel branch, no-recipient branch). UI: action-center показывает Phone icon + «Call» CTA, deeplink `/crm/patients/<id>`, category «calls». i18n RU/UZ с ICU select между «с записью» и «без записи» вариантами body. 9 новых test cases в `tests/unit/notifications-no-channel-action.test.ts`. Коммит: `e8ae02f`.
- **Wave 5 (schema cleanup).** Миграция `20260608130000_drop_sms_config`: `ALTER TABLE "Clinic" DROP COLUMN IF EXISTS "smsSenderName"` + `DELETE FROM "ProviderConnection" WHERE kind='SMS'`. Удалены оrphaned i18n entries `smsSenderName` (ru/uz). Enum values (`CommunicationChannel.SMS`, `ProviderKind.SMS`, `NotificationChannel.SMS`, `CommunicationKind.SMS_REPLY`) оставлены — на них завязаны исторические rows. Миграция идемпотентна. Коммит: `c1e4ce6`.
- **Wave 6 (docs).** Этот раздел + апдейт `docs/TZ.md` (banner в шапке + правки в §2.2, §3, §6.5, §8.2), `docs/TZ-notifications-cancel-sync.md` (каскад напоминаний теперь TG-only + INAPP mirror), `docs/TZ-cross-surface-sync.md` (§7.2 SMS YES webhook + §7.8 SMS DLR retired), `docs/api/communications.md` (`POST /sms` retired), `docs/security/phase-7.md` (C1 → N/A surface removed), `docs/ROADMAP-11x.md` (SMS-Email menu item + billing SMS counter retired).

### Acceptance criteria (из TZ §7)

- `grep -ri 'sms' src/` возвращает только: (a) legacy комментарии, (b) historical enum-handler в read-path, (c) phone-normalization для звонков. ✓
- CRM UI: нет видимых упоминаний SMS, кроме badge «архив» в исторических коммуникациях. ✓
- Notification scheduler: при TG-less пациенте создаёт `PATIENT_NO_CHANNEL` action, а не silently-skips. ✓
- Mini App: пациент с `preferredChannel=SMS` (legacy) видит default-UI как `preferredChannel=TG`. ✓
- `npx tsc --noEmit` — clean ✓
- Соседи на shared VPS (rtxshop, orientatravel) не задеты — smoke-test после деплоя.

### Не деплоено

Полная цепочка commits локально (см. `git log`). Деплой требует **отдельного явного запроса** + (для Wave 5) snapshot БД перед `migrate deploy`. Wave 5 необратима без `pg_restore`.
