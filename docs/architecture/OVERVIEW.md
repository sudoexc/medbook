# MedBook / NeuroFax — обзор архитектуры (as-is)

> Документ описывает систему **как она есть в коде** на момент написания.
> Спецификации («что планировали») лежат в `docs/TZ*.md` и частично не реализованы — здесь только то, что проверено по исходникам. Каждый раздел содержит пути к файлам для проверки.

## Оглавление

1. [Что это за продукт](#1-что-это-за-продукт)
2. [Поверхности (surfaces)](#2-поверхности-surfaces)
3. [Карта репозитория](#3-карта-репозитория)
4. [Жизненный цикл API-запроса](#4-жизненный-цикл-api-запроса)
5. [Мульти-тенантность](#5-мульти-тенантность)
6. [Фоновая обработка](#6-фоновая-обработка)
7. [Хранилище файлов](#7-хранилище-файлов)
8. [Локализация](#8-локализация)
9. [Время клиники — Asia/Tashkent](#9-время-клиники--asiatashkent)
10. [Что не реализовано / выключено](#10-что-не-реализовано--выключено)

---

## 1. Что это за продукт

MedBook — мульти-тенантная операционная система для частных клиник (первый живой tenant — клиника NeuroFax, прод на neurofax.uz). Продукт закрывает весь операционный контур клиники: запись пациентов (звонок, ресепшн, киоск самозаписи, Telegram Mini App), живую очередь с двумя «полосами» (walk-in + запись по времени), приём у врача (визит-ноты, назначения, направления, больничные), коммуникации с пациентом (Telegram-бот + встроенный чат), платежи, аналитику и платформенный биллинг клиник (тарифы, лимиты, триал). Единственный внешний канал уведомлений — Telegram; SMS удалён по решению `docs/TZ-sms-removal.md` (см. §9).

Пользователи — это роли-рабочие места (`Role` в `src/lib/tenant-context.ts`): `SUPER_ADMIN` (оператор платформы), `ADMIN` (владелец/админ клиники), `DOCTOR`, `RECEPTIONIST`, `NURSE`, `CALL_OPERATOR`. Отдельной роли «пациент» в системе **нет** — пациент работает через Telegram Mini App, где аутентификация идёт по подписи `initData` Telegram, а не по NextAuth-сессии (см. §2). Плюс есть «безлюдные» поверхности: ТВ-табло очереди в холле и у кабинета врача, киоск самозаписи, печатный талон с QR.

Стек: Next.js 16 (App Router; `proxy.ts` вместо middleware — версия сильно отличается от привычной, см. `AGENTS.md`), TypeScript strict, Prisma 7 (`prisma/schema.prisma`, ~80 моделей), Postgres 16, Redis 7 (BullMQ + pub/sub для SSE), MinIO (S3-совместимое хранилище), next-intl (ru/uz), Tailwind 4. Деплой — docker-compose на VPS (`docker-compose.yml`: postgres, redis, minio, app, worker, nginx, certbot).

---

## 2. Поверхности (surfaces)

### 2.1 CRM — `src/app/[locale]/crm/*`

Основное рабочее место персонала клиники. Разделы (папки внутри `crm/`): `reception` (живая очередь), `appointments`, `calendar` (FullCalendar по врачам), `patients`, `doctors`, `call-center`, `telegram` (инбокс чатов с пациентами), `cases` (медицинские случаи), `documents`, `analytics`, `action-center`, `notifications`, `services`, `rooms`, `settings`, `me`.

Доступ: любая аутентифицированная staff-роль. Гейт на аноним — в `src/proxy.ts` (redirect на `/login`); там же: idle-timeout и 8h-ротация `UserSession`, принудительный TOTP-энролмент, принудительная смена пароля. Тонкое разграничение по ролям делается на уровне API-роутов (`roles: [...]` в `createApiHandler`) и в сайдбаре (`computeVisibleNav` в `src/lib/feature-flags.ts` + флаги тарифа клиники).

### 2.2 Кабинет врача — `src/app/[locale]/doctor/*`

Отдельный воркспейс врача: `my-day`, `schedule`, `visits`, `conclusions`, `patients`, `reception`, `references`, `documents`, `messages`, `analytics`, `notifications`, `settings`. Роадмап и ТЗ лежат прямо в папке (`_ROADMAP.md`, `_WORKSPACE_TZ.md`, `_FINISHING_TZ.md`).

Доступ: **только** роль `DOCTOR` (`src/app/[locale]/doctor/layout.tsx`: не-DOCTOR редиректится в `/crm`). Дополнительно вся поверхность за env-рубильником `DOCTOR_CABINET_ENABLED=1` — при выключенном флаге любой заход отправляется в `/crm?notice=doctor_cabinet_paused` (по комментарию в layout на проде включён; kill-switch сохранён намеренно).

### 2.3 Админ-консоль платформы — `src/app/admin/*`

Control-plane для оператора платформы: `clinics` (тенанты, тарифы, вход «от имени клиники»), `users`, `audit`, `usage`, `health`, `encryption-health`. Вне `[locale]`-сегмента, собственный layout.

Доступ: **только** `SUPER_ADMIN` (`src/app/admin/layout.tsx`; остальным рендерится 403-экран без редиректа). API платформы — `src/app/api/platform/*` (в т.ч. `session/switch-clinic` — вход в клинику по грантy `WRITE`/`VIEW_ONLY`, см. §4) и `src/app/api/admin/*`.

### 2.4 Telegram Mini App пациента — `src/app/c/[slug]/my/*`

Личный кабинет пациента внутри Telegram: `appointments`, `book` (самозапись), `visit`, `documents`, `labs`, `medications`, `family`, `pre-visit` (анкета до приёма), `nps`, `profile`, `account` (включая DSAR: экспорт/удаление данных).

Доступ: без NextAuth. Каждый запрос `/api/miniapp/*` (33 роута) идёт через хелпер `src/server/miniapp/handler.ts`: заголовок `X-Telegram-Init-Data` → HMAC-проверка по bot-токену клиники (`src/server/telegram/auth.ts`) → резолв пациента по `telegramId` внутри клиники → выполнение в контексте `SYSTEM` с обязательным ручным скоупингом `clinicId`+`patientId` в каждом запросе (роли `PATIENT` в системе нет, поэтому TENANT-контекст неприменим).

### 2.5 Публичные экраны и страницы (без аутентификации)

| Роут | Файл | Назначение |
|---|---|---|
| `/tv` | `src/app/tv/page.tsx` | ТВ-табло очереди всей клиники (bento-вёрстка, вызовы с озвучкой). Клиника — `DEFAULT_CLINIC_SLUG` (`neurofax`) или `?c=<slug>` (`src/hooks/use-public-clinic-slug.ts`) |
| `/tv/d/[token]` | `src/app/tv/d/[token]/page.tsx` | Персональное ТВ у кабинета врача; доступ по секретному token, ФИО пациентов — только инициалы (маскирует сервер) |
| `/kiosk` | `src/app/kiosk/page.tsx` | Киоск самозаписи/чек-ина по номеру телефона (API `/api/kiosk/*`, чек-ин под rate-limit) |
| `/q/[id]` | `src/app/q/[id]/page.tsx` | Статус в очереди для пациента (позиция, ETA), поллит `/api/queue/status/[id]` |
| `/t/[code]` | `src/app/t/[code]/page.tsx` | Короткий код с талона → redirect на `/q/<appointmentId>` |
| `/ticket/[id]` | `src/app/ticket/[id]/page.tsx` | Печатный талон (QR, автопечать); PII маскирован до инициалов |
| `/v/[token]` | `src/app/v/[token]/route.ts` | Проверка подлинности документа по QR (заключение/направление): показывает тип, №, дату, клинику, врача и инициалы пациента; **содержимое документа не отдаёт**. Родственные: `/api/verify/recipe/[token]`, `/api/verify/sick-leave/[token]` |
| `/login`, `/login/2fa` | `src/app/login/*` | Вход staff (NextAuth Credentials + TOTP/recovery-код вторым шагом) |
| `/[locale]/(site)` | `src/app/[locale]/(site)/*` | Публичный сайт (лендинг, `doctors`, `privacy`, `terms`); лид-форма шлёт в `/api/leads` (rate-limited) |
| `/[locale]/signup` | `src/app/[locale]/signup/*` | Self-serve регистрация клиники (`/api/public/signup` + `confirm`) |

### 2.6 API — `src/app/api/*` (~300 route.ts)

| Префикс | Кто ходит | Заметки |
|---|---|---|
| `/api/crm/*` | staff-роли по `roles: [...]` | Основной объём (~50 подразделов); всё через `createApiHandler` (§4) |
| `/api/miniapp/*` | пациент (TG initData) | см. §2.4 |
| `/api/platform/*`, `/api/admin/*` | SUPER_ADMIN | управление тенантами, планами, аудитом платформы |
| `/api/c/[slug]/queue/*` | публичные | board/checkin/walkin/lookup/doctors + SSE `events` для ТВ и киоска |
| `/api/events` | staff (сессия) | SSE-стрим событий клиники с replay по `Last-Event-ID` (§6) |
| `/api/telegram/webhook[/[clinicSlug]]` | Telegram | вебхуки ботов (per-clinic) |
| `/api/webhooks/billing/{payme,click}` | платёжные провайдеры | биллинг платформы |
| `/api/queue/status/[id]`, `/api/tv/d/[token]`, `/api/kiosk/*`, `/api/verify/*`, `/api/public/signup`, `/api/leads` | публичные | обслуживают поверхности из §2.5 |
| `/api/auth/[...nextauth]`, `/api/me`, `/api/health`, `/api/internal/metrics`, `/api/calls/sip/event` | смешанные | auth, healthcheck, метрики, телефония |

---

## 3. Карта репозитория

| Папка | Что внутри |
|---|---|
| `src/app/` | App Router: все поверхности из §2 + `globals.css`, корневой `layout.tsx` |
| `src/components/` | UI-библиотека: `atoms/`, `molecules/`, `ui/` (Radix/shadcn-обёртки), `layout/` (сайдбары/топбары CRM), `sections/` (публичный сайт), `providers/`, `motion/`, `dev/` |
| `src/lib/` | Клиент-безопасные и общие утилиты: `api-handler.ts`, `tenant-context.ts`, `prisma.ts`, `tenant-allowlist.ts`, `auth.ts` (NextAuth), `audit.ts`, `rate-limit.ts`, `feature-flags.ts`, `ai-enabled.ts`, доменные хелперы (queue-ordering, appointment-transitions, phone, tashkent-time…) |
| `src/server/` | Серверные модули по доменам: `http.ts` (ответы), `queue/` (адаптер очередей), `workers/` (§6), `realtime/` (event bus + outbox + SSE), `storage/minio.ts`, `telegram/`, `miniapp/`, `notifications/`, `ai/`, `auth/` (TOTP, sessions, policy), `platform/` (тенанты, флаги, биллинг), `schemas/` (Zod), десятки доменных папок (appointments, visit-notes, referrals, dsar, analytics…) |
| `src/messages/` | `ru.json` / `uz.json` — словари next-intl (§8) |
| `src/i18n/` | `routing.ts` (ru default без префикса, uz под `/uz`), `config.ts`, `request.ts`, `navigation.ts` |
| `src/generated/prisma/` | Сгенерированный Prisma-клиент (импортируется как `@/generated/prisma/client`) |
| `src/hooks/`, `src/types/` | React-хуки (live-события, queue board, TG WebApp) и типы |
| `src/proxy.ts` | Next 16 proxy (бывший middleware): auth-гейт CRM, session lifetime, TOTP-редирект, next-intl |
| `src/instrumentation.ts` | Опциональная инициализация Sentry (только при `SENTRY_DSN`) |
| `prisma/` | `schema.prisma` (~80 моделей), `migrations/` (79 миграций), сид-скрипты справочников (drugs, labs, protocols, handouts, presets) |
| `scripts/` | Операционные и dev-скрипты: сиды демо-данных (`seed-mega-neurofax.ts`, `seed-prod-demo.ts`…), стресс-сиды, `i18n-check.ts`, `bootstrap-super-admin.ts`, `rotate-encryption-key.ts`, `encrypt-existing-pii.ts`, TG-вебхук утилиты |
| `docs/` | `TZ.md` + тематические `TZ-*.md` (спеки, **не** as-is), `DESIGN-DOCTRINE.md`, `runbook.md`/`runbooks/`, `progress/LOG.md`, `api/`, `db/`, `security/`, `a11y/`, `perf/`, `audit/`, `i18n/`, `tests/`, `ux/`, макеты PNG |
| `ops/` | `deploy.sh` (git pull → build → up → migrate → healthcheck), `backup.sh`, `restore.sh`, `certbot-init.sh`, `crontab.example`, `migrate-secrets.ts` |
| `tests/` | `unit/` (Vitest, 132 файла), `e2e/` (Playwright: auth, RBAC, пациенты, конфликты записей, очередь, инбокс…) |
| `nginx/`, `Dockerfile`, `Dockerfile.worker`, `docker-compose.yml` | Прод-инфраструктура: nginx-фронт, образ приложения (standalone) и отдельный образ воркера |

---

## 4. Жизненный цикл API-запроса

Типовой роут — это `export const GET/POST = createApiHandler(...)` из `src/lib/api-handler.ts` (для GET без тела — `createApiListHandler`). Обёртка делает, по порядку:

1. **Аутентификация** — `auth()` (NextAuth, JWT с клеймами `userId`/`role`/`clinicId`, конфиг в `src/lib/auth.ts`). Нет сессии → `401`.
2. **RBAC** — `opts.roles`; `SUPER_ADMIN` проходит любую проверку, если явно не запрещён `allowSuperAdmin: false`.
3. **Валидация тела** — Zod `opts.bodySchema`; ошибка → `400 { error: "ValidationError", issues }`.
4. **Tenant-контекст** — `buildContext()`: обычный юзер → `{ kind: "TENANT", clinicId, userId, role }` + опциональный `branchId` из cookie активного филиала (`src/server/platform/branch-cookie.ts`). `SUPER_ADMIN` без активной импертонации клиники получает на мутирующем хендлере `400 ClinicNotSelected`; с импертонацией — синтетический TENANT-контекст со штампом `impersonation`.
5. **VIEW_ONLY-блок** — если SUPER_ADMIN вошёл в клинику в режиме `VIEW_ONLY`, любой не-GET метод отклоняется `403` + best-effort строка в `AuditLog` (`src/lib/view-only.ts`, `emitViewAsBlocked`).
6. **2FA-гейт** — `enforceTotpEnrollment()`: если роль обязана иметь TOTP (`ADMIN` всегда; все роли при `Clinic.require2faForAll`), а `totpEnabledAt` пуст — `403 MFA_REQUIRED`. Дублирует редирект из `src/proxy.ts`, matcher которого не покрывает `/api`. Отключается только через env `DISABLE_2FA=1` (`src/server/auth/security-policy.ts`).
7. **Выполнение** — `runWithTenant(ctx, handler)`: контекст кладётся в AsyncLocalStorage, Prisma-расширение начинает авто-скоупить запросы (§5). Непойманная ошибка → `500 internal_error` с логом.

Чего обёртка **не** делает:

- **Rate limit** — не глобальный. Точечный in-memory `rateLimit(ip, limit, windowMs)` из `src/lib/rate-limit.ts` подключён вручную в чувствительных роутах: login (`/api/auth/[...nextauth]`), `/api/leads`, `/api/crm/me/totp/*`, `/api/kiosk/checkin`. Отдельно есть лимит уведомлений per-patient (`src/server/notifications/rate-limit.ts`) и per-clinic LLM-лимиты (`src/server/ai/llm.ts`).
- **Аудит** — не автоматический. В `ApiHandlerOptions` объявлено поле `audit?: { action, entityType }`, но ⚠️ **обёртка его нигде не читает** (мёртвая опция; ни один роут её и не передаёт). Реальный аудит хендлеры пишут сами: `audit(request, { action, entityType, entityId, meta })` из `src/lib/audit.ts` (fire-and-forget, ошибки глотаются), для server-компонентов — `auditServerPage` из `src/lib/audit-server.ts`.

Ответы собираются хелперами из `src/server/http.ts`: `ok(data, status?)`, `err(message, status, extra?)`, `notFound()`, `forbidden()`, `conflict(reason, extra?)` (→ `409 { error: "conflict", reason }`), плюс `parseQuery(request, zodSchema)` для query-string и `diff(before, after)` для audit-meta.

Минимальный реальный пример — `src/app/api/crm/canned-responses/route.ts`:

```ts
export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateCannedResponseSchema },
  async ({ request, body, ctx }) => {
    const created = await prisma.cannedResponse.create({
      data: { title: body.title, body: body.body, lang: body.lang /* clinicId подставит расширение */ },
    });
    await audit(request, { action: "canned.create", entityType: "CannedResponse", entityId: created.id });
    return ok(created, 201);
  },
);
```

---

## 5. Мульти-тенантность

Каждая операционная модель несёт колонку `clinicId`. Изоляция построена на паре «AsyncLocalStorage-контекст + Prisma-расширение»:

- `src/lib/tenant-context.ts` — `runWithTenant(ctx, fn)` кладёт `TenantContext` в AsyncLocalStorage; `getTenant()`/`requireTenant()`/`getClinicId()`/`getBranchId()` читают его в любом месте вызова. Три вида контекста: `TENANT` (авто-скоуп), `SUPER_ADMIN` (без авто-скоупа — хендлеры `/admin` фильтруют клиники явно), `SYSTEM` (воркеры, cron, сиды, Mini App — без авто-скоупа, скоупинг ручной).
- `src/lib/prisma.ts` — расширение `$extends({ name: "tenantScope" })` на всех моделях: для TENANT-контекста инжектит `clinicId` в `where` (чтения и мутации по фильтру, включая ветку `upsert.create`) и в `data` (create/createMany). Правила-исключения вынесены в `src/lib/tenant-allowlist.ts`: `MODELS_WITHOUT_TENANT` (глобальные справочники, `AuditLog`), `MODELS_TENANT_BYPASSABLE` + флаг `{ skipTenantScope: true }` (например, глобальные FX-курсы из tenant-сессии), `COMPOSITE_TENANT_UNIQUES` (составные уникальные ключи вида `clinicId_slug`, чтобы не дублировать инжекцию).
- Поверх клиники есть второй, опциональный уровень — **филиал**: если TENANT-контекст несёт `branchId` (cookie активного филиала), расширение дополнительно фильтрует модели из `MODELS_BRANCH_SCOPED` (Doctor, Cabinet, Appointment, расписания). Без `branchId` поведение клиник-wide, обратная совместимость сохранена.

Схема данных (~80 моделей в `prisma/schema.prisma`: пациенты/записи/очередь, визит-ноты и медслучаи, документы, чаты, уведомления, биллинг платформы, аудит, шифрование PII и т.д.), связи и договорённости по колонкам описаны отдельно — см. `docs/architecture/DATA-MODEL.md`.

---

## 6. Фоновая обработка

Воркеры живут в **отдельном процессе/контейнере** (`Dockerfile.worker`, CMD `node --import tsx src/server/workers/start.ts`; в compose это сервис `worker`). Точка входа — `src/server/workers/start.ts`.

Очереди — через минимальный интерфейс `QueueAdapter` (`src/server/queue/index.ts`): при заданном `REDIS_URL` работает BullMQ-адаптер (`src/server/queue/bullmq-adapter.ts`; `attempts: 1` — ретраи на совести воркеров; имена с `:` маппятся в BullMQ-безопасные), без Redis — in-memory `setTimeout`-раннер (dev/тесты).

Реальные очереди (имена из кода):

| Очередь | Воркер | Что делает |
|---|---|---|
| `notifications:send` | `notifications-send.ts` | доставка уведомлений (TG); клейм строки `NotificationSend` QUEUED→SENDING |
| `notifications:scheduler` | `notifications-scheduler.ts` | минутный тик: находит due-напоминания, ставит их в `notifications:send` |
| `ai:patient-summary` | `patient-summary-refresh.ts` | LLM-сводка пациента → `Patient.summaryCache` + SSE-событие |
| `ai:voice-soap` | `voice-soap.ts` | голос врача из TG → транскрипция → SOAP-черновик в `MedicalCase.soapDraft` |
| `dsar:export` / `dsar:scheduler` | `data-export.ts` / `data-deletion.ts` | экспорт PII-бандла (шифрование → MinIO → доставка в TG) / исполнение одобренных удалений + чистка бандлов |
| `analytics:refresh` | `analytics-refresh.ts` | часовой `REFRESH MATERIALIZED VIEW CONCURRENTLY` для 4 аналитических MV |
| `analytics:scheduled-reports` | `scheduled-reports.ts` | каждые 5 мин: due-отчёты → PDF/CSV → EMAIL/TELEGRAM |
| `exports` | `exports.ts` | асинхронные CRM-экспорты |

Помимо очередей, `start.ts` запускает интервальные свипы: `outbox-pumper` (200 мс — качает `EventOutbox` в шину, `FOR UPDATE SKIP LOCKED`), `appointment-lifecycle-sweep` (10 мин — просроченные записи → NO_SHOW), `trial-expiry` (60 с — TRIAL→PAST_DUE), Action Center engine (15 мин, `src/server/actions/scheduler.ts`), revenue-планировщики (`src/server/revenue/scheduler.ts` — снапшот пустых слотов ~02:00, реактивация «спящих» пациентов ~07:00), `pre-visit-questionnaire` и `post-visit-nps` (почасовые), `medication-reminder` (почасовой), `visit-note-handout` и `referral-document` (30-секундные durable-свипы, рендерят PDF-документы пациенту). Telegram может работать в режиме long-polling (`TG_USE_POLLING=true`, `src/server/telegram/poll.ts`) — по умолчанию используются per-clinic вебхуки.

**Realtime** тесно связан с воркером: события пишутся в таблицу `EventOutbox` (транзакционно с бизнес-изменением), outbox-pumper доставляет их в in-process `EventBus` и зеркалит в Redis pub/sub для горизонтального фан-аута (`src/server/realtime/*`, публикация — `publishEvent` в `publish.ts` с Zod-валидацией конверта). Браузеры слушают SSE: staff — `/api/events` (replay пропущенного по `Last-Event-ID` из outbox), публичные табло — `/api/c/[slug]/queue/events`. ⚠️ На шине два поколения конвертов (v1/v2) — при парсинге см. `src/server/realtime/envelope.ts`.

---

## 7. Хранилище файлов

Адаптер — `src/server/storage/minio.ts`. Два режима по наличию `MINIO_ENDPOINT`: S3-режим (`@aws-sdk/client-s3` против MinIO) и stub-режим для dev/тестов (файлы в `${os.tmpdir()}/medbook-uploads/...`). Ключи скоупятся конвенцией `clinics/<clinicId>/documents/<uuid>.<ext>` — адаптер сам tenant-agnostic.

Бакет приватный, и наружу файлы отдаются **streaming-прокси, а не presigned-URL**: nginx-локация `/files/` срезает префикс перед проксированием в MinIO, из-за чего подписанный SDK канонический путь не совпадает с тем, что видит MinIO → `SignatureDoesNotMatch`. Поэтому:

- CRM: `GET /api/crm/documents/file?key=...` (`src/app/api/crm/documents/file/route.ts`) — проверяет, что `key` начинается с `clinics/<ctx.clinicId>/`, читает объект через `fetchObject()` по docker-внутреннему эндпоинту и стримит тело с корректными `Content-Type`/`Content-Disposition` (inline по умолчанию, `?download=1` — attachment).
- Mini App: тот же паттерн в `/api/miniapp/documents/[id]/file/route.ts`.

Presign-хелперы (`getSignedUrl`, `getSignedUploadUrl`) в адаптере существуют; единственное найденное боевое использование download-presign — DSAR-экспорт (`src/app/api/crm/dsar/exports/[id]/download/route.ts`, отдельный бакет экспортов). ⚠️ Если presigned-ссылка когда-либо пойдёт через nginx-путь `/files/` — она сломается, это известная граната.

---

## 8. Локализация

next-intl с двумя локалями: `ru` (default, без URL-префикса — `localePrefix: "as-needed"`) и `uz` (под `/uz`). Конфиг — `src/i18n/{config,routing,request,navigation}.ts`, словари — `src/messages/ru.json` и `src/messages/uz.json` (файлы намеренно держатся структурно идентичными; сейчас оба по 7393 строки).

Правило «каждый ключ обязан существовать в обоих файлах» enforce-ится статически: `npm run i18n:check` → `scripts/i18n-check.ts` сканирует `src/**/*.{ts,tsx}` на ссылки `t("...")` (включая литеральные префиксы динамических ключей) и падает с exit 1 при missing-ключах в ru или uz; unused-ключи — warning. Дополнительно `npm run i18n:audit` (`scripts/i18n-miniapp-audit.ts`) — аудит покрытия Mini App. Публичные standalone-экраны (`/kiosk`, `/q/[id]`) держат собственные inline-словари ru/uz в компонентах, вне next-intl.

---

## 9. Время клиники — Asia/Tashkent

**Время клиники — Asia/Tashkent (UTC+5, без переходов). Прод-сервер работает в UTC.** Все таймстемпы хранятся в БД как UTC-инстансы, но «сегодня», границы суток, день недели и отображаемые HH:MM/даты считаются **только** через хелперы:

- `tashkentDayBounds(at?)` / `tashkentDayBoundsForDateString("YYYY-MM-DD")` — полуоткрытое окно `[00:00, 24:00)` ташкентских суток (серверный код: `src/lib/booking-validation.ts`);
- `tashkentComponents(date)` — гражданская дата/время/день-недели/минуты по Ташкенту (там же);
- `toTashkentDate("YYYY-MM-DD","HH:mm")` — обратное преобразование wall-clock → UTC-инстанс;
- клиент-safe зеркало — `src/lib/tashkent-time.ts` (`tashkentPartsOf`, `tashkentToday`, …).

Запрещённые паттерны в серверном коде (`src/app/api/**`, `src/server/**`): `d.setHours(0,0,0,0)`, `d.getHours()/getDay()/getDate()` для границ суток или отображения времени приёма, `toISOString().slice(0,10)` как «дата» и `toLocaleDateString(...)` без `timeZone: "Asia/Tashkent"` — всё это server-local (= UTC на проде) и смещает сутки на 5 часов: с 00:00 до 05:00 по Ташкенту сервер ещё живёт «вчера». Параметр `date=YYYY-MM-DD` из браузера всегда интерпретируется как ташкентская дата (`tashkentDayBoundsForDateString`). `DoctorSchedule.startTime/endTime` — ташкентские wall-clock строки; сравнивать их можно только с ташкентскими часами. Так как переходов на летнее время нет, шаг «N×24 часа» от ташкентской полуночи всегда попадает в ташкентскую полуночь — этим пользуются недельные/месячные окна аналитики. Контракт закреплён тестом `tests/unit/tashkent-day-boundary.test.ts`.

---

## 10. Что не реализовано / выключено

- **AI выключен глобально.** `src/lib/ai-enabled.ts`: жёстко зашитая константа `export const AI_ENABLED = false` (не env). Все AI-панели в CRM/кабинете врача либо скрыты, либо показаны как «в разработке» (`src/components/ui/in-development.tsx`; ~15 компонент читают флаг). При этом серверная обвязка **написана и живёт в коде**: LLM-прокси с PII-редакцией, лимитами и кэшем (`src/server/ai/llm.ts`, провайдер `anthropic | mock`), SOAP из голоса, сводки пациента, ICD-10 подсказки, эвристики очереди (`src/lib/ai/*`). ⚠️ Воркеры `patient-summary-refresh` и `voice-soap` запускаются в worker-процессе независимо от `AI_ENABLED` — флаг гейтит UI, а не пайплайн.
- **SMS удалён** (`docs/TZ-sms-removal.md` — исполнено в коде): роутов `/api/sms/*` нет, исходящих SMS write-paths нет, единственный внешний канал уведомлений — Telegram. Легаси-остатки сознательные: исторические строки с `channel=SMS` читаются как «(legacy)», старые шаблоны с литералом `"SMS"` резолвятся в «нет канала» и всплывают как задача обзвона (`src/server/notifications/no-channel-action.ts`, `rules.ts`).
- **Кабинет врача за kill-switch** — env `DOCTOR_CABINET_ENABLED` (§2.2); флаг оставлен намеренно до «устойчиво зелёного окна».
- **2FA можно отключить целиком** через `DISABLE_2FA=1` (`src/server/auth/security-policy.ts`) — предназначено для dev/тестов; на проде полагается быть незаданным (⚠️ по коду не проверяется, что это prod-safe).
- **`opts.audit` в `createApiHandler`** объявлен, но не реализован — аудит только ручной (§4).
- **Sentry опционален** — инициализируется в `src/instrumentation.ts` только при `SENTRY_DSN`; сам пакет `@sentry/nextjs` в `package.json` отсутствует (динамический импорт с graceful-фолбэком).
- **Роль пациента отсутствует** — Mini App работает через `SYSTEM`-контекст с ручным скоупингом (§2.4); это осознанное архитектурное решение, а не долг.
- Провайдеры LLM кроме Anthropic (`openai`/`ollama`) — только упомянуты в комментарии `llm.ts`, кода нет.

---

*Проверено по коду: 2026-08. Соседний документ: `docs/architecture/DATA-MODEL.md` (модель данных).*
