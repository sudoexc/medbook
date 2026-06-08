# ТЗ — Cross-surface sync v1

**Статус:** Draft 2026-06-01 · автор: архитектурный аудит
**Скоуп:** полная синхронизация трёх поверхностей MedBook — CRM админ, кабинет врача, TG mini-app пациента.
**Связанные документы:** `docs/TZ.md` §§4.6/8.8, `docs/realtime.md`, `src/app/[locale]/doctor/_ROADMAP.md`, `reports/scratch/2026-06-01-sync-map-part-c.md` (полная карта текущего состояния).

---

## 0. TL;DR

Три поверхности живут одной БД и одним event-bus, но синхронизация частичная и асимметричная: CRM + кабинет врача подписаны на SSE, **mini-app пациента — нет**. Часть доменных мутаций (autosave VisitNote, изменения расписания, статусы доставки уведомлений) **не публикуют события вообще**. TOTP-гард обходится через `/api`. Audit-trail неоднороден между поверхностями.

Этот ТЗ описывает целевую архитектуру в которой:

1. Все три поверхности **подписаны** на SSE через свой scoping (clinic / doctor / patient).
2. Все три поверхности **публикуют** события с единым envelope (actor + surface + correlationId).
3. Событие проходит через **outbox** — write-ahead-log в той же транзакции что и доменная мутация → гарантированная доставка + cursor-based replay.
4. **TOTP enforcement** перенесён в `createApiHandler`, гард един для всех `/api/crm/**`.
5. **Audit log** становится производным от outbox → один источник истины для compliance.
6. Доменные операции (booking, confirm, reschedule, cancel, finalize, prescribe) **унифицированы** в shared server functions — один путь записи на все поверхности.
7. Mock-данные доктор-кабинета **удаляются** и заменяются реальными API.

Цель: к концу внедрения **любое действие на любой поверхности приводит к одинаково-полному обновлению на двух других в течение <1 секунды**, без потерь при reconnect, с полным audit-trail "кто что сделал на какой поверхности".

---

## 1. Цели и нон-цели

### 1.1 Цели

| # | Цель | Метрика приёмки |
|---|------|----|
| G1 | End-to-end realtime в mini-app | Patient видит обновление статуса аппойнтмента в течение 1с после действия в CRM/кабинете врача |
| G2 | Bidirectional sync без полла | Полл-интервал на mini-app ≥ 60с (только safety-net), повседневная синхронизация — только SSE |
| G3 | At-least-once доставка событий | Перезагрузка SSE-клиента не приводит к потере событий; replay из outbox по `Last-Event-ID` |
| G4 | Унифицированный actor identity | Аудит-запись для любого изменения `Appointment`, `VisitNote`, `Prescription` содержит: `actorRole`, `actorSurface`, `actorId`, `onBehalfOfPatientId?`, `correlationId` |
| G5 | TOTP gate per-API | DOCTOR в `require2faForAll=true` клинике без TOTP не может вызвать `/api/crm/**` (403) |
| G6 | Conflict-safe write на VisitNote | Параллельная запись двух акторов в один VisitNote → последний получает 409, не silent-overwrite |
| G7 | Notification delivery telemetry | DLR webhook от TG → `notification.delivered` + `notification.read` события → CRM показывает delivery badge в реальном времени (SMS-канал удалён в Q2 2026 — см. `TZ-sms-removal.md`) |
| G8 | Slot/availability fan-out | Изменение расписания / `DoctorTimeOff` → mini-app пациента сразу видит обновлённую доступность |
| G9 | Mock-free doctor cabinet | В `/doctor/**` нет ни одного `MOCK_*` импорта в продакшен-бандле |
| G10 | Backwards-compatible миграция | Все изменения катятся фазами, каждая фаза самодостаточна, ни одна не разламывает работающую систему |

### 1.2 Нон-цели (НЕ делаем в этом ТЗ)

- **Mobile push (FCM/APNs)** — отдельный канал, не SSE. Закрывается в отдельном ТЗ.
- **Multi-region / GeoDNS** — Redis pub/sub считается single-region; шардирование по регионам вне скоупа.
- **End-to-end encryption** мед.данных — отдельная compliance-инициатива, текущий cipher-fields на `Prescription` остаётся.
- **AI realtime** (live transcription, suggestion stream) — Phase 3b кабинета врача, отдельный ТЗ.
- **Полное переписывание notification system** — улучшаем delivery telemetry, остальное оставляем.

---

## 2. Текущее состояние — выжимка из карты

Полная инвентаризация в `reports/scratch/2026-06-01-sync-map-part-c.md` + два других отчёта (miniapp + doctor cabinet). Здесь только то, что важно для решений ТЗ.

### 2.1 Шина и SSE

- **`src/server/realtime/event-bus.ts`** — in-process EventBus, sync-pub/sub.
- **`src/server/realtime/redis-adapter.ts`** — опциональный Redis pub/sub fan-out по `events:<clinicId>`.
- **`src/server/realtime/publish.ts`** — `publishEvent()` (бросает на schema violation) + `publishEventSafe()` (логирует и продолжает). 40+ типов событий в `events.ts`.
- **`/api/events/route.ts`** — единственный SSE-эндпоинт, требует session-auth, scope `clinicId`.

**Что отсутствует:**
- Outbox-таблица — все publish'ы fire-and-forget. Если Redis лежит или подписчиков нет, событие потеряно.
- `Last-Event-ID` / cursor — нет.
- Patient-scoped SSE — нет.
- Doctor-scoped SSE filter — нет (доктор A получает события доктора B).

### 2.2 Подписки (current)

| Поверхность | Publish | Subscribe | Реалтайм |
|---|---|---|---|
| CRM админ | ✅ во всех мутациях | ✅ `useLiveEvents` + invalidator | полный |
| Doctor cabinet (frozen) | ✅ при `confirmAppointment`, `finalize`, cold-start conv | ✅ `useLiveEvents` (clinic-wide) | полный когда unpause |
| Mini-app пациента | ✅ через `fireTrigger` для уведомлений | **❌ ни одной подписки** | **ноль** |

### 2.3 Семь основных разрывов

1. Mini-app не подписан на SSE.
2. `PATCH /api/crm/visit-notes/[id]` (autosave диагноза/назначений) не публикует событие, нет audit.
3. TOTP-гард обходится через `/api`.
4. Mock-данные в `/doctor/visits/[id]` + `/doctor/patients` сайдбарах.
5. `POST /api/crm/doctors/me/conversations/find-or-create` создаёт Conversation без audit.
6. Referral reward auto-apply только в miniapp-booking, не в CRM-booking.
7. `notification.delivered`/`read` события не публикуются; schedule/availability fan-out отсутствует.

---

## 3. Целевая архитектура

### 3.1 Пять архитектурных сдвигов

1. **Event envelope v2** — расширяем payload неизменяемыми метаданными `actor`, `surface`, `correlationId`, `eventId`, `causedByEventId?`, `tenantScope`. Старый `AppEvent` остаётся как backwards-compat alias.
2. **Outbox-pattern** — события пишутся в `EventOutbox` таблицу в той же транзакции что и доменная мутация. Бэкграунд-пампер вычитывает и публикует в EventBus + Redis. Это даёт at-least-once гарантию и cursor для replay.
3. **SSE scope-aware** — три типа подписок:
   - `/api/events` — клиника-wide (CRM + admin staff)
   - `/api/events?scope=doctor` — фильтр по `doctorId` в payload (кабинет врача)
   - `/api/miniapp/events` — фильтр по `patientId` (+ family-linked patientIds) (mini-app)
4. **Audit unified through outbox** — каждое опубликованное событие пишет одну строку в `AuditLog` (если event-type помечен `auditable: true`). Audit перестаёт быть отдельной точкой вызова в каждом хендлере.
5. **Shared domain functions** — `bookAppointment()`, `rescheduleAppointment()`, `cancelAppointment()`, `confirmAppointment()` (уже есть), `completeVisit()`, `prescribeMedication()` — единый путь записи. Каждая поверхность вызывает одну и ту же функцию через свой API-роут.

### 3.2 Диаграмма потока (one mutation, three surfaces hear)

```
                  ┌────────────────────────────┐
   actor → API →  │  shared domain function    │
                  │  (e.g. confirmAppointment) │
                  └──────────────┬─────────────┘
                                 │ Prisma tx
                                 ▼
                  ┌──────────────────────────────────────┐
                  │  tx { update Appointment;            │
                  │       insert EventOutbox row;        │
                  │       insert AuditLog row (if audit) │
                  │     }                                │
                  └──────────────┬───────────────────────┘
                                 │
                                 ▼
                  ┌────────────────────────────┐
                  │   OutboxPumper (worker)     │
                  │   poll(SELECT … FOR UPDATE  │
                  │        SKIP LOCKED LIMIT N) │
                  └──────────────┬─────────────┘
                                 │ publishEvent()
              ┌──────────────────┼────────────────┐
              ▼                  ▼                ▼
        local EventBus     Redis events:<cid>   marks row DELIVERED
              │                  │
              │            ┌─────┘
              │            │ pmessage on other nodes
              ▼            ▼
   ┌──────────────────────────────────────┐
   │  SSE handlers (3 endpoints):         │
   │   /api/events                        │
   │   /api/events?scope=doctor           │
   │   /api/miniapp/events?patientId=…    │
   │  каждый: фильтр + frame              │
   └──────────────┬───────────────────────┘
                  │ data: <json>\n\n   (id: <eventId>\n)
                  ▼
   ┌──────────────────────────────────────┐
   │  EventSource clients (CRM, doctor,   │
   │   mini-app); store Last-Event-ID;    │
   │   на reconnect → ?since=<id> →       │
   │   replay из outbox                   │
   └──────────────────────────────────────┘
```

---

## 4. Контракт событий v2

### 4.1 Envelope

```ts
// src/server/realtime/envelope.ts (новый)
export type EventEnvelope<P = unknown> = {
  // identity
  eventId: string;              // ulid, генерится в outbox insert
  causedByEventId?: string;     // chain causality (e.g. TG button YES → confirm → notification)
  correlationId: string;        // shared across cascade; первое событие в цепочке генерит, остальные наследуют

  // when
  at: string;                   // ISO-8601 with offset, момент outbox insert (не publish)

  // what
  type: EventType;              // discriminator (existing union, расширяется)
  payload: P;                   // per-type Zod schema

  // who + where
  actor: {
    role: ActorRole;            // 'PATIENT' | 'DOCTOR' | 'RECEPTIONIST' | 'ADMIN' | 'SUPER_ADMIN' | 'SYSTEM' | 'EXTERNAL'
    userId: string | null;      // staff user id; null для PATIENT/SYSTEM/EXTERNAL
    patientId: string | null;   // pid для PATIENT; null иначе
    onBehalfOfPatientId: string | null;  // family scenario
    label: string;              // human-friendly: "Иванов И.И. (DOCTOR)", "patient:tg:…", "system:notification-worker"
  };
  surface: Surface;             // 'CRM' | 'DOCTOR_CABINET' | 'MINIAPP' | 'TG_WEBHOOK' | 'WORKER' | 'CALL_CENTER' (SMS_WEBHOOK retired Q2 2026 per TZ-sms-removal.md)

  // scope (for SSE filtering)
  tenantScope: {
    clinicId: string;
    doctorId?: string;          // optional → doctor-scoped events
    patientId?: string;         // optional → patient-scoped events
    appointmentId?: string;     // optional → fine-grained reroute
  };
};
```

**Old envelope (`AppEvent`) deprecation** — оставляем как type alias на `EventEnvelope<P>` без `actor/surface/tenantScope.*` (помечаем deprecated). Старые publishers продолжают работать через wrapper, новые → строго с v2.

### 4.2 EventType (расширение)

Добавляем **новые топики** к существующим:

| Топик | Когда | Кто публикует |
|---|---|---|
| `appointment.referralApplied` | discount применён при booking | shared `bookAppointment()` |
| `visit-note.draftSaved` | autosave PATCH | `/api/crm/visit-notes/[id]` |
| `visit-note.finalized` | finalize | shared `completeVisit()` |
| `visit-note.reverted` | undo finalize | shared `revertVisit()` |
| `prescription.created` | новый Rx | shared `prescribeMedication()` |
| `prescription.paused` / `.resumed` / `.cancelled` | смена статуса | shared `updatePrescription()` |
| `notification.delivered` | DLR webhook от TG (SMS DLR удалён Q2 2026 — см. TZ-sms-removal.md) | DLR handler |
| `notification.read` | пациент открыл inbox-item / нажал TG-кнопку | inbox PATCH / TG webhook |
| `doctor.scheduleChanged` | изменение `DoctorSchedule` | `/api/crm/doctors/[id]/schedule` |
| `doctor.timeOffCreated` / `.timeOffRemoved` | `DoctorTimeOff` | соответствующие роуты |
| `cabinet.changed` | изменение `Cabinet.isActive` или назначения | `/api/crm/cabinets/[id]` |
| `service.priceChanged` | изменение `Service.priceBase` | `/api/crm/services/[id]` |
| `patient.familyLinked` / `.familyUnlinked` | mini-app или CRM | оба роута |
| `conversation.created` | cold-start от doctor/CRM | shared `findOrCreateConversation()` (новая) |
| `payment.linkSent` | патиент получил ссылку на оплату | payment worker |

Все новые топики строго v2 envelope (`actor` + `surface` + `tenantScope`).

### 4.3 Payload conventions

- Payload **не дублирует** поля из `tenantScope` (нет `payload.clinicId`, есть `tenantScope.clinicId`).
- Payload содержит **только** то что нужно подписчикам для UI-обновления (id'ы для invalidation + минимальные denormalized поля для toast/badge).
- Тяжёлые сущности **не пушим** — подписчик делает refetch по id.
- Zod-схемы для каждого type. Несовместимые изменения payload → новый event-type (`appointment.statusChanged.v2`).

### 4.4 Auditable flag

```ts
// src/server/realtime/events.ts
export const EVENT_META: Record<EventType, { auditable: boolean; severity: 'info'|'warning'|'critical' }> = {
  'appointment.confirmed':    { auditable: true,  severity: 'info' },
  'appointment.cancelled':    { auditable: true,  severity: 'info' },
  'visit-note.finalized':     { auditable: true,  severity: 'info' },
  'patient.familyLinked':     { auditable: true,  severity: 'info' },
  'queue.updated':            { auditable: false, severity: 'info' },  // высокочастотное, аудит не нужен
  'notification.sent':        { auditable: false, severity: 'info' },
  'notification.failed':      { auditable: true,  severity: 'warning' },
  // …
};
```

Outbox-pumper при доставке `auditable: true` события вставляет строку в `AuditLog` с `actor` + `surface` из envelope.

---

## 5. Outbox — durability layer

### 5.1 Схема БД

```prisma
model EventOutbox {
  id              String   @id @default(cuid())  // eventId
  correlationId   String
  causedByEventId String?
  clinicId        String
  type            String                          // event type
  envelope        Json                            // полный EventEnvelope (без id, оно тут же)
  createdAt       DateTime @default(now())
  status          OutboxStatus @default(PENDING)  // PENDING | DELIVERED | FAILED | DEAD
  deliveredAt     DateTime?
  attempts        Int      @default(0)
  lastError       String?

  @@index([clinicId, status, createdAt])         // pumper poll
  @@index([clinicId, createdAt])                 // replay по cursor
  @@index([correlationId])                       // chain trace
}

enum OutboxStatus {
  PENDING
  DELIVERED
  FAILED          // retry-able, < maxAttempts
  DEAD            // > maxAttempts, нужно ручное вмешательство
}
```

### 5.2 Pumper

`src/server/workers/outbox-pumper.ts` — новый worker, запускается в `worker` контейнере параллельно scheduler'у.

- Каждые 200мс: `SELECT * FROM EventOutbox WHERE status='PENDING' AND clinicId IS NOT NULL ORDER BY createdAt LIMIT 100 FOR UPDATE SKIP LOCKED`.
- Для каждой строки → `publishEvent(envelope.tenantScope.clinicId, envelope)`. Если publish успешен → `UPDATE status='DELIVERED', deliveredAt=now()`.
- Если publish бросил → `UPDATE attempts=attempts+1, lastError=…, status=(attempts<5 ? 'FAILED' : 'DEAD')`. FAILED → retry через exponential backoff (`createdAt + 2^attempts seconds < now()`).
- Pumper берёт `auditable:true` события и пишет в `AuditLog` (idempotently — `eventId` в `AuditLog.eventId` UNIQUE).

**Backpressure:** если outbox > 10000 PENDING — алерт в action-center, ручная инвестигация. В нормальной операции <1с от insert до DELIVERED.

### 5.3 Транзакционный insert helper

```ts
// src/server/realtime/outbox.ts (новый)
export async function publishViaOutbox(
  tx: PrismaTx,
  envelope: Omit<EventEnvelope, 'eventId' | 'at'>,
): Promise<string> {
  const eventId = ulid();
  const at = new Date().toISOString();
  const full: EventEnvelope = { ...envelope, eventId, at };

  await tx.eventOutbox.create({
    data: {
      id: eventId,
      correlationId: envelope.correlationId,
      causedByEventId: envelope.causedByEventId ?? null,
      clinicId: envelope.tenantScope.clinicId,
      type: envelope.type,
      envelope: full,
    },
  });

  return eventId;
}
```

Используется внутри shared domain functions:

```ts
// src/server/appointments/confirm.ts (расширение)
await prisma.$transaction(async (tx) => {
  await tx.appointment.update({ … });
  await publishViaOutbox(tx, {
    correlationId,
    type: 'appointment.confirmed',
    actor: { role: 'RECEPTIONIST', userId, patientId: null, label: 'Иванов И.И.', onBehalfOfPatientId: null },
    surface: 'CRM',
    tenantScope: { clinicId, doctorId, patientId, appointmentId },
    payload: { previousStatus: 'BOOKED', status: 'CONFIRMED' },
  });
});
```

### 5.4 Replay через cursor

`/api/events?since=<eventId>` — если query задан, перед стартом стрима SSE handler делает:

```ts
const missed = await prisma.eventOutbox.findMany({
  where: {
    clinicId,
    status: 'DELIVERED',
    createdAt: { gt: cursorEvent.createdAt },
    // filter по scope: doctor / patient
  },
  orderBy: { createdAt: 'asc' },
  take: 200,                  // limit replay budget
});
for (const row of missed) {
  yield `id: ${row.id}\ndata: ${JSON.stringify(row.envelope)}\n\n`;
}
```

EventSource автоматически шлёт `Last-Event-ID` header при reconnect. SSE handler читает из header → строит cursor. Это покрывает 99% сценариев reconnect без полла.

**Edge case** — если cursor старше outbox retention (TTL 30 дней), сервер шлёт `event: cursor-too-old\ndata: {}\n\n` → клиент полностью invalidate'ит кэш и заново загружает данные.

---

## 6. SSE: per-surface scoping

### 6.1 Три эндпоинта

| Endpoint | Auth | Scope | Кто слушает |
|---|---|---|---|
| `/api/events` | session-auth (CRM/staff) | `clinicId` из session | CRM-страницы, action-center, sidebar-stats |
| `/api/events?scope=doctor` | session-auth + role=DOCTOR | `clinicId` + `doctorId` из session→doctor | Кабинет врача |
| `/api/miniapp/events?clinicSlug=…` | Telegram initData HMAC + clinic-slug | `clinicId` + `patientId` (+ family-linked patientIds) | Mini-app пациента |

### 6.2 Server-side фильтр

В SSE handler перед эмитом frame:

```ts
function shouldDeliver(env: EventEnvelope, sub: Subscription): boolean {
  if (env.tenantScope.clinicId !== sub.clinicId) return false;

  switch (sub.scope) {
    case 'clinic':
      return true;
    case 'doctor':
      return env.tenantScope.doctorId === sub.doctorId;
    case 'patient': {
      const allowedPatientIds = [sub.patientId, ...sub.familyLinkedPatientIds];
      return env.tenantScope.patientId !== undefined &&
             allowedPatientIds.includes(env.tenantScope.patientId);
    }
  }
}
```

**Важно** — фильтр на сервере, не на клиенте: пациент A технически не может перехватить события пациента B (защита от прослушки).

### 6.3 `/api/miniapp/events` — детали

```ts
// src/app/api/miniapp/events/route.ts (новый)
export const GET = createMiniAppHandler(async ({ request, ctx }) => {
  const familyLinkedPatientIds = await prisma.patientFamily.findMany({
    where: { ownerPatientId: ctx.patientId },
    select: { linkedPatientId: true },
  }).then(rows => rows.map(r => r.linkedPatientId));

  const sub: Subscription = {
    scope: 'patient',
    clinicId: ctx.clinicId,
    patientId: ctx.patientId,
    familyLinkedPatientIds,
  };

  // replay + live stream (см. §5.4)
  return sseStream(sub, request);
});
```

Mini-app клиент:

```ts
// src/app/c/[slug]/my/_hooks/use-patient-events.ts (новый)
const es = new EventSource(`/api/miniapp/events?clinicSlug=${slug}`, { withCredentials: true });
es.onmessage = (e) => {
  const env: EventEnvelope = JSON.parse(e.data);
  // invalidate соответствующие react-query кэши
  invalidator.handle(env);
};
```

### 6.4 Topics → query keys (mini-app)

| Топик | Что инвалидировать |
|---|---|
| `appointment.{confirmed,cancelled,statusChanged,updated,moved}` | `['miniapp', 'appointments', patientId, scope]` |
| `notification.{sent,delivered}` для INAPP канала | `['miniapp', 'inbox', patientId]` |
| `prescription.{created,paused,resumed,cancelled}` | `['miniapp', 'medications', patientId, scope]` |
| `visit-note.finalized` | `['miniapp', 'appointments', patientId, 'past']` (карточка визита получит conclusionUrl) |
| `patient.familyLinked` / `.familyUnlinked` | `['miniapp', 'family', patientId]` |
| `doctor.scheduleChanged`, `doctor.timeOffCreated/Removed` | `['miniapp', 'slots', '*']` (любой слот-запрос инвалидируется) |
| `referralReward.{earned,applied,expired}` | `['miniapp', 'referral', patientId]` |

---

## 7. Доменные потоки (end-to-end)

Для каждого потока: **триггер** → **shared function** → **записи** → **events** → **подписчики**.

### 7.1 Patient books appointment (mini-app)

- Триггер: `POST /api/miniapp/appointments`
- Shared: `bookAppointment({ source: 'MINIAPP', patientId, doctorId, … })` (новая)
- Записи (в одной tx): `Appointment` create + `AppointmentService` createMany + `MedicalCase` auto-create-or-attach + `ReferralReward` auto-apply + `EventOutbox` × N
- Events:
  - `appointment.created` (для всех)
  - `appointment.referralApplied` (если discount применился; auditable)
  - `medical-case.created` (если auto-created; auditable)
- Подписчики:
  - CRM `/calendar`, `/appointments`, `/reception` → refetch list
  - Кабинет врача `/my-day`, `/schedule` → refetch (если этот доктор)
  - Mini-app: пациент уже видит созданный appointment в response — invalidate не нужен, но `appointment.created` приходит для self-consistency

### 7.2 ~~Receptionist confirms via SMS YES webhook~~ — RETIRED

> **Q2 2026:** этот флоу удалён вместе с SMS-каналом (см. `TZ-sms-removal.md` Waves 2-3). Pathway `/api/sms/webhook` больше не существует, `confirmedVia='SMS'` остаётся валидным только для исторических rows. Подтверждение визита теперь идёт через TG-кнопку (inline keyboard), голосовой звонок call-центра, или ручной flip регистратурой в CRM.

### 7.3 Doctor finalizes visit

- Триггер: `POST /api/crm/visit-notes/[id]/finalize`
- Shared: `completeVisit({ visitNoteId, doctorUserId })` (новая)
- Записи (tx): `VisitNote.status=FINALIZED` + `Appointment.status=COMPLETED, completedAt` + `Action` create (payment-due если applicable) + EventOutbox
- Events:
  - `visit-note.finalized` (auditable, actor.role=DOCTOR)
  - `appointment.statusChanged` (status=COMPLETED)
  - `queue.updated`
- Подписчики:
  - CRM kanban → карточка переезжает в COMPLETED
  - Кабинет врача `/my-day` → current-patient уходит, upcoming сдвигается
  - **Mini-app → карточка визита получает `conclusionUrl`** (новое); инбокс получает запись "Заключение готово"

### 7.4 Doctor autosaves diagnosis/prescriptions (debounced 1.5s)

- Триггер: `PATCH /api/crm/visit-notes/[id]`
- Shared: `saveDraftVisitNote({ visitNoteId, fields, version })` (новая, с optimistic concurrency)
- Конфликт-проверка: `WHERE version = :version` → если 0 rows updated, бросаем 409
- Записи: `VisitNote` update + version++ + EventOutbox
- Events:
  - `visit-note.draftSaved` (НЕ auditable — высокочастотный, но coalesce в "сводный" audit при finalize)
- Подписчики:
  - Кабинет врача — самообновление UI
  - CRM `/appointments/[id]` если открыт detail-pane врача → показывает live-прогресс
  - Mini-app — НЕ получает (draft = staff-only)

### 7.5 CRM receptionist reschedules appointment

- Триггер: `PATCH /api/crm/appointments/[id]` с новой `startAt`
- Shared: `rescheduleAppointment({ appointmentId, newStartAt, newDoctorId? })` (новая)
- Записи: `Appointment` update (date/time/durationMin/endDate) + EventOutbox + notification schedule update
- Events:
  - `appointment.moved` (auditable)
  - `queue.updated`
  - `appointment.updated`
- Подписчики:
  - CRM calendar drag-and-drop animation
  - Кабинет врача — расписание сдвигается
  - **Mini-app → toast "Время изменено", appointment card в `upcoming` пере-сортируется** (новое)
  - Notification worker → reschedules reminder triggers

### 7.6 Patient cancels via mini-app

- Триггер: `DELETE /api/miniapp/appointments/[id]`
- Shared: `cancelAppointment({ source: 'MINIAPP', appointmentId, actor: { patientId } })` (новая)
- Записи: `Appointment.status=CANCELLED, cancelledAt, cancelledBy=patient` + EventOutbox + notification cancel queue
- Events:
  - `appointment.cancelled` (auditable)
  - `queue.updated`
- Подписчики:
  - CRM kanban / calendar — карточка переезжает в CANCELLED
  - Кабинет врача — слот освобождается
  - Mini-app — self-update

### 7.7 Doctor changes schedule (working hours)

- Триггер: `PATCH /api/crm/doctors/[id]/schedule`
- Shared: `updateDoctorSchedule({ doctorId, weeklySchedule })`
- Записи: `DoctorSchedule` update + EventOutbox
- Events:
  - `doctor.scheduleChanged` (auditable)
- Подписчики:
  - CRM calendar → fresh slot grid
  - Кабинет врача `/schedule` → self-refetch
  - **Mini-app slot picker → invalidate все `slots` query keys** (новое); если пациент в процессе бронирования, видит обновлённые слоты

### 7.8 ~~SMS DLR webhook → delivery telemetry~~ — RETIRED

> **Q2 2026:** удалено вместе с SMS-каналом (см. `TZ-sms-removal.md`). `/api/sms/dlr` route больше не существует; DLR от TG приходит через TG webhook и обновляет `NotificationSend.status='DELIVERED'` точно так же, как описано ниже.

### 7.9 Patient marks INAPP notification as read

- Триггер: `POST /api/miniapp/inbox/[id]`
- Shared: `markNotificationRead({ notificationSendId, patientId })`
- Записи: `NotificationSend.readAt, status='READ'` + EventOutbox
- Events:
  - `notification.read`
- Подписчики:
  - CRM `/notifications` → row badge "Прочитано"

### 7.10 CRM cold-start conversation to patient

- Триггер: `POST /api/crm/conversations/find-or-create` (был только doctor-side; расширяется)
- Shared: `findOrCreateConversation({ patientId, initiatorRole, initiatorUserId })` (новая, замена doctor-specific endpoint)
- Записи (tx): `Conversation` create-or-find + EventOutbox + audit
- Events:
  - `conversation.created` (auditable — закрывает существующий compliance gap)
  - `tg.conversation.updated`
- Подписчики:
  - CRM `/crm/telegram` → thread появляется в inbox
  - Кабинет врача `/doctor/messages` → thread появляется
  - Mini-app → не получает (conv создаётся пока без сообщения)

### 7.11 Doctor prescribes medication

- Триггер: `POST /api/crm/doctors/me/prescriptions` (новый, был только UI-dialog без backend)
- Shared: `prescribeMedication({ patientId, doctorId, medication })` (новая)
- Записи: `Prescription` create + EventOutbox
- Events:
  - `prescription.created` (auditable)
- Подписчики:
  - **Mini-app `/medications` → новый Rx появляется в списке live** (новое)
  - Hourly worker создаёт `MedicationReminderSend` начиная со следующего тика

### 7.12 SUPER_ADMIN impersonates clinic (VIEW_ONLY)

- Триггер: любая мутация в impersonation mode
- Поведение: `createApiHandler` в impersonation+VIEW_ONLY режиме отклоняет ВСЕ POST/PATCH/DELETE с 403 (уже частично реализовано в P1-12).
- Events: `audit.impersonation.attempted_write` (auditable, severity=warning)
- Подписчики: alert в admin action-center

---

## 8. Изменения схемы БД

### 8.1 Новые таблицы

```prisma
model EventOutbox {
  // см. §5.1
}
```

### 8.2 Расширения существующих таблиц

```prisma
model VisitNote {
  // … existing fields
  version    Int  @default(1)          // optimistic concurrency
}

model Appointment {
  // … existing
  confirmedVia String?                  // 'CRM' | 'TG' | 'CALL' | 'KIOSK' | 'AUTO' (SMS — legacy, не пишется после Q2 2026)
  cancelledBy  String?                  // 'patient' | 'staff' | 'system' | 'no-show'
}

model NotificationSend {
  // … existing
  deliveredAt   DateTime?
  providerCode  String?
}

model AuditLog {
  // … existing
  eventId       String? @unique         // FK на EventOutbox.id (nullable для legacy)
  surface       String?                 // 'CRM' | 'DOCTOR_CABINET' | 'MINIAPP' | …
  correlationId String?
}

model PatientFamily {
  // … existing
  // no changes needed
}
```

### 8.3 Миграции

- M1: создать `EventOutbox` + indexes
- M2: `VisitNote.version` (default 1)
- M3: `Appointment.cancelledBy`, `NotificationSend.deliveredAt`, `NotificationSend.providerCode`
- M4: `AuditLog.eventId`, `AuditLog.surface`, `AuditLog.correlationId`

Все миграции **строго additive** (новые nullable / default-value колонки). Никаких NOT NULL без default, никаких rename'ов в одной волне.

---

## 9. Изменения API

### 9.1 Новые роуты

| Route | Method | Purpose |
|---|---|---|
| `/api/miniapp/events` | GET (SSE) | Patient-scoped event stream |
| ~~`/api/sms/dlr`~~ | ~~POST~~ | ~~DLR webhook~~ — RETIRED Q2 2026 (см. `TZ-sms-removal.md`) |
| `/api/crm/conversations/find-or-create` | POST | Unified cold-start (заменяет doctor-specific) |
| `/api/crm/doctors/me/prescriptions` | POST | Real backend для prescription dialog |
| `/api/crm/visit-notes/[id]/revert` | POST | Undo finalize (новый) |

### 9.2 Расширения существующих роутов

- **Все мутирующие `/api/crm/**` и `/api/miniapp/**` хендлеры** → внутри tx вызывают `publishViaOutbox()` вместо `audit()` + `publishEventSafe()`. Audit-helper становится legacy (помечается deprecated).
- **`PATCH /api/crm/visit-notes/[id]`** → принимает `If-Match: <version>` header. Если version не совпадает → 409 `{ error: 'concurrent-edit', current: { version, lastEditedAt, lastEditedBy } }`.
- **`/api/events?since=<eventId>`** → replay при reconnect (см. §5.4).
- **`/api/events?scope=doctor`** → doctor-scoped (см. §6).

### 9.3 `createApiHandler` — TOTP gate

```ts
// src/lib/api-handler.ts (расширение)
export function createApiHandler(opts) {
  return async (request) => {
    const session = await getSession(request);
    if (!session) return unauthorized();

    const ctx = await buildContext(session);

    // NEW: TOTP enforcement
    if (await requiresTotpEnrollment(ctx) && !session.totpEnrolled) {
      return new Response(
        JSON.stringify({ error: 'totp-required', enrollUrl: '/crm/me/security/totp' }),
        { status: 403 },
      );
    }

    // existing role check + handler invocation
    return runWithTenant(ctx, () => opts.handler(request, ctx));
  };
}
```

Точно такой же гейт добавляется в `createApiListHandler` и `createMiniAppHandler` (для mini-app тоже опционально). Закрывает gap из §2.3.

---

## 10. Изменения UI

### 10.1 Mini-app — добавление SSE подписки

**Новый hook** `src/app/c/[slug]/my/_hooks/use-patient-events.ts`:

```tsx
export function usePatientEvents(opts: { clinicSlug: string }) {
  const queryClient = useQueryClient();
  React.useEffect(() => {
    const es = new EventSource(`/api/miniapp/events?clinicSlug=${opts.clinicSlug}`);
    es.onmessage = (e) => {
      const env: EventEnvelope = JSON.parse(e.data);
      INVALIDATION_MAP[env.type]?.(queryClient, env);
    };
    es.onerror = (e) => {
      // EventSource auto-reconnects with Last-Event-ID; logging only
      console.error('[patient-sse]', e);
    };
    return () => es.close();
  }, [opts.clinicSlug, queryClient]);
}
```

Подключается один раз в `src/app/c/[slug]/my/layout.tsx`.

### 10.2 Doctor cabinet — снять моки

| Файл | Что делать |
|---|---|
| `src/app/[locale]/doctor/visits/[patientId]/_components/last-visit-card.tsx` | заменить `MOCK_LAST_VISIT` на хук `useLastCompletedVisit(patientId)` → дёргает `/api/crm/doctors/me/patients/[patientId]/visits?limit=1&status=COMPLETED` |
| `src/app/[locale]/doctor/visits/[patientId]/_components/last-diagnosis-card.tsx` | то же, берёт diagnosis из последнего VisitNote |
| `src/app/[locale]/doctor/visits/[patientId]/_components/patient-meta-row.tsx` | дёргает `/api/crm/patients/[id]/summary` (cached LLM-снимок + allergies/chronic из БД) |
| `src/app/[locale]/doctor/patients/_components/ai-assistant-panel.tsx` | заменить `MOCK_AI_RECOS` на `/api/crm/doctors/me/patient-segments` (donut + top-N сегменты) |

Удалить `_mocks.ts` и `_active-mocks.ts` файлы целиком после переключения.

### 10.3 Doctor cabinet — расширить useLiveEvents

Сейчас фильтрует `clinicId`. Добавить **server-side doctor scope** (см. §6.2) + расширить invalidation map новыми топиками (`visit-note.draftSaved`, `prescription.created`, `doctor.scheduleChanged`, etc.).

### 10.4 CRM — расширить invalidation map

Добавить обработку новых топиков (`visit-note.draftSaved`, `notification.delivered`, `notification.read`, `doctor.scheduleChanged`, etc.) в `src/hooks/use-event-query-invalidator.ts`.

### 10.5 Conflict UI на VisitNote

В компоненте `notes-editor-panel.tsx` (reception): при получении 409 от PATCH —

```
⚠ Конфликт редактирования
Другой пользователь сохранил изменения в этом визите (Иванов И.И., 2 сек назад).
[Перезагрузить и потерять мои правки]   [Скопировать мои в буфер]
```

### 10.6 Optimistic UI guard для медленных сетей

EventSource даёт <1с latency в норме, но patient на 2G может ждать дольше. Все мутации в mini-app продолжают использовать react-query `optimisticUpdate` — событие лишь подтверждает то, что мы уже отрисовали. На "пришло чужое событие" (другой member семьи изменил) — invalidate без оптимистического превью.

---

## 11. Безопасность

### 11.1 TOTP enforcement — see §9.3

### 11.2 SSE auth

- `/api/events` + `/api/events?scope=doctor` — session-cookie + CSRF (уже есть).
- `/api/miniapp/events` — `x-telegram-init-data` header (HMAC vs `clinic.tgBotToken`), идентично остальным miniapp роутам. SSE не имеет body, поэтому init-data передаётся через query или header; решение: header `x-telegram-init-data` на EventSource не поддерживается → передаём через query `?initData=<urlencoded>` + дополнительный nonce-проверка против replay (timestamp window ±5 минут).

### 11.3 Server-side scope enforcement — see §6.2

Mini-app **не может** подписаться на чужие события. Doctor **не может** подписаться на события другого доктора (server-side filter).

### 11.4 PII в payload

Payload минимизирован (см. §4.3). Полные ФИО, диагнозы, prescriptions **не в payload**, только id'ы и discriminator-поля. Это снижает риск утечки через SSE (e.g. через нестандартные прокси/логи).

### 11.5 Rate-limit SSE

`/api/miniapp/events` — лимит 1 active subscription per `(patientId, deviceId)`. Старая подписка → закрывается на сервере. Защита от mass-connection-flood с одного устройства.

### 11.6 Audit traceability

После завершения внедрения каждая запись `AuditLog` имеет:
- `eventId` → ссылка на исходное событие
- `surface` → откуда (CRM / MINIAPP / DOCTOR_CABINET / SMS_WEBHOOK / …)
- `correlationId` → цепочка причин-следствий

Compliance-запросы "покажите всё что повлияло на пациента X в день Y" → `WHERE correlationId IN (SELECT correlationId FROM AuditLog WHERE patientId=X AND date=Y)` → полная карта каскада.

---

## 12. Фазы внедрения

Каждая фаза **самодостаточна**, деплоится отдельно, не ломает предыдущее состояние.

### Phase A — Foundation (1-2 недели)

- Создать `EventOutbox` + миграцию
- Реализовать `publishViaOutbox()` helper
- Запустить `OutboxPumper` worker
- Помигрировать `confirmAppointment()` на outbox-путь (как pilot)
- Добавить `Last-Event-ID` replay в `/api/events`
- Тесты: outbox at-least-once + replay
- **Не катит на прод существующие потоки** — все остальные мутации продолжают использовать `publishEventSafe` напрямую (dual-write безопасен, EventBus принимает оба пути).

**Acceptance:** при выключении Redis на 10 секунд и его последующем включении, события за период не теряются (replay из outbox по cursor).

### Phase B — Envelope v2 + Domain functions (2 недели)

- Расширить `EventEnvelope` (actor, surface, tenantScope) — backwards-compat через optional fields
- Реализовать shared `bookAppointment`, `rescheduleAppointment`, `cancelAppointment`, `completeVisit`
- Помигрировать `POST /api/miniapp/appointments`, `PATCH /api/crm/appointments/[id]`, `DELETE /api/miniapp/appointments/[id]`, `POST /api/crm/visit-notes/[id]/finalize` на shared functions
- Закрыть **референц-парность** — `bookAppointment` для CRM auto-applies pending rewards
- Tests: contract-tests на envelope schema; integration tests на shared functions

**Acceptance:** все 4 потока создания/изменения appointment проходят через shared functions; парность миниапп/CRM с auto-apply rewards — есть.

### Phase C — SSE scoping + Mini-app subscription (1-2 недели)

- Реализовать `/api/miniapp/events` с patient-scope + family expansion
- Реализовать `/api/events?scope=doctor` с doctor-scope
- Hook `usePatientEvents` + invalidation map для mini-app
- Подключить hook в `src/app/c/[slug]/my/layout.tsx`
- Tests: e2e — пациент букает → ресепшн подтверждает → пациент видит CONFIRMED badge в <1с без рефреша

**Acceptance:** все потоки из §7 работают end-to-end. Manual QA-сценарии "три браузера одновременно" — все три синхронны.

### Phase D — Doctor cabinet unfreeze prerequisites (1 неделя)

- Снять 3 мока с `/doctor/visits/[id]` + 1 с `/doctor/patients`
- TOTP gate в `createApiHandler` + `createApiListHandler` + `createMiniAppHandler`
- Audit на `find-or-create` conversation (через shared `findOrCreateConversation` + outbox)
- VisitNote optimistic concurrency (version + If-Match)
- Tests: doctor без TOTP в `require2faForAll=true` клинике получает 403 на API
- **Поднять gate в `src/app/[locale]/doctor/layout.tsx`** (убрать redirect на /crm) — отдельным коммитом, после прохождения internal QA

**Acceptance:** unpause-checklist из `_ROADMAP.md` закрыт, доктор-кабинет работает на проде.

### Phase E — Delivery telemetry + Schedule fan-out (1 неделя)

- ~~`/api/sms/dlr` endpoint~~ — RETIRED Q2 2026 (см. `TZ-sms-removal.md`); DLR теперь только TG-канал
- `notification.delivered` / `notification.read` события
- `doctor.scheduleChanged`, `doctor.timeOffCreated/Removed`, `cabinet.changed`, `service.priceChanged` события
- `prescription.created/paused/resumed/cancelled` события + новый `POST /api/crm/doctors/me/prescriptions` роут
- Mini-app slot picker реагирует на schedule events

**Acceptance:** delivery badges в CRM `/notifications` показывают realtime статус; пациент в процессе бронирования видит обновлённые слоты при изменении расписания доктора.

### Phase F — Audit unification + Legacy cleanup (1 неделя)

- Outbox pumper пишет в `AuditLog` для `auditable:true` событий
- Помечаем `audit()` helper как deprecated; миграция оставшихся прямых вызовов
- Удаляем legacy `publishEventSafe` callsites (все через outbox)
- Удаляем `_mocks.ts`, `_active-mocks.ts` файлы
- Cleanup: 66 hardcoded RU-строк в doctor cabinet → i18n (не блокер, но в этой фазе зачищаем)

**Acceptance:** один источник аудит-истины; нет дублирующих publish-путей; `git grep MOCK_` в `src/app/[locale]/doctor/` пусто.

### Phase G — Operational hardening (1 неделя)

- Outbox monitoring + алерт в action-center при PENDING > 10000 или возрасте > 60 секунд
- Outbox TTL cleanup job (delete DELIVERED rows старше 30 дней)
- Backpressure тест: 10к событий в секунду → pumper держит
- Reconnect-storm тест: 1000 EventSource переподключений одновременно → SSE сервер не падает
- Документация: обновить `docs/realtime.md` под новую модель

**Acceptance:** load-test pass + operational runbook готов.

**Итого:** 8-10 недель на полное внедрение. Поверхности продолжают работать на каждой фазе.

---

## 13. Тесты

### 13.1 Unit

- `publishViaOutbox` контракт: envelope формируется, tx коммит, eventId возвращён
- `OutboxPumper`: PENDING → DELIVERED при успехе, retry с backoff при failure, DEAD после maxAttempts
- `shouldDeliver` SSE filter: правильная фильтрация по scope (clinic/doctor/patient + family)
- `createApiHandler` TOTP gate: blocked при `requiresTotpEnrollment && !session.totpEnrolled`

### 13.2 Integration

- `bookAppointment` end-to-end: tx-консистентность (Appointment + AppointmentService + ReferralReward + EventOutbox созданы атомарно)
- Cascade: `confirmAppointment` → `appointment.confirmed` → `closeOpenConfirmActions` → `action.closed` событие (correlation chain)
- VisitNote concurrency: два параллельных PATCH → один проходит, второй получает 409 с current version

### 13.3 E2E

- "Three browsers" сценарий: CRM + doctor + mini-app у трёх разных user-агентов. Действие на одном — обновление на двух других в <1с.
- Reconnect: открыть mini-app, отключить wifi на 30с, в это время сделать в CRM action. Включить wifi — событие должно прийти из outbox replay.
- TOTP enforcement: попытка curl `/api/crm/patients` от DOCTOR без TOTP → 403.

### 13.4 Load

- 10к outbox-inserts/min → pumper делает DELIVERED в среднем за <500мс
- 1000 одновременных EventSource подключений к `/api/miniapp/events` (разные patientId) → CPU/memory остаются в норме

### 13.5 Migration safety

- Pre/post-migration smoke на каждой фазе:
  - Сейчас существующие CRM-страницы продолжают работать
  - Сейчас существующие mini-app роуты продолжают работать
  - Doctor cabinet remains frozen (или unfreezed после Phase D)

---

## 14. Open questions (требуют решения до Phase A)

1. **Outbox retention** — 30 дней предложено. Compliance-требования по аудиту → 5 лет. Стратегия: outbox 30 дней для replay, AuditLog 5 лет (отдельный архив). Согласовать с legal.
2. **Telegram initData для SSE** — HMAC в query string небезопасно (логи прокси). Альтернатива: при первом обращении к `/api/miniapp/events` сервер возвращает short-lived JWT (5 минут) → клиент использует JWT для последующих `/api/miniapp/events` запросов. Чуть сложнее, но безопаснее.
3. **Cross-doctor visit visibility** — карта показала "любой доктор клиники видит ВСЕ labs пациента если у пациента есть ≥1 аппойнтмент с этим доктором". По спеку специально, но стоит зафиксировать в TZ и сделать configurable per-clinic.
4. **VisitNote.draftSaved частота** — autosave на каждое нажатие клавиши + debounce 1.5с может дать 10-30 событий за визит. OK для нескольких докторов одновременно, но при 50 докторах одновременно (большая клиника) — 500-1500 SSE-frames в минуту на одну `/api/events` подписку. Решение: на сервере coalesce draftSaved события (если за 5 секунд для одного visitNoteId пришло несколько — отправить только последнее). Coalescing logic в pumper.
5. **Outbox для legacy paths** — миграция всех publish-callsites одномоментно невозможна. Compatibility shim: `publishEventSafe()` оборачиваем, чтобы он ВСЕГДА писал в outbox (даже если caller не передал v2-поля; дополняем defaults). Это снимает требование переписать всё перед Phase A.
6. **Mini-app session lifetime** — Telegram WebApp может жить часами в фоне; EventSource — час-два до reconnect от Telegram WebView. Стоит ли при wake-up делать full refetch или довериться replay? Решение: при `visibilitychange` → invalidate all queries + reopen SSE с last cursor → replay покрывает gap.
7. ~~**DLR webhook auth** — SMS-провайдеры (Eskiz, Playmobile) шлют DLR без аутентификации.~~ — MOOT после `TZ-sms-removal.md` Q2 2026: SMS-канал удалён, DLR только от TG (с TG webhook secret).
8. **Doctor SSE scope в командных приёмах** — если приём ведут два доктора (психотерапевт + психиатр на консилиуме) — оба должны видеть события друг друга? Сейчас scope строго `doctorId === sub.doctorId`. Возможное расширение: `doctorId IN session.consultantDoctorIds`. Открытый вопрос для UX.

---

## 15. Метрики успеха (после Phase G)

- **Latency p50/p99** действия → видимости на другой поверхности: p50 < 500мс, p99 < 2с (включая network).
- **Outbox lag** (от insert до DELIVERED): p50 < 200мс, p99 < 1с.
- **Event loss rate** (insert без DELIVERED через 60с): < 0.01% (с retry); DEAD events: < 0.001% (требуют ручного разбора).
- **TOTP coverage**: 100% `/api/crm/**` роутов проходят `requiresTotpEnrollment` гейт в `require2faForAll=true` клиниках.
- **Audit completeness**: 100% мутаций критичных доменов (`Appointment`, `VisitNote`, `Prescription`, `PatientFamily`, `Conversation`) имеют запись в `AuditLog` с `actor.surface` заполненным.
- **Mock-residue**: `git grep "MOCK_" src/app/[locale]/doctor/` → пустой результат.
- **SSE uptime для патиентов**: ≥99% времени активной mini-app сессии патиент имеет открытый SSE → измеряется client-side ping.

---

## 16. Связь с существующими ТЗ и roadmap'ами

- **`docs/TZ.md §4.6 Realtime`** — этот ТЗ заменяет/расширяет. Обновить ссылки.
- **`docs/TZ.md §8.8 Notifications`** — добавить delivery telemetry (см. §7.8).
- **`src/app/[locale]/doctor/_ROADMAP.md` § Unpause readiness** — закрывается Phase D.
- **CRM audit closeout (2026-05-30)** — Phase F закрывает P0-2 (audit holes), P1-12 расширяется (impersonation guard через outbox audit).

---

**Конец Draft 2026-06-01.** Следующий шаг: sign-off на 14 open questions → старт Phase A.
