# ТЗ — Security & Data-Integrity Hardening (после opus-свипа)

> Статус: **код НЕ начат** — это план работ, не отчёт о сделанном.
> Источник: оркестр-свип 12 агентов Opus (2026-06-29) + **ручная верификация
> каждого пункта Read/Grep** в этой же сессии. Каждая находка ниже помечена
> `verified` (прочитал код лично) или `agent` (агент сообщил, мной не довёрено).
> Автор-составитель: Claude. Гринлайт: **ожидается** (Javohir).
> Режим: это **баг/секьюрити-фиксы, не фичи** — формально совместимо с
> feature-freeze (polish-only), но каждый блок берётся в работу **отдельной явной
> командой**, по приоритету.
> **Деплой — отдельной явной командой, не авто.** Ни одного фикса по этому ТЗ не
> катим на прод без свежего явного запроса (правило no-auto-deploy).

---

## 0 · Контекст, который калибрует приоритеты

Прод `neurofax` — **single-clinic demo** (живых пациентов нет, клиника одна).
Отсюда два класса находок:

- 🔴 **Live-today** — утекает/ломается уже сейчас, одной клиники достаточно.
  Это приоритет №1.
- 🟠 **Latent (cross-tenant)** — реальный дефект кода, но **замаскирован** одной
  клиникой: становится живой утечкой в момент появления 2-й клиники. Чинить до
  онбординга второго тенанта.

Дисциплина проекта: агенты **переоценивают** находки (как в прошлый раз — outbox
«дубли» оказались by-design). Поэтому ниже — только то, что я перепроверил в коде;
сомнительное вынесено в Backlog с пометкой `agent`.

### Severity-легенда

| Метка | Значение | Срок |
|-------|----------|------|
| **P0** | утечка PHI / обход авторизации, бьёт сегодня | немедленно |
| **P1** | то же, но latent (нужен 2-й тенант) ИЛИ деньги/медико-легал | до онбординга 2-й клиники / до запуска биллинга |
| **P2** | корректность, комплаенс, рассинхрон UI | плановая волна |
| **P3** | косметика | по случаю |

### Рекомендованный порядок волн

1. **Волна A (P0):** S-1, S-5 — бьют сегодня, без 2-го тенанта.
2. **Волна B (P1 latent):** S-2, S-3, S-4 — закрыть до онбординга 2-й клиники.
3. **Волна C (P1 деньги/медико-легал):** S-6 (биллинг), D-5 (медико-легал ретеншн).
4. **Волна D (P2 корректность/комплаенс):** D-1…D-7.
5. **Волна E (P3 cruft):** C-1…C-4.

---

## Что НЕ входит (сознательно, не баги)

- **Опровергнутые находки** аудита/агентов — см. Приложение А. Не переоткрывать.
- **AI-поверхности** — выключены `AI_ENABLED=false` / `InDevelopment` / `return null`.
  Locked-решение (TZ-crm-stabilization Приложение А).
- **SIP-телефония** — отдельный проект, не секьюрити.
- **Биллинг как «живые деньги»** — Click/Payme сейчас Wave-3 **stub**, на реальный
  расчёт не подключён. S-6 — реальный дефект, но **не горит**, пока rails в stub;
  чинить до включения боевого биллинга.

---

# Блок A · Security (verified) — обход авторизации и утечки PHI

### S-1 · 🔴 P0 · Неаутентифицированный PHI на `/ticket/[id]`

- **Файлы:** `src/app/ticket/[id]/page.tsx`
- **`verified`**

**Проблема.** Публичная SSR-страница с `// @ts-nocheck`. Делает
`prisma.appointment.findUnique({ where:{id}, include:{ patient:true, doctor:true } })`
**без** `runWithTenant` и без проверки сессии, затем рендерит полное ФИО пациента
(`appointment.patient.fullName`, ~стр. 94), врача и кабинет. `id` — CUID, но это не
секрет: ссылка раздаётся в киоске/ресепшене, попадает в историю браузера, логи,
шаринг. Соседняя `/q/[id]` **намеренно** маскирует до инициалов — здесь маскировки нет.

**Корень.** Страница задумывалась как «талон по ссылке», но тянет полную include-модель
пациента без скоупа и без маскировки.

**Решение.**
1. Срезать выдачу до минимума талона: номер очереди, имя врача, кабинет, время —
   **без** ФИО пациента (или маскировать до инициалов, как `/q/[id]`).
2. Не использовать `include:{patient:true}` целиком — `select` только нужные поля.
3. Снять `@ts-nocheck`, типизировать выборку.
4. (Если талон должен показывать «ваше» имя) — поставить за подпись/капабилити-токен
   в URL, как сделано для вложений чата (capability-URL route), а не голый CUID.

**Acceptance.**
- Анонимный GET `/ticket/<любой id>` **не** содержит `fullName`/телефон/PHI пациента
  в HTML.
- `grep "@ts-nocheck" src/app/ticket/[id]/page.tsx` → 0.
- `tsc` по файлу зелёный.

**Effort:** S (полдня). **Blast radius:** низкий — отдельная публичная страница.

---

### S-2 · 🟠 P1 (latent) · `/api/kiosk/doctors` отдаёт все клиники анониму

- **Файлы:** `src/app/api/kiosk/doctors/route.ts`
- **`verified`**

**Проблема.** `// @ts-nocheck`, `prisma.doctor.findMany({ where:{active:true},
orderBy:{cabinet:"asc"}, select:{ ..., services:true } })` **без** `runWithTenant`.
Анонимный вызов возвращает **врачей, кабинеты, услуги и цены всех клиник**. Сегодня
маскируется одной клиникой (см. §0).

**Корень.** Прод-extension Prisma при `ctx == null` (вне `runWithTenant`) **не**
инъектит `clinicId` (`src/lib/prisma.ts`, ветка `if (!ctx) return query(args)`).
Любой Prisma-вызов вне `runWithTenant` → UNSCOPED.

**Решение.**
- Киоск привязан к конкретной клинике (slug/host). Резолвить `clinicId` из контекста
  киоска и обернуть выборку в `runWithTenant({kind:"TENANT", clinicId, ...})`,
  либо явно `where:{ clinicId }`.
- Снять `@ts-nocheck`, починить «legacy Prisma schema mismatch» из TODO (это и есть
  повод, по которому файл занопен).

**Acceptance.**
- Ответ содержит врачей **только** запрошенной клиники.
- Без валидного клиника-контекста — `400/404`, не «все клиники».
- `grep "@ts-nocheck"` по файлу → 0; `tsc`/`eslint` зелёные.

**Effort:** M (нужно починить legacy-shape). **Blast radius:** киоск (`/kiosk`).
Скоординировать с Backlog B1 из TZ-crm-stabilization (контракт `price`).

---

### S-3 · 🟠 P1 (latent) · `/api/leads` — unscoped GET + сломанный POST

- **Файлы:** `src/app/api/leads/route.ts`; `prisma/schema.prisma:2538` (`Lead.clinicId String`, non-null)
- **`verified`**

**Проблема.** GET вызывает `prisma.lead.count(...)` / `prisma.lead.findMany(...)`
**вне** `runWithTenant` → межтенантная выдача лидов (имя, телефон — это PHI-смежные
данные). POST не кладёт `clinicId` в payload, а колонка non-null → запись, вероятно,
падает/пишется без скоупа.

**Решение.**
- GET и POST обернуть в `runWithTenant` (или явный `where/data: { clinicId }`),
  `clinicId` брать из сессии/контекста, а не из тела запроса.
- Если эндпоинт публичный (форма заявки на сайте клиники) — резолвить `clinicId` из
  host/slug формы, как в S-2.

**Acceptance.**
- GET возвращает лиды только своей клиники.
- POST создаёт лид с корректным `clinicId`; без контекста — `400`.
- Юнит/ручной тест: лид клиники A не виден из контекста клиники B.

**Effort:** S–M. **Blast radius:** входящие заявки/лиды.

---

### S-4 · 🟠 P1 (latent) + 🔴 (перебор телефонов) · `/api/kiosk/checkin` без auth и без скоупа

- **Файлы:** `src/app/api/kiosk/checkin/route.ts`
- **`verified`**

**Проблема.** `prisma.patient.findFirst({ where:{ phone:{ in: variants } } })`,
защита — только rate-limit, без `runWithTenant`. Перебор телефонов → раскрытие
факта существования/идентичности пациента; межтенантно — across clinics.

**Решение.**
- Скоупнуть выборку по клинике киоска (`runWithTenant`/`where:{clinicId}`).
- Унифицировать ответ на «не найдено» / «найдено», чтобы по таймингу/телу нельзя
  было перебирать (одинаковый ответ + та же задержка).
- Оставить/ужесточить rate-limit на телефон+IP.

**Acceptance.**
- Чек-ин находит пациента только в клинике киоска.
- Ответ на найден/не-найден неразличим для перебора (по телу и коду).

**Effort:** S. **Blast radius:** киоск-чек-ин.

---

### S-5 · 🔴 P0 · Обход срока импер­сонации (override-cookie переживает grant)

- **Файлы:** `src/lib/auth.ts:271-283`; `src/app/api/platform/session/switch-clinic/route.ts:129,133`
- **`verified`**

**Проблема.** При старте импер­сонации SUPER_ADMIN ставятся две куки:
- `OVERRIDE_COOKIE_NAME` (HMAC clinicId) — **`60*60*12` = 12h** (`route.ts:129`);
- `GRANT_COOKIE_NAME` (grantId, лиз 60 мин) — **`60*60` = 60min** (`route.ts:133`,
  комментарий «mirrors lease» — фактически **не** mirrors).

В JWT-callback (`auth.ts`):
- стр. **276-283:** если grant-cookie пропал/истёк → `token.clinicId = overridden;
  token.impersonationMode = null;`. `mode = null` означает **не VIEW_ONLY → запись
  не гейтится** («grant-less sessions cannot be VIEW_ONLY»).
- стр. **271-275:** при ошибке чтения grant из БД → `catch { token.clinicId =
  overridden }`, режим не сбрасывается.

**Итог:** после истечения 60-мин лиза override-кука живёт ещё до **12 часов**, и в
этом окне импер­сонация продолжается **без VIEW_ONLY-гейта** (фактически WRITE).

**Решение.**
1. Сравнять срок жизни: `OVERRIDE_COOKIE` ≤ сроку grant (60 мин), либо вычислять
   `Max-Age` из `grant.expiresAt`.
2. В `auth.ts`: **отсутствие/просрочка grant** ⇒ **сбросить** `clinicId`-override
   (выйти из импер­сонации), а не сохранять его. «Нет валидного лиза → нет
   импер­сонации».
3. Ошибку чтения grant трактовать **fail-closed**: сбросить override, не
   продлевать.

**Acceptance.**
- После протухания grant-cookie запрос в `/api/crm/*` идёт уже **без** override
  (клиника = родная сессия), не как импер­сонируемая.
- Невозможно состояние `clinicId=override && mode=null`.
- Аудит `SUPER_ADMIN_IMPERSONATE_*` согласован с фактическим окном доступа.

**Effort:** S. **Blast radius:** только платформенная импер­сонация (SUPER_ADMIN).
**Тест:** ручной — стартовать импер­сонацию, протухнуть grant (или удалить
grant-cookie), убедиться что доступ к чужой клинике пропал.

---

### S-6 · P1 (деньги; не горит, пока биллинг в stub) · `markInvoicePaid` применяет не тот план и не сверяет сумму

- **Файлы:** `src/server/billing/invoice.ts:137-205` (`markInvoicePaid`, apply плана `174-182`);
  `src/server/billing/payments/click.ts:168-184`
- **`verified`** (стат-чтение; рантайм-деньги не подключены)

**Проблема.**
1. Идемпотентность через `if (status === PAID) return` — **TOCTOU**, вне транзакции.
2. При оплате применяется `subscription.pendingPlanId` **независимо от того, какой
   именно инвойс оплачен** (у `Invoice` **нет** колонки плана). Оплата старого/дешёвого
   инвойса может применить текущий `pendingPlanId` → «заплати дёшево, получи дорогой».
3. Сумма платежа **не сверяется** с суммой инвойса. `click.ts:168-184` — при
   незаданном секрете webhook **stub-принимает** платёж; в подписанном режиме сумма
   входит в MD5, но `markInvoicePaid` её всё равно не сравнивает с инвойсом.

**Решение.**
1. Привязать оплату к конкретному инвойсу: применять план, **соответствующий этому
   инвойсу** (добавить `Invoice.planId`/`targetPlanId` или хранить в `metadata` и
   читать его, а не `sub.pendingPlanId`).
2. Сверять `paidAmount === invoice.amount` (в тийинах) перед `markInvoicePaid`;
   расхождение → отказ + аудит.
3. Идемпотентность и смену статуса — внутри **одной транзакции** с условным апдейтом
   (`updateMany where status != PAID`), чтобы убрать TOCTOU.
4. Webhook без секрета — **fail-closed** (не принимать), а не stub-accept (минимум —
   за фиче-флагом dev-режима).

**Acceptance.**
- Оплата инвойса X применяет именно план инвойса X.
- Несовпадение суммы → платёж отклонён, инвойс не `PAID`.
- Двойной webhook не применяет план дважды (идемпотентно в транзакции).

**Effort:** M. **Blast radius:** биллинг (сейчас stub). **Сделать до запуска боевых
rails.**

---

# Блок B · Data-integrity / correctness (verified)

### D-1 · P2 · Двойная отправка уведомления (нет блокировки строки)

- **Файлы:** `src/server/workers/notifications-send.ts:66,188`
- **`verified`**

**Проблема.** Воркер на стр. 66 проверяет `if (status !== QUEUED) return`, затем на
стр. 188 делает сетевой `adapters.tg.send(...)` **до** флипа статуса
(`recordNotificationDelivery`). Без блокировки строки два перекрывающихся диспетчера
могут оба пройти проверку и отправить дважды.

**Решение.** Атомарно «забрать» строку перед отправкой: `updateMany({ where:{ id,
status:QUEUED }, data:{ status: SENDING } })` и продолжать только если `count===1`
(claim-паттерн), либо `SELECT … FOR UPDATE SKIP LOCKED` как в outbox-pumper.

**Acceptance.** Под параллельным диспетчером каждое `NotificationSend` уходит ровно
один раз (тест с двумя воркерами на одной строке).

**Effort:** S–M.

---

### D-2 · P3 · Off-by-one в backoff ретраев

- **Файлы:** `src/server/workers/notifications-send.ts:35-36,259`
- **`verified`**

**Проблема.** `BACKOFF_MS=[60_000,300_000,1_800_000]`, но `nextAttempt =
retryCount+1` стартует с 1 → `BACKOFF_MS[Math.min(nextAttempt,len-1)]` никогда не
берёт индекс 0 (60s). Фактический backoff: 300s, 1800s. Запись `60s` мёртвая.

**Решение.** Индексировать от `retryCount` (0-based) либо убрать мёртвый первый
элемент. Косметика, но чинит «первый ретрай через минуту».

**Acceptance.** Первый ретрай = 60s (если так задумано), либо массив без мёртвого
элемента.

**Effort:** XS.

---

### D-3 · P2 · Дрейф соглашения о ключах шаблонов (confirm-кнопка / no-spam)

- **Файлы:** `src/server/workers/notifications-send.ts:76-78,175`;
  `src/server/notifications/default-templates.ts`;
  `src/server/notifications/triggers.ts:285-400` (`whereForTrigger`);
  `scripts/seed-mega-neurofax.ts`, `scripts/seed-prod-demo.ts`
- **`verified`** (прод-эффект статически **тёмный** — см. ниже)

**Проблема.** В проекте **две** системы ключей шаблонов:
- точечные `reminder.24h` / `reminder.2h` / `reminder.3d` — `seed-mega-neurofax.ts`
  + реестр `triggers.ts`;
- дефисные `appointment.reminder-24h` / `-2h` / … — `default-templates.ts` +
  `auto-messages.ts`.

Воркер (стр. 76-78 — no-spam confirm-cascade guard; стр. 175 — `wantsConfirmButton`)
**жёстко зашит на точечный вариант** (`reminder.24h`/`reminder.2h`/`reminder.3d`).
При этом напоминания матчатся **по `trigger`+`offsetMin`**, а не по `key`
(`whereForTrigger`), так что фактический `template.key` зависит от того, какой сид
налил прод. Память: прод решидится `seed-mega-neurofax.ts` → ключи **точечные** →
guard, **скорее всего, срабатывает**. Но это держится на одном совпадении строки и
ломается от смены сида.

> Примечание: агент в свипе заявил «guard не матчится никогда» (из `default-templates.ts`)
> — это **переоценка**. Под `seed-mega` он матчится. Реальная находка — **хрупкость
> дрейфа**, а не гарантированный сбой.

**Решение.**
1. Перестать опираться на строковый `key` в воркере. Решать «слать ли confirm-кнопку
   / включать ли no-spam-cascade» по **семантике триггера** (`trigger` enum +
   `offsetMin`) или по явному флагу на шаблоне (`NotificationTemplate.wantsConfirm:
   Boolean`), а не по совпадению slug.
2. Свести три определения шаблонов к **одному канону** (`default-templates.ts` ИЛИ
   реестр `triggers.ts`), второй — удалить/реэкспортнуть, сиды — на канон.

**Acceptance.**
- Confirm-кнопка и no-spam-подавление включаются по семантике, не по строке `key`.
- Один источник правды для шаблонов; смена сида не ломает confirm-логику.
- (Диагностика) проверить на проде фактический `NotificationTemplate.key` для
  reminder-строк, зафиксировать какой канон реально налит.

**Effort:** M. **Blast radius:** напоминания (видимая фича для пациентов).

---

### D-4 · P2 · `bulk-status` рассинхронит доску ресепшена

- **Файлы:** `src/app/api/crm/appointments/bulk-status/route.ts`;
  для контраста `src/app/api/crm/appointments/[id]/route.ts:523-525`
- **`verified`**

**Проблема.** Bulk `updateMany` пишет только `status`, **не** пишет `queueStatus` и
**не** шлёт realtime-событие. Одиночный PATCH (`[id]:523-525`) зеркалит
`status→queueStatus` («reception board reads queueStatus»). После bulk-операции доска
ресепшена показывает устаревшее состояние, пока не перезагрузят.

**Решение.** В bulk-роуте после смены `status` так же зеркалить `queueStatus`
(той же логикой, что и одиночный PATCH) и публиковать realtime-событие
(`publishEventSafe`) по затронутым записям.

**Acceptance.** После bulk-смены статусов доска ресепшена обновляется без
перезагрузки; `queueStatus` согласован со `status`.

**Effort:** S–M.

---

### D-5 · P1 (медико-легал) · Каскадное удаление заключений + сырой hard-delete пациента ADMIN-ом

- **Файлы:** `prisma/schema.prisma:2007-2016` (`VisitNote.appointment @relation(... onDelete: Cascade)`);
  `src/app/api/crm/patients/[id]/route.ts:100-117` (`prisma.patient.delete`, roles `ADMIN`)
- **`verified`**

**Проблема.**
1. `VisitNote` (финализированное заключение: `documentNumber`, диагноз ICD-10,
   назначения) висит на `appointment` с `onDelete: Cascade` — удаление приёма уносит
   медико-легальный документ без soft-delete/ретеншена.
2. `DELETE /api/crm/patients/[id]` — сырой `prisma.patient.delete()` под ролью ADMIN,
   **в обход DSAR-анонимизации**. (Прим.: `VisitNote.patient` — required-связь без
   `onDelete` → дефолт Prisma `Restrict` может **заблокировать** удаление пациента при
   наличии заключений; это надо проверить миграцией, а не предполагать.)

**Решение.**
1. Для медико-легальных сущностей (`VisitNote`, финализированные `Document`) —
   запретить жёсткий каскад: `onDelete: Restrict` либо soft-delete (`deletedAt`) с
   ретеншеном по регламенту клиники. Финализированное заключение не должно исчезать
   вместе с приёмом.
2. `DELETE` пациента ADMIN-ом — направить через DSAR-флоу (анонимизация/контролируемое
   удаление, см. D-6), а не сырой `prisma.delete`. Минимум — запретить hard-delete при
   наличии финализированных заключений + явный аудит и подтверждение.

**Acceptance.**
- Нельзя удалить приём/пациента так, чтобы молча пропало финализированное заключение.
- Hard-delete пациента невозможен в обход DSAR (или требует явного supervised-режима
  с аудитом).
- Миграция onDelete проверена на проде (`_prisma_migrations` + поведение FK).

**Effort:** M (миграция + роут). **Blast radius:** удаление пациентов/приёмов
(редкая, но необратимая операция) — катить аккуратно, бэкап БД до миграции.

---

### D-6 · P2 (комплаенс) · DSAR ANONYMIZE оставляет PHI в связанных сущностях

- **Файлы:** `src/server/dsar/anonymize.ts` (`buildAnonymizationPayload`);
  `src/app/api/.../deletions/route.ts:23` (default `ANONYMIZE`);
  `src/app/.../account/delete/route.ts:99` (hardcoded `ANONYMIZE`)
- **`verified`**

**Проблема.** `ANONYMIZE` — дефолт и захардкожен для самоудаления пациента, но
`buildAnonymizationPayload` чистит **только строку `Patient`**. PHI остаётся в
`MedicalCase.soapDraft`, `Appointment.notes`, `Message.body`, `PatientReview`.
То есть «анонимизированный» пациент всё ещё идентифицируем по связанным записям.

**Решение.** Расширить payload анонимизации на все носители PHI: затирать/обезличивать
`MedicalCase.soapDraft`, `Appointment.notes`, `Message.body`, `PatientReview` (и
проверить, нет ли ещё — пройтись по схеме на freetext-поля, привязанные к пациенту).
Решить продуктово: что из медико-легального **нельзя** анонимизировать (ретеншен) —
согласовать с D-5.

**Acceptance.** После ANONYMIZE по связанным сущностям не остаётся ФИО/телефона/
свободного текста, идентифицирующего пациента (кроме явно удерживаемого по ретеншену).

**Effort:** M.

---

### D-7 · P2 · Спуфинг авторства назначения внутри клиники

- **Файлы:** `src/app/api/crm/cases/[id]/prescriptions/route.ts`
- **`verified`**

**Проблема.** Роут берёт `body.doctorId` и проверяет лишь
`doctor.clinicId === mcase.clinicId`. Не проверяется, что вызывающий DOCTOR — это
**тот самый** `doctorId`. Врач может выписать назначение от имени коллеги (в той же
клинике).

**Решение.** Если роль вызывающего `DOCTOR` — игнорировать `body.doctorId` и брать
`doctorId` из его собственного профиля (как в `doctors/me/*`). `body.doctorId`
разрешать только привилегированным ролям (ADMIN), и то с аудитом.

**Acceptance.** DOCTOR не может атрибутировать назначение другому врачу;
`body.doctorId` от DOCTOR-а игнорируется.

**Effort:** S.

---

### D-8 · P2 · Часовой пояс: суточные границы плывут (UTC vs Asia/Tashkent)

- **Файлы:** `src/lib/format.ts` (`formatRelative` — server-local);
  raw-SQL миграции аналитики (нет `SET TIME ZONE`, дефолт UTC)
- **`verified`** (паттерн), **`agent`** (точный список отчётов аналитики)

**Проблема.** `formatRelative` считает от server-local времени; сырые SQL-агрегации
аналитики не выставляют TZ (дефолт UTC). Границы суток смещаются до **5 часов** против
Asia/Tashkent (UTC+5, без DST) — дневные бакеты/«сегодня» врут на стыке суток.

**Решение.** Все суточные агрегации и относительные форматтеры привязать к
Asia/Tashkent (как уже сделано в `formatClinicDateTime`): в SQL — `AT TIME ZONE
'Asia/Tashkent'` на границах бакетов; `formatRelative` — на клиники-TZ.

**Acceptance.** «Сегодня»/дневные бакеты совпадают с локальным днём Ташкента на стыке
полуночи (тест на 23:30 и 00:30 локального).

**Effort:** M (надо пройтись по всем агрегациям). **Blast radius:** аналитика/отчёты.

---

# Блок C · Cruft / мёртвый код (freeze-safe)

### C-1 · `@ts-nocheck` на живых PHI-роутах
`ticket/[id]/page.tsx`, `api/kiosk/doctors/route.ts` — типобезопасность отключена
ровно там, где утечки (S-1, S-2). Снять `@ts-nocheck` в рамках S-1/S-2 и
типизировать. **Acceptance:** `grep "@ts-nocheck"` по этим файлам → 0.

### C-2 · Тройное определение шаблонов уведомлений
`default-templates.ts` vs реестр `triggers.ts` vs `seed-mega-neurofax.ts` — три
несогласованных набора ключей (см. D-3). Свести к одному канону, остальное удалить.

### C-3 · Мёртвая запись `BACKOFF_MS[0]` (60s)
См. D-2 — недостижимый индекс. Убрать или починить индексацию.

### C-4 · Прочий мёртвый код от свипа — `agent`, требует верификации
Агент-«охотник за мёртвым кодом» дал список кандидатов; **в это ТЗ не вношу как
факт** — каждый кандидат проверить Read/Grep на отсутствие потребителей перед
удалением (как делали с `telegram`/`callbacks` в S2 предыдущего ТЗ). Удаление —
только после подтверждения «0 потребителей».

---

# Backlog — `agent`, не довёрено (проверить перед работой)

- **MA-1 · miniapp reschedule прошлых слотов** (`agent`). Сообщено, что перенос
  записи принимает слот в прошлом / есть edge в чек-ине. Не дочитывал — сперва
  верифицировать роут переноса miniapp, затем решать.
- **Список «мёртвого кода»** от свипа — см. C-4.
- **B1/B2/B3 из TZ-crm-stabilization** — без изменений (kiosk price-контракт,
  live-эндпоинт колл-центра, дефолт `enabled` в расписании отчётов).

---

# Приложение А — опровергнутые / by-design (НЕ переоткрывать)

Проверено в коде в этой и прошлой сессиях. Каждый пункт — **не баг**.

- **Outbox «дубликаты событий»** — by-design at-least-once (UNIQUE `AuditLog.eventId`
  + SSE `Last-Event-ID` дедуп). Refuted.
- **`exports.ts` «нет clinicId»** — unscoped только под SUPER_ADMIN (намеренно).
  Refined.
- **AI-панели «пустые/сломанные»** — `InDevelopment` / `if(!AI_ENABLED) return null`.
  By-design (TZ-crm-stabilization Прил. А).
- **action-center `telegram`/`callbacks` «показывает пустые массивы»** — никогда не
  рендерились, мёртвый код, удалён в S2 прошлого ТЗ. Refuted.
- **Kiosk `price*100`** — рабочий воркэраунд под legacy-контракт (Backlog B1),
  корректные сумы. Refuted.
- **«guard напоминаний не матчится никогда»** — переоценка; под `seed-mega` матчится.
  Реальное — дрейф ключей (D-3), а не гарантированный сбой.

---

# Приложение Б — глобальный план верификации/деплоя

1. **По каждому блоку — отдельный гринлайт** (Javohir), берём по приоритету волн (§0).
2. Перед миграциями (D-5) — **бэкап БД** прод (по runbook), проверить
   `_prisma_migrations` после (память: build-cache может довезти старые миграции).
3. После любого фикса в shared-инфре — **смоук соседей** (rtxshop/orientatravel
   публичные пути), nginx `reload` если трогали (правило shared-VPS).
4. Деплой — макрос «деплой»: commit→push→prod `git pull`→`_deploy.sh`→смоук
   (`health`/`home`/`miniapp`/`rtxshop`). **Только по явной команде, не авто.**
5. Прод `neurofax` = demo: после миграций при необходимости решид
   `seed-mega-neurofax.ts` + `seed-today-live.ts` (UTC→Tashkent live-board).

---

## Сводная таблица

| ID | Severity | Тема | Файл(ы) | Effort | Статус |
|----|----------|------|---------|--------|--------|
| S-1 | 🔴 P0 | Unauth PHI на /ticket/[id] | `app/ticket/[id]/page.tsx` | S | verified |
| S-2 | 🟠 P1 lat | kiosk/doctors unscoped | `api/kiosk/doctors/route.ts` | M | verified |
| S-3 | 🟠 P1 lat | leads unscoped GET + POST | `api/leads/route.ts` | S–M | verified |
| S-4 | 🔴/🟠 P1 | kiosk/checkin no-auth/no-scope | `api/kiosk/checkin/route.ts` | S | verified |
| S-5 | 🔴 P0 | impersonation lease bypass | `lib/auth.ts`, `switch-clinic/route.ts` | S | verified |
| S-6 | P1 (stub) | markInvoicePaid wrong-plan/no-amount | `billing/invoice.ts`, `payments/click.ts` | M | verified |
| D-1 | P2 | double-send (no row lock) | `workers/notifications-send.ts` | S–M | verified |
| D-2 | P3 | backoff off-by-one | `workers/notifications-send.ts` | XS | verified |
| D-3 | P2 | template-key drift | `notifications/*`, seeds | M | verified |
| D-4 | P2 | bulk-status desync доски | `appointments/bulk-status/route.ts` | S–M | verified |
| D-5 | P1 | каскад заключений + hard-delete | `schema.prisma`, `patients/[id]/route.ts` | M | verified |
| D-6 | P2 | DSAR anonymize оставляет PHI | `dsar/anonymize.ts` | M | verified |
| D-7 | P2 | спуфинг авторства назначения | `cases/[id]/prescriptions/route.ts` | S | verified |
| D-8 | P2 | TZ суточные границы | `lib/format.ts`, SQL миграции | M | verified/agent |
| C-1…C-4 | P3 | cruft/мёртвый код | — | XS–S | mixed |
| MA-1 | ? | miniapp reschedule прошлого | `api/miniapp/*` | ? | agent |
