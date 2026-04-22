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

## Phase 3b — Telegram inbox + бот — 🔄 планируется
