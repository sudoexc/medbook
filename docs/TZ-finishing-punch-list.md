# ТЗ — Финишная зачистка проекта (punch-list)

> Статус: код-волны A/C/D/E + B-код-часть закрыты (2026-06-19), `tsc` +
> `i18n:check` зелёные, queue-тест зелёный, НЕ задеплоено. Остались только
> деплой-гейты: флип `DOCTOR_CABINET_ENABLED=1` (волна B) и провижн `REDIS_URL`
> + Redis-инстанс (волна E) — оба по явной команде на деплое.
> Автор-исполнитель: Claude. Гринлайт: Javohir, 2026-06-19.
> Принцип: закрыть реальные хвосты честно (без фейк-данных и заглушек), не
> раздувая скоуп. Переиспользуем существующие движки (api-handler, audit,
> миграции-папки, prisma generate офлайн). **Деплой — отдельной явной командой,
> не авто.** Миграции применяются на проде только при деплое.
>
> Источник: аудит 4 агентами + ручная верификация (2026-06-19). Опровергнуто:
> кнопка «✅ Подтверждаю» НЕ сломана — `webhook/[clinicSlug]/route.ts:507-562`
> парсит `confirm:<id>` → `confirmAppointment({via:'TG_BUTTON'})`. В скоуп не входит.

## Что НЕ входит (сознательно отложено, не баги)

- Редактор ролей (RBAC) — read-only сегодня, многонедельная задача (нужен
  `RolePermission` + рефактор ~100 хендлеров). Не трогаем.
- SIP-телефония (Mute/Hold/Transfer) — заглушки с дисклеймером, нужен провайдер.
- Аналитика воронки мини-аппа — нужна таблица `MiniAppEvent` + инструментация.
- Удаление SMS — сделано намеренно (`docs/TZ-sms-removal.md`), DONE.
- Остаток cross-surface-sync — черновик, не подписан.

---

## Wave A — Честные данные (быстрые, реальные фиксы)

### A1 · Реальный «стаж» доктора вместо фейка (#780)

**Проблема.** `doctor-picker.tsx:142` рисует хардкод `t.book.experienceStub`
(«Стаж 10 лет» / «10 yil tajriba») на каждой карточке доктора в живом букинге.
Поля опыта в `Doctor` нет → пациенту показывают выдуманные данные.

**Решение (пересмотрено 2026-06-19).** Просто убрать фейк-строку. Настоящее поле
«стаж» не заводим: у врача в CRM **нет формы редактирования** персональных данных
(bio/spec задаются только при создании, страница `[id]` управляет расписанием и
услугами). Структурное поле стажа потребовало бы строить новый edit-surface ради
подзаголовка карточки — это непропорционально. Реальный «стаж» = отдельное
продуктовое решение, отложено до появления edit-формы доктора.

- Удалить строку `{t.book.experienceStub}` в `doctor-picker.tsx:138-143`.
- Удалить ключи `book.experienceStub` из `_messages/ru.ts:123` и `uz.ts:123`.

**Acceptance.** В мини-аппе карточка доктора без выдуманного стажа. `grep
experienceStub` → 0. `i18n:audit` зелёный. `tsc` зелёный.

### A2 · Честный фильтр «ожидают подписи» в Документах (#781)

**Проблема.** `documents/route.ts:88-91` — заглушка: `pendingSignature=true`
фильтрует `type IN (CONSENT, CONTRACT)`, отдаёт ВСЕ согласия/договоры независимо
от факта подписи.

**Решение.** Завести статус подписи и фильтровать по нему.

- Модель: `Document.signedAt DateTime?` (`NULL` = не подписан).
- Миграция: `<ts>_document_signed_at/migration.sql`.
- Фильтр: `pendingSignature=true` → `type IN (CONSENT,CONTRACT) AND signedAt = NULL`.
- Экшен `POST /api/crm/documents/[id]/sign` (roles ADMIN, RECEPTIONIST, DOCTOR,
  NURSE) — ставит `signedAt = now`, пишет `audit('document.sign')`. Идемпотентно
  (повторный вызов — no-op, возвращает текущее состояние).
- UI Документов: кнопка «Отметить подписанным» на строке CONSENT/CONTRACT без
  `signedAt`; для подписанных — бейдж «Подписан · <дата>».

**Acceptance.** Фильтр «ожидают подписи» показывает только реально неподписанные
CONSENT/CONTRACT. Подписанный документ из фильтра исчезает. Audit-строка пишется.

---

## Wave B — Запустить кабинет врача (#779)

**Проблема.** Код кабинета готов, но выключен флагом: `doctor/layout.tsx:31`
(`DOCTOR_CABINET_ENABLED !== "1"` → bounce на `/crm`). DoD-чеклист
`docs/TZ-doctor-cabinet.md:291-299` целиком `[ ]`, хотя по факту всё реализовано
в коде (проверено агентом: MOCK удалён, 2FA-гейт, conclusion→miniapp, labs→patient,
referral, ICD-10, CDS-override — всё есть).

**Решение (без деплоя).**
1. Локальный smoke-тест всех экранов `/doctor/*` под флагом `=1`: my-day,
   reception, patients, conclusions, documents, schedule, references, analytics,
   notifications, messages, settings. Чинить найденное.
2. Сверить и проставить DoD-чеклист в `TZ-doctor-cabinet.md` + «unpause checklist»
   в `_ROADMAP.md` (привести доки в соответствие с кодом, убрать протухшие
   утверждения про «66 hardcoded Cyrillic»).
3. Карточка «AI-помощник готовится» (`my-day/_components/ai-assistant.tsx:100`) —
   Phase 3b: либо подключить к существующим `api/crm/ai/*`, либо убрать мёртвое
   обещание. **Решение: убрать карточку** (AI-рельс — отдельный скоуп).
4. Включение `DOCTOR_CABINET_ENABLED=1` на проде — **на деплое, явной командой.**

**Acceptance.** Локально под флагом весь кабинет открывается и работает; чеклисты
сверены; мёртвая AI-карточка убрана. Прод-флип — отдельно.

**Статус код: DONE 2026-06-19** (кроме браузерного smoke + прод-флипа).
- Мёртвая AI-карточка убрана (`my-day/_components/ai-assistant.tsx` — placeholder
  снят, реальный day-summary оставлен; ключи `ai.comingSoon*` удалены из ru/uz).
- DoD-чеклист `TZ-doctor-cabinet.md §5`: пункты 1–7 проставлены `[x]` с
  код-пруфами (MOCK чисто, TOTP-гейт `api-handler.ts`, conclusion→miniapp,
  labs `REVIEWED`, referral-PDF, ICD-10, токены+i18n). Пункты 8–9 (миграции
  на проде, staging→прод) — деплой-гейт, `[ ]`.
- `_ROADMAP.md` «Unpause checklist» помечен SUPERSEDED 2026-06-19 с ретракцией
  протухших claim'ов («66 hardcoded Cyrillic» — i18n в парности; «нет TOTP-гейта»
  — есть; «нет audit в find-or-create» — есть в кернеле `find-or-create.ts:161`).
- **Не сделано честно:** браузерный runtime-smoke всех `/doctor/*` под флагом — не
  могу прогнать UI здесь; статическая гарантия = `tsc` + `i18n:check` зелёные.
  Флип `DOCTOR_CABINET_ENABLED=1` — по явной команде на деплое.

---

## Wave C — Типобезопасность нагруженных путей (#783)

**Проблема.** `src/lib/booking-validation.ts:1` и `src/app/api/kiosk/checkin/route.ts:1`
под `// @ts-nocheck` + «TODO(phase-1): rewrite — legacy Prisma schema mismatch».
Это нагруженные пути (валидация букинга + киоск-чекин) — дрейф схемы пройдёт молча.

**Решение.** Переписать под текущую схему Prisma, снять `@ts-nocheck`, добиться
чистого `tsc` на этих файлах. Сопутствующие киоск-роуты из того же кластера
(`api/kiosk/doctors`, `kiosk/page.tsx`) — по необходимости.

**Acceptance.** `@ts-nocheck` снят с обоих файлов; `tsc --noEmit` зелёный;
поведение букинга/чекина не изменилось.

---

## Wave D — Фронт-полировка (#784 + minor)

- **#784 — DONE.** `use-current-role.ts` больше не хардкодит ADMIN: добавлен
  `CrmRoleProvider` (контекст), который `crm/layout.tsx` сидит реальной ролью из
  серверной сессии (`session.user.role`). Query-param-шим `?role=` убран. Сервер
  по-прежнему гейтит через `createApiHandler({roles})` — это косметика.
- **DONE.** 2 остаточных `as never` в мини-аппе
  (`conversations/[id]/messages/route.ts`, `documents/route.ts`) →
  `satisfies Prisma.*UncheckedCreateInput` (касты были лишними, формы валидны).
- **DONE 2026-06-19.** TG-инбокс — движок оказался уже готов: `tg.message.new`
  публикуется вебхуком (`telegram/webhook/[clinicSlug]/route.ts` → `realtime/events.ts`),
  а `useTgMessagesRealtime` смонтирован в `chat-pane.tsx:104`. Убрал лишний
  60-сек polling с активного чата (теперь чисто SSE, как у `doctor/messages`),
  починил протухшие комментарии. Список диалогов (`use-conversations.ts:132`)
  свой 60-сек reconcile сохраняет.
- **DONE 2026-06-19.** `formatSum` (`mini-ui.tsx`) — протянул `preferredLang`
  (существующее поле `Patient`, не новое → совместимо с freeze): сигнатура
  `formatSum(amount, lang)` делегирует в `formatMoney`, uz теперь получает суффикс
  «so'm» вместо «сум». Обновлены 4 колл-сайта в `book/*` (у всех `lang` уже в
  scope). Убран `eslint-disable`/unused-arg хак.
- **DONE 2026-06-19 (freeze снят точечно по команде).** Серверный персист языка
  стаффа. Добавлено: `User.preferredLocale String @default("ru")` + идемпотентная
  миграция `20260619130000_user_preferred_locale`; `PATCH /api/me` (createApiHandler,
  любой аутентифицированный role, audit `USER_LOCALE_UPDATED`); `language-switcher.tsx`
  шлёт best-effort PATCH на каждый тоггл; **ридер** — `auth.ts` сидит `NEXT_LOCALE`
  cookie из `User.preferredLocale` на signin (тот же `cookies()`-контекст, что и
  `mintUserSessionOnSignIn`), так что свежий браузер/девайс открывается в
  сохранённом языке. `tsc`+`i18n:check` зелёные (новых ключей нет).
  **Честный лимит:** заявленный пейофф «уведомления на языке стаффа» латентный —
  диспетчера уведомлений для стаффа в коде НЕТ (вся подсистема `NotificationSend`
  пациент-only; `DoctorNotificationPref` имеет UI+эндпоинт, но ни один бэкенд его
  не читает). `preferredLocale` — единый источник правды, готовый к чтению, когда
  такой диспетчер появится; строить сам диспетчер = крупная нетто-новая подсистема,
  вне этого скоупа. Прод: миграция применяется на деплое, по явной команде.

**Acceptance.** Каждый пункт — отдельный мелкий PR-уровень; не блокирует Wave A–C.

---

## Wave E — Инфра: Redis + BullMQ (#782) · ТЯЖЁЛАЯ, отдельный заход

**Проблема.** `REDIS_URL` не задан → `InMemoryQueueAdapter` живой в проде
(`server/queue/index.ts:23`, `workers/start.ts`). Джобы (рассылки/уведомления)
и SSE-события теряются при рестарте процесса; нет at-least-once. Самый серьёзный
риск для прода, рядом с системой уведомлений.

**Решение.** Реальный BullMQ + Redis-адаптер за тем же интерфейсом `getQueue()`,
payload джоб и DB-записи — без изменений. Redis-бэкенд для event-bus/SSE-fan-out.
Прод-инфра (Redis-контейнер на VPS) — согласовать отдельно; общий Redis уже есть
(см. shared-VPS topology).

**Acceptance.** При заданном `REDIS_URL` джобы переживают рестарт; in-memory
остаётся дев-fallback. Отдельная сессия — не смешивать с Wave A–D.

**Статус код: DONE 2026-06-19.** `src/server/queue/bullmq-adapter.ts`
(`BullmqQueueAdapter implements QueueAdapter`: `enqueue`→`queue.add`,
`registerWorker`→один `Worker` на очередь с диспетчингом по `job.name`,
`repeat`→`upsertJobScheduler({every})`, `shutdown`→close+quit). `getQueue()`
ветвится на `process.env.REDIS_URL`; статический импорт безопасен (bullmq при
импорте соединений не открывает). `workers/start.ts` — graceful shutdown через
`getQueue().shutdown()` с 10s-таймаутом. Redis event-bus/SSE уже существовал
(`realtime/redis-adapter.ts`). `tsc` зелёный, `notifications-queue` тест зелёный.
**Не задеплоено**, `REDIS_URL` на проде НЕ задан (in-memory ещё активен) —
провижн Redis + флип env только на деплое, по явной команде.

---

## Порядок исполнения

A1 → A2 → C → D → (B: локальный smoke + доки) → E (отдельно).
Деплой и прод-флип `DOCTOR_CABINET_ENABLED` — только по явной команде.
