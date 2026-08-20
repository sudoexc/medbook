# Очередь MedBook — модель «две полосы», как реализовано

> Документ описывает реализацию по состоянию кода на 2026-08-20.
> Спека-первоисточник: `docs/TZ-two-lanes.md` (Approved 2026-07-03, заменила
> serveAt-EDF-модель). Здесь — то, что реально в коде.
> Ядро: `src/lib/queue-ordering.ts`, `src/server/appointments/queue-projection.ts`.
> Инварианты закреплены тестами `tests/unit/queue-ordering.test.ts`,
> `tests/unit/doctor-current-visit.test.ts`, `tests/unit/reorder-queue-signal.test.ts`.

## Оглавление

1. [Модель двух полос](#1-модель-двух-полос)
2. [Порядок живой очереди: compareQueue](#2-порядок-живой-очереди-comparequeue)
3. [Талоны: queueOrder, ticketSeq, ticketNumber, ticketCode](#3-талоны-queueorder-ticketseq-ticketnumber-ticketcode)
4. [Статусы приёма и переходы](#4-статусы-приёма-и-переходы)
5. [Правило «один приём за раз»](#5-правило-один-приём-за-раз)
6. [«Текущий пациент» врача: pickCurrentVisit](#6-текущий-пациент-врача-pickcurrentvisit)
7. [Статусы в расписании врача: scheduleStatusOf](#7-статусы-в-расписании-врача-schedulestatusof)
8. [Поверхности: где очередь показывается](#8-поверхности-где-очередь-показывается)

---

## 1. Модель двух полос

Все визиты — строки одной таблицы `Appointment`, но живут они на двух
**полностью независимых** полосах. Дискриминатор — `Appointment.channel`
(enum `ChannelType`: `WALKIN | PHONE | TELEGRAM | WEBSITE | KIOSK`,
`prisma/schema.prisma:80`):

```ts
// src/lib/queue-ordering.ts:42
export function isLiveLane(a: Pick<QueueOrderable, "channel">): boolean {
  return a.channel === "WALKIN";
}
```

| | SCHEDULE lane (записи) | LIVE lane (живая очередь) |
|---|---|---|
| `channel` | `PHONE / TELEGRAM / WEBSITE / KIOSK` | только `WALKIN` |
| Ось порядка | время слота (`date`/`time`) | безвременной FIFO: `(queuePriority, queuedAt, ticketSeq)` |
| Создание | `bookAppointment` (`server/appointments/book.ts`) — слот, проверка пересечений | `registerWalkin` (`server/appointments/walkin.ts`) — без слота и без конфликт-чека, сразу `WAITING` в хвост |
| `date` строки | реальное время слота | техническое поле («сейчас» на момент регистрации) — **на порядок не влияет** |
| Позиция/ETA в очереди | нет никогда | да (`queue-projection`) |

```
   SCHEDULE lane (ось времени)            LIVE lane (ось прибытия)
   09:00  Иванов   BOOKED                 #A-001  Каримов   WAITING (пришёл 08:40)
   09:20  Петров   CONFIRMED              #A-002  Юсупов    WAITING (пришёл 08:55)
   13:00  Сидоров  WAITING («пришёл»)     #A-003  Ахмедов   WAITING (срочно, приоритет)
          ▲                                        ▲
          │ живут рядом, но НИКОГДА не интерливятся │
          └────────── врач выбирает сам ────────────┘
```

**Ключевой инвариант (I1/I2 из ТЗ, закреплён тестами):** запись на 13:00 и
живой пациент, пришедший в 13:00, друг с другом не взаимодействуют. Бронь
никогда не «всплывает» в очереди, когда подошло её время; walk-in никогда не
блокирует слот. Пришедшая по записи («Пришёл» / киоск-чекин) строка получает
`queueStatus=WAITING` и талон-идентификатор, но это **arrived-состояние внутри
schedule lane**: в `waiting`-список живой очереди она не попадает ни на одной
поверхности — фильтр `a.queueStatus === "WAITING" && isLiveLane(a)` в
`queue-projection.ts:121`.

Разводка по полосам в одном месте:

- `splitLanes(rows)` (`queue-ordering.ts:76`) — общий сплит: `live`
  отсортирован `compareQueue`, `schedule` — в порядке вызывающего.
- `splitReceptionLanes(rows)` (`queue-ordering.ts:131`) — экранный сплит
  ресепшна: `live` = только `WAITING`-walk-in'ы (FIFO), `booked` = записи в
  статусах `BOOKED/CONFIRMED/WAITING` по времени слота (`bySlotTime`).
- Единственное место, где полосы «встречаются» — `current` (кто на приёме):
  он lane-agnostic, врач мог взять и walk-in, и запись (I3;
  `queue-projection.ts:124`).

## 2. Порядок живой очереди: compareQueue

Один-единственный компаратор, общий для сервера и всех клиентских сортировок
(`queue-ordering.ts:61`):

```ts
export function compareQueue(a: QueueOrderable, b: QueueOrderable): number {
  if (a.queuePriority !== b.queuePriority) return b.queuePriority - a.queuePriority; // 1
  const sa = queuedMs(a); const sb = queuedMs(b);
  if (sa !== sb) return sa - sb;                                                     // 2
  const ta = a.ticketSeq ?? a.queueOrder ?? Number.MAX_SAFE_INTEGER;
  const tb = b.ticketSeq ?? b.queueOrder ?? Number.MAX_SAFE_INTEGER;
  return ta - tb;                                                                    // 3
}
```

Точная последовательность ключей:

1. **`queuePriority` DESC** — единственный ручной оверрайд («срочно» с
   ресепшна; пишется через PATCH `/api/crm/appointments/[id]`, поле
   `queuePriority: int 0..100` в `server/schemas/appointment.ts:72`). Бамп
   перекрывает более раннее прибытие.
2. **`queuedAt` ASC** — FIFO-якорь: момент входа строки в WAITING.
   `queuedMs()` фолбэчит на `date` только для legacy-строк, где `queuedAt`
   ещё не проставлялся.
3. **`ticketSeq` ASC** — неизменяемый тай-брейк: две строки с одинаковым
   `queuedAt` никогда не меняются местами между рендерами (фолбэк
   `ticketSeq ?? queueOrder ?? MAX_SAFE_INTEGER` — строки без номера в хвост).

**Почему время слота НЕ участвует:** это ядро two-lanes. Старая модель
(`serveAtMs = max(slot, queuedAt)` для броней) вмешивала записи в живую
очередь, из-за чего пациент, «забронированный на 13:00», вклинивался перед
живыми. Отменена ТЗ (`docs/TZ-two-lanes.md` §0); тест
`"orders strictly by arrival, not by slot time (I1)"` фиксирует: walk-in со
слот-датой «через 6 часов», но пришедший первым, обслуживается первым.

**Ручной reorder** (`/api/crm/appointments/reorder`, drag-and-drop на
ресепшне, роли ADMIN/RECEPTIONIST): переставляет НЕ `queueOrder`, а
переписывает **FIFO-якоря `queuedAt`** с шагом 1 с (`STEP_MS = 1000`) от
самого раннего прибытия в наборе — чтобы `compareQueue` воспроизвёл ровно
заданный порядок на всех поверхностях, а номера талонов не «поехали». Строка
не-live-полосы в наборе → `422 not_live_lane` (клиент со stale-данными обязан
перезагрузить полосы).

Серверная проекция `getQueueProjection` (`server/appointments/queue-projection.ts`)
считает очередь ОДИН раз на (клинику, набор врачей) и отдаёт всем поверхностям
одинаково: `waiting` (только live lane, сортировка `compareQueue`,
1-based `position`), `current` (любая полоса, `queueStatus=IN_PROGRESS`),
`etaMinutes = perVisitMin × (idx + (current ? 1 : 0))`, где `perVisitMin` —
исторический медианный тайминг врача (`predictPerVisitMinutes`) с фолбэком на
длительность первого ожидающего. До этого модуля ТВ, киоск и талон считали
очередь тремя разными формулами и расходились.

## 3. Талоны: queueOrder, ticketSeq, ticketNumber, ticketCode

Четыре разных сущности, их путают — поэтому таблица:

| Поле | Что это | Кто выдаёт | Меняется? |
|---|---|---|---|
| `queueOrder` | 1-based счётчик на (врач × Ташкентский день) | `allocateQueueOrder` (`server/appointments/queue-order.ts:33`) | выдаётся один раз; НЕ пересчитывается при reorder |
| `ticketSeq` | копия `queueOrder` в момент выдачи — источник номера талона | walk-in: при создании (`walkin.ts:160`); запись: при первом «Пришёл» (`intake.ts:73`) | **никогда** (заморожен) |
| `ticketNumber` | отображаемый номер `X-NNN` | `ticketNumberFor(doctorId, seq)` (`server/services/ticket-number.ts`) — первая буква `doctorId` в верхнем регистре + `padStart(3,"0")`, например `A-042` | производное от ticketSeq; `null`, если seq нет |
| `ticketCode` | человекочитаемый код бумажного талона/QR, 6 симв. | `generateTicketCode` (`server/appointments/ticket-code.ts`) — Crockford-подобный base32 (30 симв., без `0/1/I/L/O/U`), уникальный на всю таблицу | никогда; вход в `/t/[code]` |

Как выдаётся `ticketSeq`:

- **Walk-in** (`registerWalkin`): `queueOrder`/`ticketSeq`/`queuedAt` пишутся
  атомарно при создании строки под **Serializable**-транзакцией
  (`runQueueTx`, `queue-order.ts:55`) с ретраем write-conflict (P2034/40001,
  3 попытки) — два одновременных walk-in'а к одному врачу не получат один
  номер. Счётчик — `max(queueOrder)+1` по статусам
  `QUEUE_OCCUPYING_STATUSES = WAITING | IN_PROGRESS | COMPLETED` за Ташкентский
  день (`tashkentDayBounds`): COMPLETED остаётся в счёте, чтобы номер
  завершённого визита не выдали заново.
- **Запись при «Пришёл»** — общий хелпер `applyWaitingIntake`
  (`server/appointments/intake.ts:50`), вызываемый из трёх маршрутов, флипающих
  в WAITING (queue-status PATCH, общий PATCH, bulk-status; bulk передаёт
  `presetOrder` — преаллоцированный блок номеров, одна агрегация на врача).
  Правила интейка:
  - `queueOrder == null` → выдать номер и заморозить `ticketSeq` (один раз);
  - `queuedAt` штампуется при первом прибытии ИЛИ при возврате из `SKIPPED`
    (пациент вернулся — встаёт в конец FIFO), но **сохраняется** при
    откате `IN_PROGRESS → WAITING` (пациент не теряет место);
  - при откате из `IN_PROGRESS` чистится `startedAt` (иначе «идёт приём N мин»
    посчитается от первого старта).

**Почему `ticketSeq` неизменяемый:** талон уже напечатан и в руках пациента
(I5 ТЗ: «тикеты — идентификаторы, не позиции»). Reorder двигает `queuedAt`,
SKIPPED-возврат двигает `queuedAt` — номер на бумаге при этом не должен
«переехать» на другого человека. Позиция в очереди — производная
(`position` из проекции), номер — идентификатор.

Особый случай: запись, которую врач начал БЕЗ чек-ина (`BOOKED → IN_PROGRESS`
напрямую), не проходила интейк и не имеет seq — `ticketNumberFor` возвращает
`null`, UI показывает «без талона» (раньше `?? 0` печатал фейковый `X-000`).

## 4. Статусы приёма и переходы

Единый источник — `src/lib/appointment-transitions.ts`. Им пользуются и UI
(bulk-бар, дропдаун в drawer, кнопки), и серверные гварды
(`/api/crm/appointments/[id]`, `[id]/queue-status`, `bulk-status`).

Разрешённые **прямые** переходы (`TRANSITIONS`, строка 31; no-op `from === to`
всегда разрешён; `COMPLETED/CANCELLED/NO_SHOW` — терминальные):

| Из \ В | BOOKED | CONFIRMED | WAITING | IN_PROGRESS | COMPLETED | SKIPPED | CANCELLED | NO_SHOW |
|---|---|---|---|---|---|---|---|---|
| **BOOKED** | · | ✔ | ✔ | ✔ | — | — | ✔ | ✔ |
| **CONFIRMED** | ✔ | · | ✔ | ✔ | — | — | ✔ | ✔ |
| **WAITING** | ✔ | — | · | ✔ | — | ✔ | ✔ | ✔ |
| **IN_PROGRESS** | — | — | ✔ | · | ✔ | — | ✔ | — |
| **SKIPPED** | — | — | ✔ | ✔ | — | · | ✔ | ✔ |
| **COMPLETED / CANCELLED / NO_SHOW** | — | — | — | — | — | — | — | — |

Нюансы:

- `CONFIRMED → BOOKED` — «отмена подтверждения» сделана прямым переходом,
  чтобы фэт-фингер не требовал revert-механики.
- `canTransitionAt` (строка 57) — времязависимое расширение: `NO_SHOW`
  разрешён только после наступления времени слота (+`graceMinutes`), до того —
  `too_early_for_no_show`.
- Роли: поверх матрицы действует `canRoleAdvanceTo` (`lib/appointments/lifecycle.ts`)
  — врач двигает `IN_PROGRESS/COMPLETED`, ресепшн — остальное; NURSE read-only
  (проверяется в `queue-status/route.ts:66`).
- `status` и `queueStatus` — две колонки, которые queue-роут синхронизирует
  принудительно (`data = { queueStatus: X, status: X }`): ресепшн читает
  `queueStatus`, кабинет врача — `status`.

**Revert-переходы** — отдельная карта `REVERTS` (строка 99), доступна ТОЛЬКО
врачу через `PATCH /api/crm/appointments/[id]?revert=true` (проверка роли и
владения строкой в роуте, строки ~150–260). Семантика — «где пациент был
непосредственно до»:

| Текущий статус | Revert-цель | Побочные эффекты |
|---|---|---|
| `IN_PROGRESS` | `WAITING` | `startedAt = null` (см. интейк) |
| `COMPLETED` | `IN_PROGRESS` | `completedAt = null`, визит снова «живой» |
| `SKIPPED` | `WAITING` | — |
| `NO_SHOW` | `BOOKED` | опоздавший всё-таки пришёл — слот реактивируется |
| `CANCELLED` | `BOOKED` | `cancelledAt/cancelReason = null`, репрайс сиблингов кейса |

Кто пользуется: кабинет врача — «отменить мисклик» («Завершить» не туда,
NO_SHOW при опоздавшем). Каждый revert аудируется
(`AUDIT_ACTION.APPOINTMENT_STATUS_REVERTED`) и эмитит `statusChanged` через
outbox.

## 5. Правило «один приём за раз»

У врача может быть максимум одна строка `status = IN_PROGRESS`.
Гвард — `findOtherActiveVisit` (`src/server/appointments/active-visit.ts:12`):

```ts
// есть ли у ЭТОГО врача другой IN_PROGRESS (клиника+врач, excludeAppointmentId)?
// scope — doctorId, не клиника: ресепшн, стартующий визиты РАЗНЫМ врачам, — ок.
```

Где проверяется (все четыре входа в `IN_PROGRESS`):

| Путь | Файл:строка |
|---|---|
| Ресепшн/врач: `queueStatus → IN_PROGRESS` | `/api/crm/appointments/[id]/queue-status/route.ts:116` |
| Врач: revert `COMPLETED → IN_PROGRESS` | `/api/crm/appointments/[id]/route.ts:185` |
| Врач: `?call=true` («Вызвать» = сразу старт) | `/api/crm/appointments/[id]/route.ts:305` |
| Общий PATCH: `status → IN_PROGRESS` | `/api/crm/appointments/[id]/route.ts:468` |

При попытке начать второй приём сервер отвечает **409**:

```json
{ "error": "another_visit_in_progress",
  "activeAppointmentId": "…", "activePatientName": "Каримов К.К." }
```

UI кабинета врача превращает это в switch-confirm-диалог («завершить текущий и
начать нового?») — принудительного автозавершения на сервере нет, решение всегда
за врачом.

Важная семантика `?call=true`: «Вызвать» == «Начать приём» — один клик ставит
`calledAt + startedAt + status/queueStatus = IN_PROGRESS`, шлёт пациенту TG
«Вас вызывают, кабинет N» и эфемерный `queue.called` на табло. Именно поэтому
вызов подчиняется single-active-гварду (комментарий в роуте, строки 301–304).

## 6. «Текущий пациент» врача: pickCurrentVisit

Кто занимает hero-карточку «Текущий пациент» в кабинете врача — чистая функция
`pickCurrentVisit` (`src/lib/doctor-current-visit.ts:37`), используется в
`/api/crm/doctors/me/today/route.ts:494`. Приоритет:

1. **Идущий приём** — первая строка `status === "IN_PROGRESS"`, из ЛЮБОЙ
   полосы. Всегда побеждает.
2. **Вызванный** — `status === "WAITING" && calledAt !== null`: врач нажал
   «Вызвать», пациент идёт к кабинету (CTA «Начать приём»). Просто ждущий
   WAITING сюда НЕ попадает — он принадлежит очереди/расписанию.
3. **Ближайшая запись** (courtesy-фолбэк) — booked-lane only
   (`isLiveLane === false`), статус `BOOKED | CONFIRMED`, старт в окне
   `IMMINENT_WINDOW_MS = 15 минут`. Помечается `isImplicitNext: true` —
   карточка подписывает себя «Следующая запись», а не изображает, что кто-то
   на столе.
4. Иначе — `null` (карточки нет).

**Какой баг это исправило** (шапка файла + тест C1 в
`tests/unit/doctor-current-visit.test.ts`): наивная версия —
`appts.find(a => a.status === "IN_PROGRESS" || a.status === "WAITING")` по
списку, отсортированному `date ASC`. Walk-in'ы получают `date = now` при
регистрации, поэтому в клинике с живой очередью более «ранний» ждущий walk-in
**затенял идущий приём**: hero-карточка показывала ждущего с кнопкой
«Начать приём», и её нажатие форс-завершало реальный визит через
switch-confirm. Стреляло ежедневно. Отсюда же ограничение шага 3 —
walk-in не может стать «imminent» (у него нет осмысленного «начнётся в»),
иначе баг вернулся бы через чёрный ход.

## 7. Статусы в расписании врача: scheduleStatusOf

`src/lib/doctor-schedule-status.ts` — единый маппер `Appointment.status` →
UI-enum кабинета врача (`/api/crm/doctors/me/today` и `…/me/schedule`, чтобы
не дрейфовали):

| `Appointment.status` | `DoctorScheduleStatus` |
|---|---|
| `IN_PROGRESS` | `in_progress` |
| `WAITING` | **`upcoming`** (не `in_progress`!) |
| `BOOKED`, `CONFIRMED` | `upcoming` |
| `COMPLETED`, `SKIPPED` | `done` |
| `NO_SHOW` | `no_show` |
| `CANCELLED` | `cancelled` |

Два места, где это уже стреляло (комментарии в файле — пост-фактум фиксы):

- **WAITING ≠ «идёт приём».** WAITING — «пациент пришёл и стоит в очереди»,
  а не «на приёме». Когда WAITING рендерился как `in_progress`, строка
  предлагала «Завершить», сервер это отбивал (`WAITING → COMPLETED` запрещён
  матрицей §4), а вся очередь выглядела как куча одновременных приёмов —
  визуально ломая правило «один приём за раз». Теперь WAITING падает в
  `upcoming` и предлагает «Начать» (гейтится single-active-гвардом §5).
- **NO_SHOW ≠ done.** Исторически NO_SHOW попадал в `done` вместе с
  COMPLETED — неявка выглядела как завершённый визит в агенде.

## 8. Поверхности: где очередь показывается

Все читают одну проекцию `getQueueProjection` (§2) либо её REST-обёртки; live —
через SSE-поки + поллинг-страховку (детали транспорта — `REALTIME.md`).

| Поверхность | Страница | Данные | Примечание |
|---|---|---|---|
| ТВ-табло клиники | `src/app/tv/page.tsx` | `GET /api/c/[slug]/queue/board` + SSE `/api/c/[slug]/queue/events` (`use-queue-board.ts`) | без auth (slug = bearer), ФИО → инициалы; гонг/оверлей по `queue.called` |
| Персональное ТВ врача | `src/app/tv/d/[token]/page.tsx` | `GET /api/tv/d/[token]` (`use-doctor-board.ts`) + тот же публичный SSE | bearer — unguessable `Doctor.tvToken`; слева live-очередь, справа слоты дня (walk-in'ы из слотов исключены — иначе двойной счёт) |
| Киоск самообслуживания | `src/app/kiosk/page.tsx` | `/api/c/[slug]/queue/{lookup,checkin,walkin,doctors}` | чекин по записи ИЛИ walk-in с печатью талона |
| Печать талона | `src/app/ticket/[id]/page.tsx` | серверный рендер + `getQueueProjection` | авто-print, QR → `/q/[id]` |
| Статус талона у пациента | `src/app/q/[id]/page.tsx` (редирект с `/t/[code]`) | `GET /api/queue/status/[id]` + публичный SSE | отдаёт `lane: "live" \| "schedule"` — walk-in видит позицию/ETA, запись — время слота |
| Ресепшн CRM | `src/app/[locale]/crm/reception/page.tsx` | компоненты `_components/doctor-queue-{panel,card,list}.tsx`, `queue-column.tsx`, `reception-list-drawer.tsx` — все сортируют через `splitReceptionLanes`/`compareQueue` | drag-reorder → `/api/crm/appointments/reorder`; walk-in → `/api/crm/appointments/walkin` |
| Кабинет врача — мой день | `src/app/[locale]/doctor/my-day/page.tsx` | `GET /api/crm/doctors/me/today` (hero = `pickCurrentVisit`, статусы = `scheduleStatusOf`), `…/me/schedule` | очередь врача: `_hooks/use-doctor-queue.ts` (кабинет `doctor/reception`) |
| Кабинет врача — приём | `src/app/[locale]/doctor/reception/page.tsx` | `reception-context.tsx` + `use-doctor-queue.ts` | экран консультации: активный пациент + очередь |
| Mini App пациента | home-hero карточка очереди | `GET /api/queue/status/[id]` под ключом `["miniapp","queue",…]`, инвалидация по `queue.updated` | см. `use-miniapp-live-events.ts` |
