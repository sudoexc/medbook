# Реалтайм-слой MedBook — как устроено «как есть»

> Документ описывает реализацию по состоянию кода на 2026-08-20.
> Первоисточники: `src/server/realtime/*`, `src/server/workers/outbox-pumper.ts`,
> SSE-роуты в `src/app/api/`, клиентские хуки в `src/hooks/`.
> Старая операторская памятка: `docs/realtime.md` (описывает только v1-контур).

## Оглавление

1. [Общая схема](#1-общая-схема)
2. [⚠️ Два поколения конверта: v1 `AppEvent` и v2 `EventEnvelope`](#2-два-поколения-конверта-v1-appevent-и-v2-eventenvelope)
3. [Outbox: транзакционная доставка](#3-outbox-транзакционная-доставка)
4. [Каталог событий](#4-каталог-событий)
5. [Клиент: подписка и инвалидация react-query](#5-клиент-подписка-и-инвалидация-react-query)
6. [Прод: nginx, SSE и чек-лист «не обновляется вживую»](#6-прод-nginx-sse-и-чек-лист-не-обновляется-вживую)

---

## 1. Общая схема

Транспорт — Server-Sent Events (SSE), не WebSocket. Один канал на клинику:
`clinic:<clinicId>:events` (`src/server/realtime/channels.ts`).

```
                        путь v1 (fire-and-forget)
  mutation handler ──► publishEventSafe(clinicId, {type, payload})
                        │  Zod: AppEventSchema (events.ts)
                        │
                        ▼
                   in-process EventBus ──────────► Redis PUBLISH events:<clinicId>
                   (event-bus.ts, singleton         (redis-adapter.ts, если REDIS_URL)
                    на процесс)                        │
                        ▲                              │ psubscribe events:*
                        │                              ▼
                        │              ensureRedisSubscriber() в КАЖДОМ процессе
                        │              форвардит обратно в локальный EventBus
                        │
                        │               путь v2 (транзакционный)
  prisma.$transaction ──┼─► publishViaOutbox(tx, envelope)  ── INSERT EventOutbox
                        │        (outbox.ts, та же транзакция, что и мутация)
                        │
                        │   worker-процесс (Dockerfile.worker, workers/start.ts:52)
                        │   OutboxPumper каждые 200 мс:
                        └── broadcastEnvelope(envelope)  (publish.ts:115)
                              = локальный bus воркера + Redis

  SSE-роуты (подписчики локального EventBus своего процесса):
    /api/events                    — CRM + кабинет врача (session-auth)
    /api/miniapp/events            — Mini App пациента (initData-auth, patient-scoped фильтр)
    /api/c/[slug]/queue/events     — публичное табло/киоск (без auth, PHI-safe проекция)

  Браузер:
    useLiveEvents / useLiveQueryInvalidation  (CRM, кабинет врача)
    useMiniAppLiveEvents                      (Mini App)
    useQueueBoard / useDoctorBoard / q-page   (ТВ, киоск, статус талона)
        │
        ▼
    queryClient.invalidateQueries(...) → TanStack Query refetch
```

Ключевые следствия топологии:

- **Локальный bus живёт в рамках одного Node-процесса.** Web-контейнер (`app`)
  и worker-контейнер (`worker`) — разные процессы. Событие, опубликованное в
  воркере (в т.ч. ВСЕ v2-события: их раздаёт pumper, живущий в воркере),
  доходит до SSE-клиентов web-процесса **только через Redis**. Без `REDIS_URL`
  v2-события до браузеров не доедут вообще. В `docker-compose.yml` `REDIS_URL`
  задан и для `app` (строка 80), и для `worker` (строка 106).
- v1-событие, опубликованное в web-процессе, доходит до SSE-подписчиков этого же
  процесса синхронно (нулевая задержка), плюс зеркалируется в Redis для
  остальных процессов.
- Валидация на публикации: v1 — `AppEventSchema` в `publishEvent`
  (`publish.ts:64`), v2 — `EventEnvelopeSchema` в `publishViaOutbox`
  (`outbox.ts:76`). Невалидный payload падает на call-site, а не травит стрим.

---

## 2. Два поколения конверта: v1 `AppEvent` и v2 `EventEnvelope`

**Это главный подводный камень всего реалтайм-слоя.** На одной шине
(`clinic:<id>:events`) одновременно ходят два формата, и они взаимно
непарсибельны друг для друга.

### v1 — `AppEvent` (`src/server/realtime/events.ts`)

```jsonc
{
  "type": "queue.updated",
  "clinicId": "clinic-abc",        // ← clinicId НА ВЕРХНЕМ УРОВНЕ
  "at": "2026-08-20T09:00:00.000Z",
  "payload": { "appointmentId": "…", "doctorId": "…", "queueStatus": "WAITING" }
}
```

- Схема: `AppEventSchema` — Zod discriminated union по `type`, каждый член
  требует top-level `clinicId`.
- Публикуется через `publishEvent(clinicId, input)` /
  `publishEventSafe(clinicId, input)` (`src/server/realtime/publish.ts`).
  `publishEventSafe` — fire-and-forget, ошибки глотает с `console.warn`.
- Нет `eventId` → **не реплеится** после реконнекта (live-only).
- Нет транзакционной гарантии: если процесс упал между COMMIT и publish —
  событие потеряно навсегда.

### v2 — `EventEnvelope` (`src/server/realtime/envelope.ts`)

```jsonc
{
  "eventId": "5f0c…",              // стабильный id = ключ идемпотентности AuditLog
  "correlationId": "…",            // общий на каскад (confirm → notify → …)
  "causedByEventId": "…",          // опционально, back-pointer
  "at": "2026-08-20T09:00:00.000Z",
  "type": "appointment.statusChanged",
  "payload": { "appointmentId": "…", "status": "CONFIRMED", "previousStatus": "BOOKED" },
  "actor":   { "role": "RECEPTIONIST", "userId": "…", "patientId": null,
               "onBehalfOfPatientId": null, "label": "…" },
  "surface": "CRM",
  "tenantScope": {                 // ← clinicId ВНУТРИ tenantScope
    "clinicId": "clinic-abc",
    "doctorId": "…", "patientId": "…", "appointmentId": "…"
  }
}
```

- Схема: `EventEnvelopeSchema`. Типы событий — те же литералы `EVENT_TYPES`
  из `events.ts` (единый реестр имён на оба поколения).
- Публикуется через `publishViaOutbox(tx, envelope)` (`src/server/realtime/outbox.ts`)
  внутри Prisma-транзакции; на шину его выносит `OutboxPumper` через
  `broadcastEnvelope(envelope)` (`publish.ts:115`) — уже без ревалидации.
- Есть `eventId` → SSE-роут пишет строку `id: <eventId>` и событие
  **реплеится** через `Last-Event-ID` / `?since=`.

### В чём ловушка

`clinicId` переехал с верхнего уровня внутрь `tenantScope`. Поэтому:

- `AppEventSchema.safeParse(v2Envelope)` → **fail** (нет top-level `clinicId`);
- `EventEnvelopeSchema.safeParse(v1Event)` → **fail** (нет `tenantScope`/`actor`).

Парсер, который знает только одну схему, **молча теряет** события второго
поколения: `safeParse` вернул `success: false`, обработчик сделал `return`,
ни ошибки, ни лога. UI просто «не обновляется», и это невозможно увидеть
иначе как по симптому.

**Как это реально стреляло (Mini App).** Walk-in, чат и переходы очереди
публикуются как v1; записи/отмены/подтверждения — как v2 через outbox.
Патент-фильтр Mini App изначально понимал только v2 (`tenantScope.patientId`),
поэтому пациент не видел живьём события, изданные v1-паблишерами. Фикс —
коммит `254545e` «fix(realtime): deliver patient events to mini-app SSE
(v1+v2 dialects)»: серверный фильтр обзавёлся отдельной веткой
`shouldDeliverV1ToMiniApp` (`src/app/api/miniapp/events/route.ts:150`), а клиент —
функцией `extractEventType`, которая пробует ОБЕ схемы по очереди
(`src/app/c/[slug]/my/_hooks/use-miniapp-live-events.ts:224`):

```ts
function extractEventType(parsed: unknown): EventType | null {
  const v1 = AppEventSchema.safeParse(parsed);
  if (v1.success) return v1.data.type;
  const v2 = EventEnvelopeSchema.safeParse(parsed);
  if (v2.success) return v2.data.type;
  return null;
}
```

### ✅ CRM-хук: ловушка разряжена (2026-08-20)

Исторический контекст: `src/hooks/use-live-events.ts` (общий хук CRM и
кабинета врача) парсил **только v1** (`AppEventSchema.safeParse` → silent
drop), поэтому события, публикуемые **только через outbox** (например
`appointment.statusChanged` из `emitAppointmentChangeViaOutbox`,
`visit-note.finalized`, `doctor.scheduleChanged`, `patient.arrived`,
mini-app-мутации `nps.submitted`/`previsit.submitted`/`patient.family*`),
до CRM-подписчиков живьём **не доходили**. Симптом маскировался тремя
вещами: 60-секундным поллингом-страховкой (`RECEPTION_POLL_MS` в
`use-reception-live.ts:126` и аналогичные `refetchInterval` в других хуках),
локальной инвалидацией в `onSuccess` мутаций у самого действующего юзера и
v1-дублёрами на горячих путях (queue-status роут шлёт v1
`queue.updated`+`appointment.statusChanged`).

Фикс — `parseLiveEvent` в `use-live-events.ts`: пробует `AppEventSchema`
(v1), затем `EventEnvelopeSchema` (v2); v2-конверт сплющивается обратно в
v1-форму (`clinicId` поднимается из `tenantScope`) и ревалидируется через
`AppEventSchema`, так что подписчики по-прежнему получают типизированный
`AppEvent` независимо от диалекта. Регресс-тест:
`tests/unit/live-events-dialects.test.ts`.

Публичное табло не подвержено: `board-stream.ts` читает `type`/`payload`
дефензивно из `unknown` и работает для обоих поколений (см. комментарий в
шапке файла).

### Правило для нового кода

Любой потребитель шины (SSE-роут, клиентский хук, воркер-подписчик) обязан
обрабатывать **оба** диалекта: сначала `isEventEnvelope`/`EventEnvelopeSchema`
(v2), затем `AppEventSchema` (v1) — или наоборот, но обязательно оба.

---

## 3. Outbox: транзакционная доставка

### Зачем

`publishEventSafe` — best-effort: событие живёт только в памяти процесса.
Outbox (`docs/TZ-cross-surface-sync.md` §5) добавляет три гарантии:

1. **At-least-once.** `publishViaOutbox(tx, …)` вставляет строку в `EventOutbox`
   **в той же транзакции**, что и доменная мутация. Транзакция откатилась —
   события нет (нет «призрачных» событий о несостоявшихся записях). Транзакция
   закоммичена — pumper доставит, с ретраями.
2. **Replay.** `/api/events` и `/api/miniapp/events` по `Last-Event-ID`
   (или `?since=<eventId>`) дочитывают пропущенные `DELIVERED`-строки из
   `EventOutbox` (лимит `REPLAY_LIMIT = 200`). Если курсор не найден или чужой
   клиники — клиенту шлётся сентинел `: cursor-too-old`, mini-app на него
   сбрасывает весь кэш `["miniapp"]`.
3. **Единый аудит.** Для типов с `auditable: true` (реестр
   `EVENT_META_OVERRIDES` в `envelope.ts:141`) pumper материализует строку
   `AuditLog` из конверта. Идемпотентно: `AuditLog.eventId` UNIQUE +
   `createMany({ skipDuplicates: true })` — повторная доставка не дублирует аудит.

### Модель данных

`prisma/schema.prisma:2669`:

```
model EventOutbox {
  id              String       @id            // = eventId конверта
  correlationId   String
  causedByEventId String?
  clinicId        String
  type            String
  envelope        Json                         // полный v2-конверт
  createdAt       DateTime     @default(now())
  status          OutboxStatus @default(PENDING)  // PENDING|DELIVERED|FAILED|DEAD
  deliveredAt     DateTime?
  attempts        Int          @default(0)
  lastError       String?
}
```

### Pumper (`src/server/workers/outbox-pumper.ts`)

Запускается **только в worker-процессе**: `startOutboxPumperWorker(200)` в
`src/server/workers/start.ts:52`. Цикл каждые 200 мс:

1. В транзакции: `SELECT … FROM "EventOutbox" WHERE status IN ('PENDING','FAILED')
   AND createdAt + 2^attempts * 1s <= NOW() ORDER BY createdAt LIMIT 100
   FOR UPDATE SKIP LOCKED` — несколько реплик pumper'а не дерутся за строки.
2. На строку: `EventEnvelopeSchema.parse` → `broadcastEnvelope` (локальный bus
   воркера + Redis) → при `auditable` — `AuditLog` → `status='DELIVERED'`.
3. Ошибка: `attempts++`, экспоненциальное окно ретрая (`2^attempts` секунд);
   после `MAX_ATTEMPTS = 5` → `status='DEAD'` + `lastError` — ручной разбор.
4. Полный батч (100 строк за тик) — warning «saturated tick» в логах.

### Что будет, если pumper не запущен

- Строки копятся в `PENDING`; **ни одно v2-событие не выходит на шину** —
  живых обновлений от outbox-паблишеров нет ни в CRM, ни в Mini App, ни на табло.
- `AuditLog` для auditable-типов не пишется.
- Replay при реконнекте отдаёт только старые `DELIVERED`-строки; свежие события
  клиент получит лишь после того, как pumper догонит бэклог (сразу все, скопом).
- UI деградирует до поллинговых интервалов (20–60 с в зависимости от экрана).

Диагностика: `SELECT status, count(*) FROM "EventOutbox" GROUP BY status` —
растущий `PENDING` = pumper мёртв; наличие `DEAD` — смотреть `lastError`.

---

## 4. Каталог событий

Полный реестр типов — `EVENT_TYPES` в `src/server/realtime/events.ts` (47 типов).
Колонка «Поколение»: v1 = `publishEventSafe`, v2 = `publishViaOutbox` (outbox).

| Тип события | Пок. | Кто публикует | Кто слушает |
|---|---|---|---|
| `appointment.created` | v2 | `server/appointments/book.ts` (бронирование) | CRM: reception, calendar, appointments-list, доктор my-day/schedule; табло (`board-stream`); Mini App (`appointments`,`slots`) |
| `appointment.created` | v1 | `server/appointments/walkin.ts` (walk-in) | те же |
| `appointment.updated` | v2/v1 | v2: `/api/miniapp/appointments/[id]` (перенос пациентом); v1: `/api/crm/appointments/[id]/queue-status` (усечение слота) | CRM reception/calendar, доктор my-day, Mini App |
| `appointment.statusChanged` | v2 | `server/appointments/confirm.ts`; `emitAppointmentChangeViaOutbox` (`server/appointments/emit-change.ts` — PATCH `/api/crm/appointments/[id]`, bulk-status) | CRM reception/calendar, доктор today/schedule/sidebar, табло, Mini App |
| `appointment.statusChanged` | v1 | `/api/crm/appointments/[id]/queue-status`; воркер `appointment-lifecycle-sweep` (авто-NO_SHOW) | те же |
| `appointment.cancelled` | v2 | `server/appointments/cancel.ts`; `emit-change.ts` | те же + табло |
| `appointment.moved` | v2 | `emit-change.ts` (перенос из CRM) | CRM calendar/reception, Mini App `slots` |
| `queue.updated` | v2 | `book.ts`, `confirm.ts`, `emit-change.ts` (когда сдвинулась очередь) | CRM reception (queue-панели), доктор my-day, табло/киоск (рефетч board), `/q/[id]`, Mini App (`queue`,`appointments`) |
| `queue.updated` | v1 | `/api/crm/appointments/[id]/queue-status`, `/api/crm/appointments/reorder`, `walkin.ts`, `/api/c/[slug]/queue/checkin` | те же |
| `queue.called` | v1 (только!) | `/api/crm/appointments/[id]?call=true` (врач «Вызвать»); `/api/crm/appointments/[id]/queue-status` (ресепшн → IN_PROGRESS) | табло `/tv`, `/tv/d/[token]` (баннер+гонг), киоск, `/q/[id]`. **Сознательно без outbox** — реплей перезвонил бы гонгом старый вызов |
| `call.incoming/answered/ended/missed` | v1 | `/api/calls/sip/event` (SIP-вебхук) | CRM reception (`["reception","calls"]`), call-center |
| `tg.message.new` | v1 | TG-вебхук `/api/telegram/webhook/[clinicSlug]`, `/api/crm/conversations/[id]/messages`, `/api/miniapp/conversations/[id]/messages` | CRM telegram-инбокс, reception, доктор messages, Mini App чат |
| `tg.takeover.incoming` | v1 | TG-вебхук | CRM telegram (алерт «перехвати диалог») |
| `tg.conversation.updated` | v1/v2 | v1: вебхук, `/api/crm/conversations/[id]`; v2: `server/conversations/find-or-create.ts` | CRM inbox, доктор sidebar, Mini App conversations |
| `conversation.created` | v2 | `server/conversations/find-or-create.ts` (cold-start штатным сотрудником; auditable) | CRM inbox |
| `payment.paid` / `payment.due` | v1 | `/api/crm/payments`, `/api/crm/payments/[id]` (`payment.due` — тип объявлен в `EVENT_TYPES`, но SSE-паблишер в коде не найден ⚠️; строки `"payment.due"` в `server/notifications/*` — это ключ шаблона уведомлений, не событие шины) | CRM billing-виджеты; Mini App `documents` |
| `notification.sent` / `notification.failed` | v2 | `server/notifications/record-delivery.ts` (`failed` — auditable:warning) | CRM notifications `use-queue`; Mini App inbox |
| `notification.read` | v2 | `/api/miniapp/inbox/[id]` | CRM notifications (гасит счётчик), Mini App inbox |
| `action.created` / `action.updated` | v1 | `server/actions/engine.ts:213,220` (recompute-движок, `safePublish` → `publishEvent`); `server/notifications/no-channel-action.ts:78,87` | CRM action-center, call-center `use-unconfirmed`, `use-risk-today` |
| `patient.summary.refreshed` | v1 | воркер `patient-summary-refresh` | CRM patient-summary-card, доктор patient-summary |
| `case.soap-draft.refreshed` | v1 | воркер `voice-soap` | CRM soap-draft-card |
| `reminder.created` / `reminder.updated` | v1 | `/api/crm/doctors/me/reminders*` | кабинет врача notifications |
| `doctor.scheduleChanged` | v2 | `server/doctors/update-schedule.ts` (auditable) | Mini App `slots`, CRM calendar, кабинет `/schedule` |
| `lab.result.received` | v1 | `/api/crm/doctors/me/labs` | кабинет врача labs |
| `lab.result.reviewed` | v2 | `/api/crm/doctors/me/labs/[id]` | Mini App `labs` (результат становится видим пациенту), кабинет labs |
| `lab.order.created` | v1 | `/api/crm/lab-orders` | фронт-деск/нурс-вью |
| `prescription.created` | v2 | `server/prescriptions/prescribe.ts`; воркер `visit-note-handout` (мост Ф6) | Mini App `medications` |
| `prescription.updated` | v2 | `/api/crm/cases/[id]/prescriptions/[prescriptionId]` | Mini App `medications` |
| `eprescription.issued/cancelled` | v2 | `/api/crm/e-prescriptions*` | Mini App `medications`, CRM patient card |
| `sickleave.issued/cancelled` | v2 | `/api/crm/sick-leaves*` | CRM patient card |
| `referral.created` | v2 | `/api/crm/referrals` | кабинет врача `use-doctor-referrals` (входящие), Mini App `documents` |
| `document.created` | v2 | `/api/crm/documents`, `/api/miniapp/documents`, воркеры `visit-note-handout`, `referral-document` | Mini App `documents` |
| `cds.override.recorded` | v1 | `/api/crm/cds-overrides` (auditable:warning — аудит через outbox не идёт, т.к. паблишер v1 ⚠️ аудит тут пишется явным `audit()` в роуте) | дашборд качества (будущее) |
| `visit-note.draftSaved` | v2 | `/api/crm/visit-notes/[id]` (автосейв ~1.5 с, НЕ auditable) | CRM/кабинет — панель заметки |
| `visit-note.finalized` | v2 | `/api/crm/visit-notes/[id]/finalize` (auditable) | CRM reception (строка → completed), Mini App `appointments` |
| `patient.familyLinked/Unlinked` | v2 | `/api/miniapp/family*` | CRM patient card (панель семьи), Mini App `family` |
| `patient.profileUpdated` | v2 | `/api/miniapp/profile` | CRM patient card, Mini App `profile` |
| `nps.submitted` | v2 | `/api/miniapp/nps/[appointmentId]` | CRM NPS-дашборд, Mini App |
| `previsit.submitted` | v2 | `/api/miniapp/pre-visit/[appointmentId]` | кабинет врача (тайл «пациент заполнил»), Mini App |
| `patient.arrived` | v2 | `/api/miniapp/appointments/[id]/checkin` («Я на месте») | CRM reception — toast + invalidate (`use-reception-live.ts:417`) |

Примечания:

- `getEventMeta` (`envelope.ts:181`) решает, какие типы pumper пишет в AuditLog.
  Высокочастотные (`queue.updated`, `notification.sent`, `visit-note.draftSaved`)
  сознательно не аудируются.
- Mini App дополнительно гейтит v1-события белым списком
  `MINIAPP_DELIVERABLE_TYPES` (`/api/miniapp/events/route.ts:109`) — чтобы
  staff-события с чужим `patientId` в payload (например `call.incoming`) не
  утекали пациенту.
- Публичное табло пропускает только `BOARD_EVENT_TYPES`
  (`board-stream.ts:27`: `queue.updated`, `queue.called`, `appointment.created/
  statusChanged/cancelled/moved`) и обрезает payload до `SAFE_PAYLOAD_KEYS` —
  ФИО на экран ожидания попасть не может (исключение — `patientName`, уже
  сведённый к инициалам паблишером `queue.called`).

---

## 5. Клиент: подписка и инвалидация react-query

### CRM / кабинет врача — `useLiveEvents` (`src/hooks/use-live-events.ts`)

- **Один shared `EventSource` на вкладку** (`/api/events`, ref-count).
  Первый маунт открывает соединение, последний анмаунт — закрывает, но с
  **грейс-окном 5 с** (`IDLE_CLOSE_GRACE_MS`): SPA-переход между страницами
  CRM размонтирует старые хуки на тик раньше, чем смонтируются новые, и без
  грейса сокет рвался в этот зазор, теряя события (коммит `04ab6e0`).
- Экспоненциальный реконнект 1s → 30s cap. На `onerror` соединение закрывается
  и переоткрывается вручную (браузерный авто-реконнект не доверяется прокси).
- `filter` — список типов; ключ фильтра — отсортированная строка `filterKey`,
  а не сам массив: инлайн-литерал массива менял identity на каждом рендере,
  effect пересоздавался, `refCount` падал до 0 и сокет флапал — «reception не
  обновлялся до F5» (тот же коммит `04ab6e0`, комментарий на строках 217–224).
- ⚠️ Парсит только `AppEventSchema` — см. §2 про потерю v2.

### `useLiveQueryInvalidation` (`src/hooks/use-live-query.ts`)

Мост SSE → TanStack Query:

```ts
useLiveQueryInvalidation({
  events: ["appointment.created", "appointment.moved"],
  queryKeys: [["reception", "dashboard"], ["reception", "appointments", "today"]],
  shouldInvalidate: (e) => e.payload.doctorId === myDoctorId,  // опционально
});
```

- **Дебаунс 400 мс + дедуп по JSON-ключу** (`SSE_INVALIDATION_DEBOUNCE_MS`):
  всплеск из N событий на один и тот же ключ = ОДНА инвалидация и один рефетч.
- `refetchType: "active"` — рефетчатся только смонтированные экраны; фоновые
  запросы лишь помечаются stale и перезапросятся при следующем маунте.

### Mini App — `useMiniAppLiveEvents` (`src/app/c/[slug]/my/_hooks/use-miniapp-live-events.ts`)

- `EventSource` на `/api/miniapp/events?clinicSlug=…&initData=…` (initData в
  query, потому что EventSource не умеет кастомные заголовки).
- Понимает оба диалекта (`extractEventType`), маппит `type` →
  префиксы ключей через `MINIAPP_INVALIDATION_MAP`.
- `Last-Event-ID` дублируется в `sessionStorage` и подставляется как
  `?since=` при первом коннекте (кейс «TG-webview был в фоне 30 минут»).
  `: cursor-too-old` → полный сброс кэша `["miniapp"]`.

### Табло/киоск/талон

`use-queue-board.ts`, `use-doctor-board.ts`, `src/app/q/[id]/page.tsx` —
свои `EventSource` на `/api/c/[slug]/queue/events`; события для них не данные,
а «поки»: по любому whitelisted-событию — дебаунс-рефетч REST-эндпоинта board
(250–350 мс) + медленный поллинг-страховка (10–20 с).

### Чем чревата слишком широкая подписка

- `events: [...]` без `shouldInvalidate` — клиника-широкий триггер: смена
  статуса у ЛЮБОГО врача рефетчит дашборд/список/кабинеты у КАЖДОГО открытого
  экрана ресепшна. При 5 ресепшнах и 50 сменах статусов в день это дало бы
  сотни лишних GET'ов — именно поэтому существуют дебаунс 400 мс и
  `refetchType:"active"`; но они не отменяют того, что каждое «окно» = полный
  рефетч тяжёлых списков (`useTodayAppointments` ходит до 10 страниц по 200).
- Подписка без `filter` вообще (`filter` опущен → `"*"`) получает ВСЕ типы —
  колбэк дёргается и на `visit-note.draftSaved` (автосейв каждые ~1.5 с у
  каждого пишущего врача). Всегда указывайте `filter`.
- Инлайн-массив `filter` безопасен (см. `filterKey`), но НЕ выносите логику
  выбора типов в нестабильный useMemo без зависимостей — вернёте флап сокета.

Playbook добавления нового события — шапка `src/server/realtime/events.ts`
(«Adding a new event type», 5 шагов) + `docs/realtime.md`.

---

## 6. Прод: nginx, SSE и чек-лист «не обновляется вживую»

### nginx (`nginx/nginx.conf`)

SSE-специфичный тюнинг есть **только у `/api/events`** (точный матч, строка 118):

```nginx
location = /api/events {
  proxy_buffering  off;
  proxy_cache      off;
  proxy_read_timeout 1h;
  proxy_send_timeout 1h;
  chunked_transfer_encoding on;
}
```

`/api/miniapp/events` и `/api/c/[slug]/queue/events` попадают в общий
`location /` с `proxy_read_timeout 60s` и включённой по умолчанию
буферизацией. Они выживают за счёт трёх вещей в самих роутах:

1. заголовок `X-Accel-Buffering: no` — nginx отключает буферизацию per-response;
2. первая строка `: ok\n\n` — мгновенный флаш через любой промежуточный буфер;
3. heartbeat `: ping\n\n` каждые 20 с (`HEARTBEAT_MS`) — меньше 60-секундного
   `proxy_read_timeout`, поэтому таймаут не срабатывает.

⚠️ Если поднять `HEARTBEAT_MS` выше 60 с или убрать `X-Accel-Buffering`,
mini-app и табло молча отвалятся **только в проде** (в dev nginx нет). При
добавлении нового SSE-роута — либо добавить ему свой `location` по образцу
`/api/events`, либо сохранить все три механизма.

### Чек-лист «не обновляется вживую»

По порядку от дешёвого к дорогому:

1. **Смоук стрима:** `curl -N -H "Cookie: <session>" https://neurofax.uz/api/events`
   — должно прийти `: ok`, затем `: ping` каждые 20 с. Нет `: ok` → nginx/роут;
   `: ok` есть, событий нет → шина.
2. **Worker жив?** `docker compose ps worker`; в логах должна быть строка
   `[worker] outbox-pumper registered every 200ms`. Мёртвый pumper = нет
   ни одного v2-события (§3).
3. **Бэклог outbox:** `SELECT status, count(*) FROM "EventOutbox" GROUP BY status;`
   Растёт `PENDING` → pumper не тикает; есть `DEAD` → читать `lastError`.
4. **Redis:** `REDIS_URL` должен быть у ОБОИХ контейнеров (`docker-compose.yml:80,106`).
   Без него web-процесс никогда не услышит событий воркера (все v2 + воркерные v1).
   Проверка: `redis-cli psubscribe 'events:*'` во время мутации.
5. **Диалект:** событие v2, а потребитель парсит только `AppEventSchema`?
   (Сегодня это весь CRM-контур — §2.) Симптом: mini-app обновляется, CRM — нет
   (или наоборот).
6. **Тип не в белом списке:** для mini-app — `MINIAPP_DELIVERABLE_TYPES`;
   для табло — `BOARD_EVENT_TYPES`; для инвалидации — есть ли тип в `events:[…]`
   хука и в `MINIAPP_INVALIDATION_MAP`.
7. **Клиент:** вкладка Network → `eventsource` — состояние соединения, частота
   реконнектов (флап = проблема `filterKey`/refCount), приходят ли `data:`-кадры.
8. **Метрики** (`src/server/observability/metrics`): `sseConnectionsActive`,
   `sseEventsDelivered`, `sseReplayEvents`, `outboxPublishes` — mini-app-роут
   их инкрементит; CRM-роут — нет.

Известные грабли соседства на shared-VPS (nginx один на medbook/rtxshop/…)
описаны в memory: перезапуск/правка nginx требует смоук-теста соседей.
