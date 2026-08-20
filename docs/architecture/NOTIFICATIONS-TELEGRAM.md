# Уведомления и Telegram-контур — как есть

> Документ описывает **фактическое состояние кода** (не спеки). Источник истины — код;
> ссылки на `docs/TZ*.md` даны только как контекст. Всё непроверенное помечено «⚠️ требует проверки».
>
> Дата снимка: 2026-08. Корень: `/Users/joe/Desktop/medbook/medbook-uz`.

## Оглавление

1. [Каналы](#1-каналы)
2. [Шаблоны уведомлений](#2-шаблоны-уведомлений)
3. [Триггеры](#3-триггеры)
4. [Путь уведомления до пациента](#4-путь-уведомления-до-пациента)
5. [Привязка пациента к Telegram](#5-привязка-пациента-к-telegram)
6. [Mini App пациента](#6-mini-app-пациента)
7. [Чат врач↔пациент](#7-чат-врачпациент)
8. [Кампании / рассылки](#8-кампании--рассылки)
9. [Эксплуатация](#9-эксплуатация)
10. [Карта файлов](#10-карта-файлов)

---

## 1. Каналы

Enum `CommunicationChannel` (`prisma/schema.prisma`): `SMS | TG | CALL | EMAIL | VISIT | INAPP`.

| Канал | Статус | Как реализован |
|---|---|---|
| **TG** | ✅ единственный внешний канал | Per-clinic бот (`Clinic.tgBotToken`), отправка через `src/server/telegram/send.ts` / адаптер `src/server/notifications/adapters/tg-clinic.ts` |
| **INAPP** | ✅ работает | Не внешняя отправка: строка `NotificationSend(channel=INAPP)` — это и есть сообщение; Mini App читает её из `/api/miniapp/inbox`. Адаптер `adapters/inapp.ts` — локальная запись, сразу `DELIVERED` |
| **SMS** | ❌ удалён | По `docs/TZ-sms-removal.md`: адаптеры удалены (Wave 3), лимитер и `resolveChannels` SMS не знают, `launchCampaign` отказывает SMS-кампаниям (`launch.ts:150`), ответ в SMS-диалог из CRM сразу помечается `FAILED` (`crm/conversations/[id]/messages/route.ts:221`). **Но**: значение `SMS` всё ещё в enum схемы (Wave 5 «schema cleanup» не выполнен) — legacy-строки читаемы |
| **EMAIL** | ⚠️ частично | Для **пациентских** уведомлений НЕ работает: воркер `notifications-send.ts` бросает `Channel EMAIL not dispatchable` (строка ~231). Email существует только для **плановых отчётов аналитики** (`src/server/analytics/delivery.ts`, nodemailer + `SMTP_HOST/PORT/USER/PASS`; канал `EMAIL` в `ScheduledReport.deliveryChannel`) |
| **CALL / VISIT** | ❌ адаптеров нет | В воркере тоже `not dispatchable` → строка падает в `FAILED`, оператор звонит вручную |

**Компенсатор для пациентов без Telegram** — Wave 4 SMS-removal: когда у пациента нет
`telegramId` (или legacy-шаблон был SMS), материализатор не молчит, а создаёт Action
`PATIENT_NO_CHANNEL` в `/crm/action-center` — `src/server/notifications/no-channel-action.ts`,
дедуп по `(clinicId, patientId, triggerKey, UTC-день)`.

---

## 2. Шаблоны уведомлений

### Модель `NotificationTemplate` (`prisma/schema.prisma:2396`)

| Поле | Смысл |
|---|---|
| `key` | Человекочитаемый slug (`appointment.reminder-24h`), уникален per clinic (`@@unique([clinicId, key])`). **Не** контракт матчинга — контракт это `trigger` + `triggerConfig`; slug — fallback для hand-seeded строк |
| `channel` | `CommunicationChannel` (после SMS-removal сеется только `TG`) |
| `category` | `REMINDER \| MARKETING \| TRANSACTIONAL` |
| `bodyRu` / `bodyUz` | Тексты с плейсхолдерами `{{patient.firstName}}`, `{{appointment.date}}`… |
| `trigger` | Enum `NotificationTrigger` (см. §3) |
| `triggerConfig` | JSON-дискриминатор: `{offsetMin}` для `APPOINTMENT_BEFORE`, `{audience: staff\|patient\|any}` для `APPOINTMENT_CANCELLED`, `{daysBefore}` для `CASE_REPEAT_DUE`, `{channels, enabled}` (см. `rules.ts`) |
| `variables` | Список доступных плейсхолдеров (для UI-подсказок) |
| `isActive` | Выключенный шаблон просто не находится материализатором → триггер молча не срабатывает |
| `buttons` | Json, inline-кнопки ⚠️ по коду отправителя не используется — кнопка подтверждения генерится хардкодом в воркере |

### Рендер

`src/server/notifications/template.ts` — подстановка `{{a.b.c}}` c HTML-escape;
отсутствующий ключ → пустая строка. **Язык**: транзакционные триггеры рендерят
всегда `bodyRu` (`lang = "ru"` захардкожен в `triggers.ts:707`, «per-patient lang → Phase 4»);
кампании выбирают `bodyRu/bodyUz` по `Patient.preferredLang` (`campaigns/launch.ts`).

### Дефолты

`src/server/notifications/default-templates.ts` — канонический сид новой клиники, 8 строк:

| key | trigger | triggerConfig |
|---|---|---|
| `appointment.reminder-5d` | `APPOINTMENT_BEFORE` | `{offsetMin: -7200}` |
| `appointment.reminder-3d` | `APPOINTMENT_BEFORE` | `{offsetMin: -4320}` |
| `appointment.reminder-24h` | `APPOINTMENT_BEFORE` | `{offsetMin: -1440}` |
| `appointment.reminder-3h` | `APPOINTMENT_BEFORE` | `{offsetMin: -180}` |
| `appointment.cancelled.by-staff` | `APPOINTMENT_CANCELLED` | `{audience: "staff"}` |
| `appointment.cancelled.by-patient` | `APPOINTMENT_CANCELLED` | `{audience: "patient"}` |
| `appointment.running-late` | `APPOINTMENT_RUNNING_LATE` | `null` |
| `appointment.no-show` | `APPOINTMENT_MISSED` | `null` |

Плюс `src/server/notifications/auto-messages.ts` — виджет CRM «Авто-сообщения»
(3 автоматизации: `welcome` = `patient.welcome`, `reminder` = `appointment.reminder-24h`,
`thankYou` = `appointment.thank-you`); недостающие строки автосоздаются при первом чтении
(`ensureAutoMessageTemplates`), доставка — тем же пайплайном, отдельного отправителя нет.

### Как клиника правит шаблоны

- UI: `/crm/settings/notifications` (редактор шаблонов+правил, `src/app/[locale]/crm/settings/notifications/`)
  и раздел `/crm/notifications` (вкладки `templates`, `triggers`, `campaigns` — `src/app/[locale]/crm/notifications/`).
- API: `GET /api/crm/settings/notifications/templates` (ADMIN), `PATCH .../templates/[id]`;
  также `/api/crm/notifications/templates(/[id])` и `/api/crm/notifications/triggers`.
- Кастомный `offsetMin` (не из канона −7200/−4320/−1440/−180) подхватывает
  **динамический проход** планировщика (`runDynamicReminders`, см. §4).

---

## 3. Триггеры

### Enum `NotificationTrigger` (`prisma/schema.prisma:156`)

`MANUAL, APPOINTMENT_CREATED, APPOINTMENT_BEFORE, APPOINTMENT_CANCELLED, APPOINTMENT_RUNNING_LATE, APPOINTMENT_MISSED, APPOINTMENT_COMPLETED, PATIENT_BIRTHDAY, PATIENT_INACTIVE_DAYS, CASE_REPEAT_DUE, CRON`

⚠️ `PATIENT_INACTIVE_DAYS` и `CRON` — материализатора в `triggers.ts` нет (только упоминание в `rules.ts` round-trip); фактически не стреляют.

### Логические trigger keys (`TRIGGER_KEYS` в `src/server/notifications/triggers.ts:34`)

| Trigger key | Когда срабатывает | Кто вызывает |
|---|---|---|
| `appointment.created` | сразу при создании записи (подтверждение) | `fireTrigger` из `src/server/appointments/book.ts:654` |
| `appointment.reminder-5d` | **за 5 дней** (offsetMin −7200) | `scheduleAppointmentReminders` + минутный тик |
| `appointment.reminder-3d` | **за 3 дня** (−4320); только для неподтверждённых (`confirmedAt IS NULL` — TELEGRAM/WEBSITE-брони; PHONE/KIOSK/WALKIN автоподтверждаются и пинг не получают) | то же |
| `appointment.reminder-24h` | **за 1 день** (−1440) | то же |
| `appointment.reminder-3h` | **за 3 часа** (−180), финальное «выходите» | то же |
| `appointment.reminder-5h/-2h/-1h` | из канона выведены (TZ-risk-outcomes §7); слоты −300/−120/−60 остались как legacy-slug'и — сработают только если админ сам держит такой шаблон (динамический проход) | `runDynamicReminders` |
| `appointment.thank-you` | визит перешёл в COMPLETED («Спасибо за визит») | PATCH записи / finalize визит-ноты |
| `appointment.cancelled(.by-staff/.by-patient)` | немедленно при отмене; вариант текста по `triggerConfig.audience`. Одновременно все QUEUED-напоминания записи гасятся в `CANCELLED` | `src/server/appointments/cancel.ts:218` |
| `appointment.running-late` | пациент опаздывает (`isRunningLate`), нет отметки прихода | воркер `appointment-lifecycle-sweep.ts` |
| `appointment.no-show` (+legacy `no-show`) | авто-NO_SHOW (sweep) и ручной NO_SHOW (`/api/crm/appointments/bulk-status`) | sweep + CRM route |
| `birthday` | в день рождения (сравнение месяц/день). Гейт marketing-consent. ⚠️ нюансы: в коде нет «09:00 клиники» из комментария — стреляет на первом тике суток (сравнение по **UTC**-дате); дедуп `(patientId, templateId)` без года — повторное срабатывание в следующем году заблокировано старой SENT-строкой. Требует проверки как задумано | `runBirthdays` внутри минутного тика |
| `payment.due` | запись COMPLETED >24h назад, `priceFinal>0`, оплачено меньше. Матч только по slug `payment.due` (enum-значения нет). Гасится при `payment.paid` | `runPaymentsDue` в тике; `fireTrigger({kind:"payment.paid"})` из `/api/crm/payments*` |
| `case.repeat-due` | OPEN `MedicalCase`, у первой услуги `freeRepeatDays>0`, окно бесплатного повтора закрывается через `daysBefore` дней (default 2, настраивается `triggerConfig.daysBefore`), и нет будущей брони | `runCaseRepeatReminders` в тике |
| `patient.reactivation` | «спящие» пациенты ≥90 дней без визита, раз в квартал (`Patient.reactivationSentAt[]`) | `runReactivationScheduler` — `src/server/revenue/reactivation.ts` (~07:00) |
| `appointment.pre-visit-questionnaire` | окно **23–25 часов до** записи (BOOKED/WAITING); дедуп `Appointment.preVisitNotifiedAt`; slug-матч | воркер `pre-visit-questionnaire.ts` (часовой тик) |
| `appointment.nps-request` | **+4 часа после** COMPLETED; дедуп `Appointment.npsRequestedAt`; slug-матч | воркер `post-visit-nps.ts` (часовой тик) |
| `medication.reminder` | часовой тик: ACTIVE `Prescription` c `remindersEnabled`, час совпал с `schedule.times[]`, клиника с `medicationRemindersEnabled`; дедуп `MedicationReminderSend @@unique(prescriptionId, scheduledFor)`; consent marketing | воркер `medication-reminder.ts` |
| `referral.reward-earned` | первый COMPLETED визит приглашённого → пуш рефереру о скидке; consent marketing | `mintReferralRewardOnCompletion` → `fireTrigger` (`src/server/patient-experience/referral-mint.ts`) |

### Каскад напоминаний `APPOINTMENT_BEFORE` — актуальные значения

Канон (TZ-risk-outcomes §7), проверено по коду (`triggers.ts` `whereForTrigger` + `default-templates.ts`):

| offsetMin | По-человечески | Полоса сканирования тика |
|---|---|---|
| **−7200** | за **5 дней** до приёма | 119–120 ч до начала |
| **−4320** | за **3 дня** (только неподтверждённым) | 71–72 ч |
| **−1440** | за **1 день (24 ч)** | 23–24 ч |
| **−180** | за **3 часа** | 2–3 ч |

Ex-канон (−300 = 5 ч, −120 = 2 ч, −60 = 1 ч) — не сеются и планировщиком канона не
обрабатываются; живут только как admin-custom через динамический проход.

**Анти-спам**: каждое `APPOINTMENT_BEFORE`-сообщение несёт inline-кнопку
«✅ Подтверждаю» (`callback_data: confirm:<appointmentId>`, генерится в
`notifications-send.ts:205`). Как только пациент подтвердил (любой канал:
TG_BUTTON/MANUAL_CRM/INBOUND_CALL/BOOKING_AUTO) или запись
CANCELLED/NO_SHOW/COMPLETED — воркер перед отправкой гасит остаток каскада
(`status=CANCELLED`, `failedReason="patient already confirmed (or appointment closed)"`).

---

## 4. Путь уведомления до пациента

```
событие (route/worker)                минутный тик
  fireTrigger(...)  ────────┐   runScheduledTriggers() + runDynamicReminders()
                            ▼            ▼
              материализация: NotificationSend { status: QUEUED, scheduledFor, body уже отрендерен }
                            │   (+ зеркальная INAPP-строка для TG-привязанных пациентов)
                            ▼
        dispatch-цикл каждые 5 сек: QUEUED && scheduledFor <= now
                            │  enqueue("notifications:send", "deliver", { sendId })
                            ▼
        воркер deliver (notifications-send.ts):
          анти-спам гейт → rate-limit (TG 10/мин на пациента; defer +60s)
          → claim QUEUED→SENDING (атомарный updateMany — защита от двойной отправки)
          → adapters.tg.send(chatId, body, [confirm-кнопка])
          → recordNotificationDelivery → status SENT + externalId (+ envelope notification.sent)
        ошибка → до 3 попыток, backoff 60s / 300s / 1800s → FAILED (+ notification.failed, auditable)
```

Ключевые точки (все имена проверены):

1. **Материализация.** Два пути:
   - *На событии*: `fireTrigger({kind:"appointment.created"})` →
     `onAppointmentCreated` (немедленное подтверждение) + `scheduleAppointmentReminders`
     (`triggers.ts:870`) — сразу создаёт будущие строки каскада с
     `scheduledFor = start − offset` (только для полос, ещё не прошедших).
     `appointment.updated` тоже перевызывает `scheduleAppointmentReminders` (дозаполнение
     после переноса; ⚠️ строки со старым временем при переносе не пересчитываются —
     их снимает только анти-спам-гейт, если запись закрылась).
   - *Тик планировщика*: `startNotificationsSchedulerWorker(60_000)` →
     `runScheduledTriggers()` (`triggers.ts:917`) сканирует BOOKED/WAITING записи
     в горизонте 121 ч и кладёт строки полосами (см. таблицу §3) через
     `materializeForAppointmentsBulk` (4 запроса на пачку, не 4×N); плюс
     `runBirthdays`, `runPaymentsDue`, `runCaseRepeatReminders`.
     Затем `runDynamicReminders()` (`notifications-scheduler.ts:58`) — кастомные offsetMin.
2. **Идемпотентность**: не более одной живой строки на
   `(patientId, appointmentId, templateId)` (статусы QUEUED/SENT/DELIVERED/READ считаются «живыми»);
   для birthday — `(patientId, templateId, appointmentId=null)`; для case-repeat — `(caseId, templateId)`.
3. **Очередь** — `src/server/queue/index.ts`: интерфейс `QueueAdapter`;
   при `REDIS_URL` — **BullMQ** (`bullmq-adapter.ts`, durable, `attempts: 1` — ретраи
   остаются на воркере; имена очередей `notifications:send` → физически `notifications-send`),
   без Redis — in-memory `setTimeout` (dev/тесты, не переживает рестарт — но БД-строки QUEUED
   переживают и будут подобраны следующим dispatch-циклом).
4. **Диспетчер ≠ отправитель**: планировщик только находит due-строки; отправляет воркер
   `notifications-send.ts` (`QUEUE_NAME="notifications:send"`, `JOB_NAME="deliver"`).
5. **Claim**: `QUEUED→SENDING` одним условным `updateMany` — конкурирующие воркеры/дубли джобов
   не отправят дважды. Зависшая `SENDING` (краш посреди отправки) чинится руками через `/retry`.
6. **Статусы** (`NotificationStatus`): `QUEUED → SENDING → SENT → DELIVERED → READ`,
   терминальные `FAILED`, `CANCELLED`. `READ`/`DELIVERED` для TG не приходят из Telegram
   (нет DLR) — реально TG-строки останавливаются на `SENT`; `DELIVERED/READ` живут у INAPP
   (read — `PATCH /api/miniapp/inbox/[id]`).
7. **Ретраи**: `MAX_ATTEMPTS=3`, `BACKOFF_MS=[60_000, 300_000, 1_800_000]`, индекс по
   текущему `retryCount`; rate-limit-отсрочка ретраем не считается. После финального фейла —
   ручные `POST /api/crm/notifications/sends/[id]/retry` (FAILED, in-place) и
   `.../resend` (клон строки), `.../cancel`.
8. **Блокировка бота**: тексты ошибок `bot was blocked / user is deactivated / chat not found`
   → `Patient.tgBlockedAt` (fallback к `my_chat_member`-сигналу вебхука).
9. **INAPP-зеркало**: для TG-привязанного пациента почти каждая TG-строка дублируется
   INAPP-строкой (recipient = patientId) — баннер в Mini App как «второе касание».

---

## 5. Привязка пациента к Telegram

Связь = `Patient.telegramId` (chat id), плюс `telegramUsername`, `telegramLinkedAt`, `tgBlockedAt`.

### Путь 1 — инвайт из CRM (модель `TelegramInviteToken`, `prisma/schema.prisma:3387`)

1. Сотрудник (ADMIN/RECEPTIONIST/DOCTOR) на карточке пациента:
   `POST /api/crm/patients/[id]/telegram-invite` → `{ url: t.me/<bot>?start=<token> }`.
   TTL токена **30 дней**, повторный POST в течение 24 ч возвращает тот же токен;
   `409 already_linked`, если `telegramId` уже есть; `412 bot_not_configured` без `tgBotUsername`.
2. Пациент тапает ссылку → бот получает `/start <token>` → вебхук
   `/api/telegram/webhook/[clinicSlug]` парсит payload и зовёт
   `consumeInviteToken` (`src/server/telegram/invite-token.ts`): проверки
   expired / already-consumed / wrong-clinic / patient-already-linked (чужой telegramId
   **не перезаписывается**), затем транзакцией штампует `Patient.telegramId (+username, telegramLinkedAt)`
   и `consumedAt/consumedTelegramId` на токене + аудит `patient.telegram.invite_consumed`.

### Путь 2 — самопривязка через Mini App

`POST /api/miniapp/auth` (`src/app/api/miniapp/auth/route.ts`): ищет пациента по
`telegramId`; если нет, но передан телефон — линкует по `phoneNormalized`;
иначе **создаёт** минимальную карточку (`source: TELEGRAM`, phone-заглушка `tg:<id>`).

### Если пациент не привязан

- `pickRecipient("TG")` возвращает `null` → строка не создаётся, вместо неё
  Action `PATIENT_NO_CHANNEL` в Action Center (оператору предлагается позвонить) — см. §1.
- Mini App для непривязанного отвечает `428 PatientNotRegistered` (кроме `/auth`).
- Заблокировавшие бота (`tgBlockedAt`) исключаются из аудиторий кампаний и счётчиков
  reachability (`/api/crm/telegram/stats`).

---

## 6. Mini App пациента

Роут: `/c/[slug]/my` (`src/app/c/[slug]/my/`), API: `/api/miniapp/*`.

### Разделы (по коду, каталоги `src/app/c/[slug]/my/*` + `_components`)

| Раздел | Файлы/эндпоинты |
|---|---|
| Главная (hero, очередь, inbox-баннер) | `page.tsx` → `_components/miniapp-home.tsx`, `inbox-banner.tsx`, `/api/miniapp/inbox` |
| Записи (список, отмена, check-in, .ics, привязка к кейсу) | `my/appointments/`, `/api/miniapp/appointments*` |
| Онлайн-запись (врачи/услуги/слоты) | `my/book/`, `/api/miniapp/{doctors,services,slots,appointments}` |
| Документы (просмотр + загрузка) | `my/documents/`, `/api/miniapp/documents*`, hook `use-documents.ts` |
| Семья (family-профили) | `my/family/`, `/api/miniapp/family*` |
| Лаборатория | `my/labs/`, `/api/miniapp/labs` |
| Лекарства (напоминания, TAKEN/SKIPPED/SNOOZED) | `my/medications/`, `/api/miniapp/medications*` |
| NPS-оценка | `my/nps/`, `/api/miniapp/nps/[appointmentId]` |
| Пред-визитная анкета | `my/pre-visit/`, `/api/miniapp/pre-visit/[appointmentId]` |
| Итоги визита (заключение) | `my/visit/`, `/api/miniapp/visit-summary/[appointmentId]` |
| Профиль, язык RU/UZ | `my/profile/`, `/api/miniapp/profile` |
| Аккаунт (DSAR: экспорт/удаление) | `my/account/`, `/api/miniapp/account/*` |
| План лечения, рефералка | `/api/miniapp/treatment-plan`, `/api/miniapp/referral` |
| Чат | ⚠️ см. §7 — API есть, UI-экран в текущем коде не найден |

### Авторизация

`src/server/miniapp/handler.ts` (`resolveMiniAppContext`, `createMiniAppHandler`):

1. `X-Telegram-Init-Data` (или `?initData=` — для SSE, EventSource не умеет заголовки).
2. Клиника по `?clinicSlug=`.
3. HMAC-проверка initData против `Clinic.tgBotToken`
   (`src/server/telegram/auth.ts`, секрет `HMAC_SHA256("WebAppData", botToken)`,
   свежесть `auth_date` ≤ 86400 с, constant-time compare).
4. Пациент по `telegramId`; нет → `428`.
5. Хендлер работает в `runWithTenant({kind:"SYSTEM"})` — каждый Prisma-запрос обязан сам
   фильтровать по `clinicId`/`patientId` (роли PATIENT в системе нет).
6. Dev-байпас: `x-miniapp-dev-bypass: 1` + `x-miniapp-dev-user` (только не-production).

### Реалтайм — SSE `/api/miniapp/events`

`src/app/api/miniapp/events/route.ts`:

- Patient-scoped фильтр: событие доставляется если `clinicId` совпал **и** `patientId`
  (в `tenantScope` v2-конверта или в `payload` v1-события) входит в allow-set =
  {пациент + родственники из `PatientFamily`}.
- **Два диалекта на одной шине** (⚠️ известная грабля): v2-конверты EventOutbox
  (`tenantScope`, `eventId`, replayable) и legacy v1 `AppEvent` от `publishEventSafe`
  (без eventId — только live, допущен белый список `MINIAPP_DELIVERABLE_TYPES`,
  включая `tg.message.new`).
- Replay при реконнекте: `Last-Event-ID`/`?since=` → добор из `EventOutbox`
  (лимит 200; чужой/протухший курсор → `: cursor-too-old` — клиент сбрасывает кэш).
- Heartbeat 20 с; клиентский хук `_hooks/use-miniapp-live-events.ts` маппит типы событий
  на инвалидации TanStack-ключей.

---

## 7. Чат врач↔пациент

**Главное: чат внутри приложения работает через SSE + БД, а НЕ через пересылку в Telegram.**
Проверено по коду:

### Модели

`Conversation` (`schema.prisma:2338`) — тред per (clinicId, externalId=tg chat_id);
`mode: bot|takeover`, `unreadCount`, `assignedTo`, привязка к `patientId`.
`Message` (`schema.prisma:2371`) — `direction IN/OUT`, `attachments Json`, `status`,
дедуп `@@unique([clinicId, externalId])` (externalId = tg message_id).

### Входящие от пациента

- **Из Telegram-чата с ботом**: вебхук `/api/telegram/webhook/[clinicSlug]` upsert'ит
  Conversation, пишет `Message(direction=IN)`, скачивает и перехостит медиа
  (`src/server/telegram/inbound-media.ts` → MinIO), публикует `tg.message.new`
  (v1, с `patientId` — долетает и в CRM-инбокс, и в Mini App пациента).
  Автоответчик FSM (`src/server/telegram/state.ts`) — только приветствие + web_app-кнопка
  Mini App; включается `TG_BOT_AUTOREPLY=1`, в `takeover`-режиме молчит.
- **Из Mini App**: `POST /api/miniapp/conversations/[id]/messages` — пишет
  `Message(direction=IN)` сразу `DELIVERED`, **никакого TG-плеча нет** («пациент уже в
  приложении»), публикует `tg.message.new` — CRM-инбокс загорается по SSE.

### Исходящие от оператора — `POST /api/crm/conversations/[id]/messages`

| Случай | Поведение |
|---|---|
| `channel=TG`, `externalId=null` (пациент только в Mini App, боту не писал) | **In-band**: TG-отправки нет вообще; строка сразу `DELIVERED`; пациент получает через patient-scoped SSE (`tg.message.new` → инвалидация `["miniapp","messages"]`) |
| `channel=TG`, `externalId` есть | Реальная отправка в TG: `sendMessage` / `sendPhoto` / `sendDocumentUrl` (`src/server/telegram/send.ts`), inline-кнопки пробрасываются; статус `SENT`+externalId, при ошибке `FAILED` |
| `channel=SMS` (legacy) | сразу `FAILED` |

### Файлы

- **CRM → пациент**: файл сначала загружается через
  `/api/crm/conversations/[id]/attachments`, затем сообщение несёт `attachments[]`;
  в TG уходит **по URL** (Telegram сам скачивает) — URL должен быть публичным:
  берётся `TG_WEBHOOK_BASE_URL`, иначе origin запроса (в dev localhost → «wrong file»).
  Caption едет на первом вложении, клавиатура — на последнем.
- **Mini App multipart** (загрузка документов, `_hooks/use-documents.ts`):
  `FormData` POST обязан идти **без** ручного `Content-Type` —
  `miniAppFetchHeaders` (`_components/miniapp-auth-provider.tsx:191`) по умолчанию ставит
  `content-type: application/json`, и если его не убрать, затирается
  `multipart/form-data; boundary=…`, который fetch выставляет сам → на сервере ломается
  `request.formData()`. В `use-documents.ts` заголовок целенаправленно вычищается.
- Приватный MinIO: файлы отдаются стриминг-прокси (`/api/crm/conversations/[id]/attachments/file`,
  `/api/miniapp/documents/[id]/file`), не через presigned URL.

⚠️ **UI-экран чата в Mini App**: серверный контракт готов
(`/api/miniapp/conversations`, `find-or-create`, `[id]/messages` GET/POST) и SSE-инвалидации
заведены (`["miniapp","messages"]`, `["miniapp","conversations"]` в
`use-miniapp-live-events.ts`), но компонент/хук экрана чата в `src/app/c/[slug]/my/`
на момент снимка **не найден** (нет `use-conversations`-хука, нет chat-screen). Требует
проверки: либо экран ещё не дописан, либо живёт в невыкаченной ветке.

---

## 8. Кампании / рассылки

### Модель `Campaign` (`schema.prisma:2457`)

`name, templateId?` **или** inline `body`, `segment Json`, `channel`,
`status: String` (DRAFT → SENDING → DONE / CANCELLED), `scheduledFor`,
счётчики `totalCount/sentCount/failedCount`, связка `sends: NotificationSend[]` (по `campaignId`).

### Что реализовано

- Роуты: `/api/crm/campaigns` (CRUD), `preview`, `broadcast`+`broadcasts` (ad-hoc рассылка),
  `dormant/[bucket]/preview`, `[id]/launch`, `[id]/cancel`. UI — `/crm/notifications/campaigns`.
- **Запуск** — `src/server/campaigns/launch.ts`: кампании **TG-only** (иной канал → 400);
  материализация `NotificationSend(campaignId, status=QUEUED)` в одной транзакции со
  status-flip DRAFT→SENDING (защита от двойного клика); немедленный enqueue, либо — для
  отложенной (`scheduledFor` в будущем) — доставку делает планировщик по `scheduledFor`.
  `cancel` гасит будущие QUEUED-строки и помечает кампанию CANCELLED (только до дispatch).
- **Сегменты** — `src/server/campaigns/audience.ts` (`resolveAudience`, диспетчер по `segment.kind`):
  - `dormant` — реактивация: `lastVisitAt` в окне бакета (≥90 дней и т.п.), без будущей брони
    (`dormant-audience.ts`);
  - `all` / `segment` / `tag` — весь список клиники с фильтрами.
  - Общие гейты: не удалён (`deletedAt IS NULL`), marketing-consent (`marketingOptOut`),
    есть `telegramId`, не заблокировал бота (`tgBlockedAt`). Потолок аудитории 10 000.
    Возвращается breakdown `tgReady/noChannel/optedOut/blocked` — превью в визарде совпадает
    с фактическим числом отправок.
- **Финализация**: `recordNotificationDelivery` (`record-delivery.ts:200`) на каждом
  терминальном статусе пересчитывает `sentCount/failedCount` и, когда не осталось
  QUEUED/SENDING, ставит `DONE` + `finishedAt`.

---

## 9. Эксплуатация

### Где живут процессы

Воркеры — **отдельный процесс** (`npx tsx src/server/workers/start.ts`, в prod — отдельный
контейнер; в Next-процессе воркеры не стартуют). `start.ts` регистрирует всё:
notifications-send, notifications-scheduler (тик 60 с + dispatch 5 с), outbox-pumper (200 мс),
lifecycle-sweep (10 мин), pre-visit / post-visit-nps / medication-reminder (час),
visit-note-handout / referral-document (30 с), scheduled-reports (5 мин), revenue, DSAR и др.

### Как проверить, что уведомления идут

| Что | Как |
|---|---|
| Общее здоровье | `GET /api/health` — checks `db / redis / minio / workers` (workers: `ok/idle` по зарегистрированным очередям) |
| История отправок | CRM `/crm/notifications` или `GET /api/crm/notifications/sends?status=&channel=&patientId=&from=&to=` (+ `/stats`) |
| Застрявшая очередь | строки `QUEUED` с `scheduledFor` в прошлом = **не работает воркер/scheduler-тик**; `SENDING` дольше минут = краш посреди отправки → `POST .../sends/[id]/retry` |
| Reachability Telegram | `GET /api/crm/telegram/stats` — `totalInTelegram / reachable / blocked / optedOut / newLast7d` |
| Логи воркера | `[scheduler] tick ok triggered=… dynamic=… dispatched=N`, `[queue] … failed`, `[tg:webhook clinic=…]` |

### Типичные причины «не дошло» (по коду)

1. **Пациент не привязан к TG** → строки нет вовсе; ищите Action `PATIENT_NO_CHANNEL`
   в `/crm/action-center` (создан materializer'ом).
2. **Шаблон выключен/удалён** (`isActive=false`) → `findTemplateFor` возвращает null,
   триггер молча скипается (счётчик `skipped` в логе тика). Включается в
   `/crm/settings/notifications`.
3. **Воркер-процесс не запущен** → QUEUED копится. In-memory очередь (без `REDIS_URL`)
   не шарится между процессами — API-enqueue из Next-процесса до воркера не долетает,
   доставку тогда делает только dispatch-цикл самого воркера.
4. **Пациент подтвердил запись** → каскад дальше гасится специально:
   `CANCELLED / "patient already confirmed (or appointment closed)"` — это не баг.
5. **Пациент заблокировал бота** → `FAILED` с `bot was blocked…`, `Patient.tgBlockedAt`
   проставлен; из кампаний исключается.
6. **У клиники нет `tgBotToken`** → адаптер `LogOnlyTgAdapter`
   (`adapters/tg-log-only.ts`): «отправка» только в лог, строка выглядит SENT —
   коварно в стейджинге.
7. **Сеть до api.telegram.org** — в коде заложены: ретраи 12×8 с с backoff
   (`bot-api.ts`, `send.ts`; комментарии про частичную доступность TG-пула с RU VPS),
   `TELEGRAM_API_BASE` (проксирование Bot API), режим long-poll `TG_USE_POLLING=true`
   (`src/server/telegram/poll.ts` — getUpdates и форвард апдейтов на внутренний вебхук
   `INTERNAL_APP_URL=/api/telegram/webhook/<slug>`) вместо вебхука, когда TG не может
   достучаться до сервера. После миграции на Hetzner основной путь — webhook
   (секрет `X-Telegram-Bot-Api-Secret-Token` = `Clinic.tgWebhookSecret`; настройка —
   визард `/api/crm/integrations/tg/connect` + `set-webhook`).
8. **Rate limit** — 10 TG-сообщений/мин на пациента (`rate-limit.ts`, in-memory) → отсрочка
   на 60 с, не фейл.
9. **Consent** — `marketingOptOut=true` или soft-delete гасят маркетинговые пуши
   (birthday, реактивация, medication, referral, кампании) — `consent-gate.ts`.

---

## 10. Карта файлов

| Область | Путь |
|---|---|
| Триггеры + материализация + каскад | `src/server/notifications/triggers.ts` |
| Дефолтные шаблоны | `src/server/notifications/default-templates.ts` |
| Авто-сообщения (welcome/reminder/thank-you) | `src/server/notifications/auto-messages.ts` |
| Рендер плейсхолдеров | `src/server/notifications/template.ts` |
| Правила/оффсеты для редактора | `src/server/notifications/rules.ts` |
| Rate limit | `src/server/notifications/rate-limit.ts` |
| Consent gate | `src/server/notifications/consent-gate.ts` |
| PATIENT_NO_CHANNEL компенсатор | `src/server/notifications/no-channel-action.ts` |
| Кернел терминальных статусов | `src/server/notifications/record-delivery.ts` |
| Адаптеры (TG real/log-only, INAPP) | `src/server/notifications/adapters/*` |
| Планировщик (тик 60 с + dispatch 5 с) | `src/server/workers/notifications-scheduler.ts` |
| Воркер-отправитель | `src/server/workers/notifications-send.ts` |
| Пред-визит / NPS / лекарства / заключения / отчёты | `src/server/workers/{pre-visit-questionnaire,post-visit-nps,medication-reminder,visit-note-handout,scheduled-reports}.ts` |
| Запуск всех воркеров | `src/server/workers/start.ts` |
| Очередь (BullMQ/in-memory) | `src/server/queue/{index,bullmq-adapter}.ts` |
| Bot API I/O, конструктор бота | `src/server/telegram/{send,bot-api}.ts`, `/api/crm/integrations/tg/*` |
| Вебхук бота | `src/app/api/telegram/webhook/[clinicSlug]/route.ts` |
| Long-poll fallback | `src/server/telegram/poll.ts` |
| Инвайт-токены | `src/server/telegram/invite-token.ts`, `/api/crm/patients/[id]/telegram-invite` |
| initData/LoginWidget верификация | `src/server/telegram/auth.ts` |
| Mini App auth-обвязка | `src/server/miniapp/handler.ts` |
| Mini App SSE | `src/app/api/miniapp/events/route.ts` |
| Mini App UI | `src/app/c/[slug]/my/` |
| Чат CRM-сторона | `/api/crm/conversations/*`, UI `/crm/telegram` |
| Чат пациент-сторона | `/api/miniapp/conversations/*` |
| Кампании | `src/server/campaigns/{launch,audience,dormant-audience}.ts`, `/api/crm/campaigns/*` |
| Модели | `prisma/schema.prisma` — `NotificationTemplate:2396`, `NotificationSend:2424`, `Campaign:2457`, `Conversation:2338`, `Message:2371`, `MedicationReminderSend:3075`, `TelegramInviteToken:3387` |
