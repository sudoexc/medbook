# ТЗ — Прокачка раздела Telegram (CRM)

> Статус: в работе. Автор-исполнитель: Claude. Греинлайт: Javohir, 2026-06-18.
> Принцип: переиспользовать существующий движок (Campaign / NotificationSend /
> conversations / webhook), новые сущности добавлять только там, где их реально нет.
> Деплой — отдельной явной командой, не авто.

## Контекст и цель

Раздел `/crm/telegram` сегодня — это 3-колоночный инбокс (список диалогов · чат ·
правый рейл) + диалоги «Рассылка» и «Авто-сообщения». Оператор не видит сводной
картины: сколько пациентов в Telegram, сколько доступно для рассылки, сколько
заблокировало бота, сколько отписалось. Блокировки нигде не фиксируются — видны
только постфактум как `FAILED`-отправка (`403 bot was blocked by the user`).

Цель — превратить раздел из «переписки» в инструмент работы с TG-аудиторией:
обзорные метрики, честный учёт блокировок, история рассылок с воронкой доставки,
и pro-флоу в самих диалогах.

## Текущая фактура (verified 2026-06-18)

- `Patient`: `telegramId String?`, `telegramUsername String?`, `marketingOptOut Boolean`,
  `segment PatientSegment`, `tags String[]`, `preferredLang Lang`, `deletedAt DateTime?`.
  **Нет** `tgBlockedAt`, **нет** даты подключения TG. Индекс `[clinicId, telegramId]` есть.
- `Campaign` (schema ~2387): `body`, `segment Json`, `channel`, `status String`,
  `scheduledFor/startedAt/finishedAt`, `totalCount/sentCount/failedCount` (последние
  три не пишутся — прогресс считается живьём). Индексы `[clinicId,status,scheduledFor]`,
  `[clinicId,createdAt]`.
- `NotificationSend`: `campaignId?`, `status` ∈ QUEUED/SENT/DELIVERED/READ/FAILED/CANCELLED,
  `failedReason?`, `sentAt/deliveredAt/readAt`. Воронка доставки выводима отсюда.
- `GET /api/crm/campaigns` — список кампаний (курсор, фильтр по status) уже есть;
  UI истории кампаний — `/crm/notifications/campaigns`. Переиспользуем.
- Вебхук `POST /api/telegram/webhook/[clinicSlug]` обрабатывает `message` и
  `callback_query`. **`my_chat_member` НЕ обрабатывается** (даже в типе `TgUpdate` нет).
- `Conversation`: `assignedToId?`, `tags String[]`, `status`, `mode`, `unreadCount` — уже есть.
- Канн/быстрых ответов нет — отдельной сущности не существует.

## Изменения модели

1. **`Patient.tgBlockedAt DateTime?`** — момент, когда пациент заблокировал бота.
   `NULL` = не заблокирован. Снимается при разблокировке/`/start`. Индекс не нужен
   (счётчики идут вместе с `telegramId`-фильтром, который индексирован).
2. **`Patient.telegramLinkedAt DateTime?`** — момент привязки TG (для тренда
   «+N за 7 дней»). Ставится там же, где впервые проставляется `telegramId`
   (invite-consume + connect-flow), если ещё не стоял.
3. **`CannedResponse`** (Layer 4): `id, clinicId, title, body @db.Text, lang Lang,
   sortOrder Int, createdById?, createdAt, updatedAt`. Индекс `[clinicId, lang]`.

Миграции — ручные SQL-папки `prisma/migrations/<ts>_<kebab>/migration.sql`
(паттерн проекта), `prisma generate` офлайн.

---

## Layer 1 — Шапка-обзор

**API** `GET /api/crm/telegram/stats` (roles: ADMIN, RECEPTIONIST).
Один пакет `groupBy`/`count` по `Patient` (tenant-scoped), возвращает:

```ts
{
  totalInTelegram: number;   // deletedAt null && telegramId != null
  reachable:       number;   // + marketingOptOut=false && tgBlockedAt=null
  blocked:         number;   // tgBlockedAt != null (среди telegramId != null)
  optedOut:        number;   // marketingOptOut=true && telegramId != null
  newLast7d:       number;   // telegramLinkedAt >= now-7d
}
```

**UI** — полоска `TelegramStatsBar` над инбоксом в `telegram-page-client.tsx`
(только desktop ≥1280). 4 карточки (Всего · Доступны · Заблокировали · Отписались)
+ маленький бейдж «+N за неделю» на «Всего». Стиль — существующие `StatCard`
(как в `broadcast-preview.tsx`). Цвета токенами: всего=info, доступны=success,
заблокировали=destructive, отписались=warning. Хук `useTelegramStats()`
(TanStack, polling 60s, инвалидация на событиях инбокса).

**Acceptance:** цифры сходятся с ручным `count` в БД; пустая клиника → все нули
без падений; раздел работает и при `blocked`-поле = 0 (до Layer 2 — просто ноль).

## Layer 2 — Учёт блокировок

**Сигнал от Telegram.** В вебхук добавить ветку `update.my_chat_member`:
- тип `TgChatMemberUpdated { chat, from, date, old_chat_member, new_chat_member }`;
- интересует приватный чат: `new_chat_member.status` ∈ {`kicked`, `member`, `left`};
- найти пациента по `telegramId = from.id` в рамках клиники (SYSTEM-ctx, явный clinicId);
- `kicked`/`left` → `tgBlockedAt = now` (если ещё не стоит); `member` → `tgBlockedAt = null`;
- best-effort: ошибки не валят 200-ответ Telegram.

**Фоллбэк по фейлу отправки.** В `notifications-send.ts`, в `catch` TG-ветки:
если текст ошибки содержит `bot was blocked` / `user is deactivated` / `chat not found`
→ выставить `Patient.tgBlockedAt = now` (по `send.patientId`). Это ловит блокировки
для пациентов, по которым `my_chat_member` не пришёл (старые блокировки).

**Аудитория рассрылки.** В `audience.ts`:
- добавить `tgBlockedAt` в выборку кандидатов;
- в `filterEligible` — заблокированных не класть в `audience`, считать в новый
  `breakdown.blocked`;
- `AudienceChannelBreakdown` + тип расширить полем `blocked: number`;
- превью рассылки (`broadcast-preview.tsx`) показывает «Заблокировали: N»
  отдельной 4-й карточкой (раньше было 3).

**Инбокс.** В шапке чата (`chat-pane`/right-rail) — компактный бейдж «Заблокировал бота»,
если у привязанного пациента `tgBlockedAt != null`. (Только индикатор, не блокирует UI.)

**Acceptance:** заблокировал бота в TG → в течение секунд `tgBlockedAt` стоит,
счётчик в шапке +1, пациент исчез из «доступных» и попал в «заблокировали» в превью
рассылки; `/start` снова → поле снято, пациент вернулся в доступные.

## Layer 3 — История рассылок

**API.** `GET /api/crm/campaigns/broadcasts` (roles: ADMIN, RECEPTIONIST) —
список именно рассылок (`body != null`), новые сверху, с агрегатом доставки одним
`groupBy(campaignId,status)` (без N+1):

```ts
{ items: Array<{
    id, name, body, segment, scheduledFor, startedAt, createdAt,
    createdByName, status,                 // derived: scheduled|sending|done
    funnel: { queued, sent, delivered, read, failed, blocked, total }
}> }
```

`blocked` в воронке = `FAILED`-строки с `failedReason ~ blocked` (или join на
`Patient.tgBlockedAt` — решить на импле; проще по `failedReason`).

**Отмена отложенной.** `POST /api/crm/campaigns/[id]/cancel` (ADMIN):
для рассылки в статусе scheduled — `Campaign.status='CANCELLED'` + её будущие
`NotificationSend(status=QUEUED, scheduledFor>now)` → `CANCELLED`. Идемпотентно.

**UI.** В шапке списка TG-раздела рядом с «Рассылка» — кнопка «История»
(или вкладка). Открывает drawer/диалог `BroadcastHistory`:
- строки: текст (обрезка) · аудитория (читаемо: «Все» / сегменты / теги) ·
  когда · кто · статус-бейдж · мини-воронка (sent/delivered/read/failed/blocked);
- действия: «Повторить» (открыть композер с предзаполненным текстом+сегментом),
  «Отменить» (для запланированных);
- запланированные показаны сверху с временем отправки.

**Acceptance:** после рассылки она появляется в истории с верной воронкой;
запланированную можно отменить (исчезает из очереди, статус CANCELLED);
«Повторить» открывает композер с тем же текстом и аудиторией.

## Layer 4 — Pro-флоу в диалогах

Опираемся на уже существующие поля (`Conversation.assignedToId`, `Conversation.tags`),
добавляем только канны.

1. **Быстрые ответы (канны).** Модель `CannedResponse` + CRUD
   `GET/POST /api/crm/canned-responses`, `PATCH/DELETE /[id]` (ADMIN правит,
   все операторы читают). В композере чата — кнопка-пикер (⚡) со списком по
   текущему языку пациента; вставка в textarea с подстановкой плейсхолдеров
   `{{patient.firstName}}` и т.п. (используем существующий клиентский `fillPreview`).
2. **Назначение оператора.** В шапке чата — селект «Ответственный» (список
   операторов клиники), пишет `Conversation.assignedToId`; фильтр в списке
   «Мои / Все». Эндпойнт `PATCH /api/crm/conversations/[id]` (assignedToId).
3. **Теги диалога.** В правом рейле — редактор тегов (`Conversation.tags`),
   тот же `PATCH`. Фильтр по тегу в списке (по желанию).
4. **Воронка доставки** broadcast — закрыта в Layer 3.

**Acceptance:** канн можно создать/вставить; диалог назначается на оператора и
фильтруется «Мои»; теги добавляются/убираются и сохраняются.

---

## Решения и не-цели

- **Не вводим** статус `SCHEDULED` в Campaign — scheduled/sending/done выводим из
  `scheduledFor` + гистограммы sends (минимальный blast radius в легаси-список кампаний).
- **Не строим** Redis/BullMQ — быстрый диспатч (5с) уже закрыл задержку доставки.
- **Глобальный TG rate-limit** (≈30 msg/s) при рассылке на сотни — пока не решаем
  (клиника ~33 пациента); если масштаб вырастет — добавить глобальный токен-бакет
  в `notifications-send` (отдельная задача).
- **Блокировки старше** прихода `my_chat_member` подбираются фоллбэком по фейлу отправки.

## Порядок работ

1. Модель: `tgBlockedAt`, `telegramLinkedAt`, `CannedResponse` + миграции, `prisma generate`.
2. Layer 1 (stats API + bar + i18n).
3. Layer 2 (webhook my_chat_member + send fallback + audience breakdown + inbox badge).
4. Layer 3 (broadcasts list API + cancel + history UI).
5. Layer 4 (canned CRUD + picker; assign; tags).
6. `npm run build` + `npm run i18n:check` зелёные. Деплой — по явной команде.
