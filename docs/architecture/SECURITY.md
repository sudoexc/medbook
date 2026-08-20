# SECURITY.md — безопасность MedBook / NeuroFax «как есть»

> Документ описывает **фактическую** реализацию по состоянию кода (проверено по
> исходникам, не по спекам). Спеки и аудиты для контекста:
> `docs/security/checklist.md`, `docs/security/phase-7.md`,
> `docs/TZ-security-hardening.md`. Там, где спека расходится с кодом, приоритет
> у кода — расхождения помечены явно. Непроверенные утверждения помечены
> «⚠️ требует проверки».

## Оглавление

1. [Аутентификация](#1-аутентификация)
2. [Двухфакторка (TOTP)](#2-двухфакторка-totp)
3. [Роли и доступ (RBAC)](#3-роли-и-доступ-rbac)
4. [Изоляция клиник (multi-tenant)](#4-изоляция-клиник-multi-tenant)
5. [Шифрование](#5-шифрование)
6. [Аудит](#6-аудит)
7. [Файлы и приватность](#7-файлы-и-приватность)
8. [Rate limiting и защита от перебора](#8-rate-limiting-и-защита-от-перебора)
9. [Персональные и медицинские данные (DSAR)](#9-персональные-и-медицинские-данные-dsar)
10. [Секреты и окружение](#10-секреты-и-окружение)
11. [Чеклист перед продом](#11-чеклист-перед-продом)
12. [Известные ограничения](#12-известные-ограничения)

---

## 1. Аутентификация

### Чем реализована

**NextAuth 5 (beta)** с единственным провайдером `Credentials`
(email + password) — `src/lib/auth.ts`. Пароли хранятся как **bcryptjs-хэши**
(cost 10, см. `src/server/auth/password.ts` и
`src/app/api/crm/users/route.ts`), сверка через `bcrypt.compare`.
Неактивный пользователь (`User.active = false`) отклоняется в `authorize()`.

### Сессии — два слоя

**Слой 1 — JWT (NextAuth).** `session.strategy = "jwt"`,
`maxAge = 24h`, `updateAge = 1h` (`src/lib/auth.ts`). В JWT кладутся клеймы
`userId`, `role`, `clinicId`, `mustChangePassword`, а для SUPER_ADMIN — данные
импер­сонации. Cookie ставит NextAuth (HttpOnly, SameSite=Lax, Secure в prod —
подтверждено аудитом `docs/security/phase-7.md`, раздел «Session / JWT»).

**Слой 2 — серверная `UserSession`** (`src/server/auth/user-session.ts`,
модель в `prisma/schema.prisma`). При каждом логине:

- генерируется токен `randomBytes(32)` (base64url, ~256 бит энтропии);
- в Postgres хранится **только `sha256(token)`** (`UserSession.tokenHash`);
- плейнтекст уходит в cookie `crm_user_session` (HttpOnly, SameSite=Lax,
  Secure в prod, `maxAge = 8h`);
- **все прежние сессии пользователя убиваются** («1 активная сессия на
  пользователя», `pickSessionsToKick` в `src/server/auth/session-security.ts`)
  с аудит-записью `CONCURRENT_SESSION_KICKED` на каждую.

### Время жизни (enforcement в `src/proxy.ts`)

Прокси (Next 16 proxy, бывший middleware) на каждый `/crm`-запрос:

| Проверка | Порог | Где |
| --- | --- | --- |
| Idle timeout | `Clinic.sessionIdleTimeoutMinutes`, default 30 мин, clamp [5, 240] | `checkSessionLifetime` в `src/server/auth/session-security.ts` |
| Принудительная ре-ротация | 8 часов от `User.lastSessionRotatedAt` независимо от активности | там же, `FORCED_REROTATE_MS` |
| Отсутствующая строка UserSession | немедленный logout (`reason=expired`) | `src/proxy.ts` |

При срабатывании — cookie гасится, редирект на `/login?reason=…`, строка
сессии удаляется, пишется аудит `SESSION_TIMEOUT_LOGOUT` /
`SESSION_FORCED_REROTATE`. `lastActivityAt` бампается на каждый живой хит.

⚠️ Прокси **fail-open** при недоступности БД на проверке lifetime (комментарий
«DB unreachable — fail open» в `src/proxy.ts`) — сам JWT при этом всё ещё
обязателен. Матчер прокси исключает `/api` — для API этот слой не работает
(компенсируется 24h JWT + MFA-гейтом, см. §2).

### Логин-поток

1. `/login` → `POST /api/auth/callback/credentials`
   (обёртка с rate limit 5 req/min/IP —
   `src/app/api/auth/[...nextauth]/route.ts`).
2. `authorize()` ищет пользователя под `runWithTenant({kind:"SYSTEM"})`,
   сверяет bcrypt.
3. Если у пользователя включён TOTP — пароль без второго фактора отклоняется
   (`return null`); клиент через пре-флайт `GET /api/crm/auth/totp-required`
   понимает, что пароль верный, и уводит на `/login/2fa`, где собирается TOTP
   **или** recovery-код и сабмит повторяется.
4. В `jwt`-коллбеке минтится `UserSession` (см. слой 2), стампуются
   `User.lastSessionRotatedAt` и `lastLoginAt`.
5. `mustChangePassword = true` (временный пароль от админа) → прокси
   принудительно редиректит на `/crm/me/change-password` до смены.

Деактивация пользователя подхватывается при рефреше JWT (`trigger ===
"update"` перечитывает `active` и инвалидирует токен), но у пассивных сессий
есть дрейф **до 1 часа** (`updateAge`) — задокументировано в `src/lib/auth.ts`.

### Восстановление доступа

- **Пароль:** self-service reset **отсутствует** — новый временный пароль
  выдаёт админ (`src/app/api/crm/users/[id]/reset-password/route.ts`,
  `generateTempPassword` в `src/server/auth/password.ts`), после чего работает
  форс-редирект `mustChangePassword`.
- **Recovery-коды 2FA** (`src/server/auth/recovery-codes.ts`):
  - 10 кодов формата `XXXX-XXXX-XXXX`, алфавит без неоднозначных символов
    (нет I/O/0/1), ≈60 бит энтропии;
  - показываются **ровно один раз** при энролле/регенерации; в
    `User.recoveryCodesHash` — только bcrypt (cost 10);
  - одноразовые: использованный хэш удаляется из массива;
  - `consumeRecoveryCode` сверяет вход **со всеми** хэшами даже после
    совпадения (защита от timing-утечки позиции), вход нормализуется
    (регистр/дефисы/пробелы);
  - использование пишет аудит `RECOVERY_CODE_USED` c остатком кодов
    (`src/lib/auth.ts`).
  - Тест `tests/unit/recovery-codes.test.ts` фиксирует: формат/алфавит,
    уникальность батча, одноразовость, нормализацию ввода, отказ по мусорному
    вводу без затрат bcrypt, иммутабельность массива хэшей у вызывающего.

---

## 2. Двухфакторка (TOTP)

### Реализация

Собственный RFC 6238 на `node:crypto` (`src/server/auth/totp.ts`): SHA-1 HMAC,
6 цифр, шаг 30 с, окно верификации **±1 шаг**, сравнение через
`timingSafeEqual`. Секрет — 20 байт (RFC 4226 §4), base32. QR — стандартный
`otpauth://` URI.

### Как включается

1. `POST /api/crm/me/totp/enroll` — требует **повторный ввод пароля**, rate
   limit 5 попыток / 15 мин на пользователя. Секрет пинится на строке
   пользователя (`pendingTotpSecret` + `pendingTotpExpiresAt`, TTL 10 минут).
2. `POST /api/crm/me/totp/verify` — код сверяется против
   `pendingTotpSecret` **из БД, а не от клиента** (закрывает вектор: угнанная
   сессия не может подсунуть свой секрет). Успех → промоушен в
   `totpSecret` + `totpEnabledAt`, генерация 10 recovery-кодов (плейнтекст
   возвращается один раз), аудит `TOTP_ENROLLED`.
3. `POST /api/crm/me/totp/disable`, `POST
   /api/crm/me/totp/recovery-codes/regenerate` — с теми же rate limit.

⚠️ **`User.totpSecret` и `pendingTotpSecret` хранятся в БД плейнтекстом.**
Комментарий в `prisma/schema.prisma` («totpSecret (encrypted)») отражает
намерение, но в коде (`totp/verify/route.ts`) шифрование не применяется — ни
`field-cipher`, ни `secrets.ts`. См. §12.

### Где принудительно требуется

`src/server/auth/security-policy.ts`:

- `MANDATORY_2FA_ROLES = { SUPER_ADMIN, ADMIN }` — **всегда** обязаны
  энроллиться;
- остальные роли — если у клиники `Clinic.require2faForAll = true`;
- предикат `requiresTotpEnrollment({ role, clinicRequire2faForAll })`.

Гейт стоит **в двух местах** (двойной, потому что матчер прокси исключает `/api`):

1. **Страницы:** `src/proxy.ts` — обязанный, но не энроллённый пользователь
   редиректится на `/crm/me/security` (энролл-страница и смена пароля
   исключены из редиректа, чтобы не зациклиться).
2. **API:** `enforceTotpEnrollment` в `src/lib/api-handler.ts` — тот же
   предикат, но для каждого запроса через `createApiHandler` /
   `createApiListHandler`. Не энроллен → `403 { error: "MFA_REQUIRED" }`.
   Исключены только `/api/crm/me/totp/**` и `/api/crm/auth/totp-required`
   (`isTotpEnrollmentExemptPath` — точный префикс, не bare `startsWith`),
   иначе энроллиться было бы невозможно.

Если TOTP включён, но на логине не предоставлен ни код, ни recovery-код —
`authorize()` возвращает `null` (логин отклонён), см. §1.

### Kill switch

`DISABLE_2FA=1` (`is2faDisabled()`) отключает **всё**: логин-гейт, оба
enrolment-гейта, пре-флайт. Предназначен для dev/staging и краткосрочного
ops-байпаса. В проде обязан быть не установлен (см. §11).
Гейт «2FA доступна по плану клиники» — ⚠️ есть тест
`tests/unit/clinic-2fa-plan-gate.test.ts`, детали плана не проверялись.

---

## 3. Роли и доступ (RBAC)

### Все роли (enum `Role`, `prisma/schema.prisma`)

`SUPER_ADMIN`, `ADMIN`, `DOCTOR`, `RECEPTIONIST`, `NURSE`, `CALL_OPERATOR`.

Ролей «PATIENT» **нет** — пациентские поверхности (Mini App) аутентифицируются
Telegram initData, не NextAuth (см. §4). Отдельный псевдо-актор `TERMINAL`
существует только как метка в аудите для запросов с валидным PIN ресепшн-
терминала (`src/lib/audit.ts`, `src/lib/pin.ts`).

### Роль → доступ (сводно, по фактическим `roles: [...]` в роутах)

| Роль | Область | Основание |
| --- | --- | --- |
| `SUPER_ADMIN` | Платформа: `/admin`, `/api/platform/*` (клиники, планы, инвойсы, платформенный аудит, encryption-health). Тенантские данные — **только** через импер­сонацию (см. §4). По умолчанию проходит любой `roles: [...]`-гейт CRM (`allowSuperAdmin !== false`), но без выбранной клиники `/api/crm/*` отвечает 400 `ClinicNotSelected` | `src/server/platform/handler.ts`, `src/lib/api-handler.ts` |
| `ADMIN` | Всё в своей клинике: настройки, пользователи, интеграции, аудит (`/api/crm/audit`), DSAR-экспорты/удаления, отчёты | `roles: ["ADMIN"]` — самый частый гейт в `/api/crm/**` |
| `DOCTOR` | Кабинет врача: visit notes, назначения, рецепты, лабы, напоминания, AI-инструменты | `roles: ["DOCTOR"]` в `/api/crm/**` (doctor-поверхности) |
| `RECEPTIONIST` | Приёмы, пациенты, календарь, платежи, документы, очередь | комбинированные списки (`["ADMIN","RECEPTIONIST",...]`) |
| `NURSE` | Чтение пациентов/приёмов, документы — подмножество ресепшна | входит в широкие списки, отсутствует в админских |
| `CALL_OPERATOR` | Звонки, разговоры/чаты, подтверждения записей | `["ADMIN","RECEPTIONIST","CALL_OPERATOR"]` и широкие списки |

Точная матрица — это объединение `roles: [...]` по ~200 роутам
`/api/crm/**`; таблица выше — обобщение фактического распределения
(наиболее частые списки: `["ADMIN"]`, полный список из 5 ролей,
`["DOCTOR"]`, `["ADMIN","RECEPTIONIST","CALL_OPERATOR"]`).

### Как проверяется в API

`createApiHandler(opts, handler)` / `createApiListHandler`
(`src/lib/api-handler.ts`), порядок:

1. `auth()` — нет сессии → **401**.
2. `checkRoles`: роль не в `opts.roles` → **403** (`SUPER_ADMIN` проходит,
   если `allowSuperAdmin !== false`).
3. Zod-валидация тела (`opts.bodySchema`) → 400 на невалидном.
4. Построение `TenantContext` (роль/клиника из **сессии**, никогда из тела
   запроса) + чтение branch-cookie.
5. `SUPER_ADMIN` без импер­сонации → 400 `ClinicNotSelected`.
6. VIEW_ONLY-импер­сонация + мутирующий метод → 403 + аудит
   `SUPER_ADMIN_VIEW_AS_BLOCKED`.
7. MFA-гейт (§2).
8. Хендлер выполняется внутри `runWithTenant(ctx, …)`.

Отдельные фабрики: `createPlatformHandler` (только SUPER_ADMIN,
`src/server/platform/handler.ts`) и `createMiniAppHandler`
(пациентская поверхность, `src/server/miniapp/handler.ts`).

---

## 4. Изоляция клиник (multi-tenant)

Самый важный механизм для меддданных. Три уровня.

### 4.1 TenantContext в AsyncLocalStorage

`src/lib/tenant-context.ts`. Виды контекста:

- `TENANT { clinicId, userId, role, branchId?, impersonation? }` — обычный
  сотрудник клиники;
- `SUPER_ADMIN { userId }` — платформенный оператор, **без** авто-скоупа;
- `SYSTEM` — кроны/воркеры/вебхуки/онбординг, **без** авто-скоупа.

`runWithTenant(ctx, fn)` связывает контекст со всей async-цепочкой запроса.
Фабрики хендлеров (§3) делают это автоматически.

### 4.2 Prisma-расширение `tenantScope`

`src/lib/prisma.ts` (`$extends` → `$allModels.$allOperations`) + таблицы
политики в `src/lib/tenant-allowlist.ts`:

- Для `TENANT`-контекста в каждый запрос к модели с колонкой `clinicId`
  **инжектится** `clinicId` из контекста:
  - чтения и мутации-по-фильтру (`findMany`, `update`, `delete`, `upsert`…)
    → в `where` (если `clinicId` уже запинен напрямую или через composite
    unique из `COMPOSITE_TENANT_UNIQUES` — не дублируется);
  - `create` / `createMany` → в `data` (включая payload `upsert.create`).
- `MODELS_WITHOUT_TENANT` (Clinic, User, AuditLog, глобальные каталоги
  Drug/LabTest/Plan и т.п.) — расширение не трогает; роуты, читающие их
  кросс-тенантно (например DiagnosisGuide c `clinicId IN (null, ctx)`)
  скоупят вручную.
- `MODELS_TENANT_BYPASSABLE` (ExchangeRate, ProviderConnection) — единственные
  модели, где разрешён точечный опт-аут `{ skipTenantScope: true }`.
- **Branch-скоуп (Phase 9a):** если в контексте есть `branchId`, для моделей
  из `MODELS_BRANCH_SCOPED` (Doctor, Cabinet, Appointment, DoctorSchedule,
  DoctorTimeOff) поверх `clinicId` инжектится второй фильтр `branchId`;
  клиникоширокие модели (Patient, Payment…) не затрагиваются.

Итого: хендлер **физически не может** прочитать или изменить строку чужой
клиники через Prisma-модели — `where` всегда содержит `clinicId` текущего
тенанта, а `create` всегда пишет его в данные.

### 4.3 Что будет при забытом контексте — честно

**Расширение fail-open.** Если код вызывает `prisma.*` вне `runWithTenant`
(нет контекста в ALS), запрос **проходит без инжекции** — комментарий в
`src/lib/prisma.ts`: «No context → pass through». То же для `SYSTEM` и
`SUPER_ADMIN` контекстов — это осознанные «привилегированные» режимы.
Утверждение из `docs/security/phase-7.md` («extension refuses to run any
query… outside runWithTenant») **не соответствует коду** — отказа нет,
есть тихий пропуск.

Компенсирующие меры:

- весь аутентифицированный ingress идёт через фабрики хендлеров, которые
  оборачивают в `runWithTenant` безусловно;
- `requireTenant()` доступен для явного ассерта;
- `docs/security/checklist.md` §3 требует при `SYSTEM`-контексте явный
  `clinicId` в каждом `where` (так и сделано в вебхуках/кронах/Mini App);
- единственный оставшийся `@ts-nocheck`-роут — `src/app/api/telegram/webhook/route.ts`
  (возвращает только 410 GONE). Исторические дыры S-1…S-4 из
  `docs/TZ-security-hardening.md` (тикет `/ticket/[id]`, kiosk, leads)
  по коду исправлены: тикет маскирует ФИО до инициалов и делает узкий
  `select`, kiosk/leads скоупятся через `resolvePublicClinic` + rate limit.
  ⚠️ Роуты `src/app/api/queue/**`, `tv-queue` на предмет остаточного
  legacy-скоупа детально не перепроверялись в этом документе.

### 4.4 SUPER_ADMIN и импер­сонация (платформенные исключения)

- Без импер­сонации SUPER_ADMIN не видит тенантские данные через `/api/crm`
  (400 `ClinicNotSelected`); `/api/platform/*` работает в
  `SUPER_ADMIN`-контексте, где каждый хендлер обязан скоупить руками.
- Вход в клинику: cookie `admin_clinic_override` = `clinicId.HMAC-SHA256`
  (ключ `APP_SECRET`, `src/server/platform/clinic-override.ts`,
  constant-time сравнение) **плюс** cookie `admin_grant_id` → строка
  `ImpersonationGrant` (lease **60 минут**, mode `WRITE` | `VIEW_ONLY`,
  `src/server/platform/impersonation.ts`).
- JWT-коллбек (`src/lib/auth.ts`) на каждый рефреш перепроверяет грант и
  **fail-closed**: грант отсутствует/истёк/не совпал с клиникой, или БД не
  ответила — override сбрасывается. Это закрывает S-5 из
  `docs/TZ-security-hardening.md` (override-cookie переживал grant).
- `VIEW_ONLY` блокирует все мутирующие методы на уровне `createApiHandler`
  с аудитом `SUPER_ADMIN_VIEW_AS_BLOCKED`; старт/конец/истечение
  импер­сонации аудируются (`SUPER_ADMIN_IMPERSONATE_*`).

### 4.5 Mini App (пациентская поверхность)

`src/server/miniapp/handler.ts`: HMAC-верификация Telegram `initData` по
токену бота клиники (`verifyMiniAppInitData`,
`src/server/telegram/auth.ts` — constant-time, окно свежести 24h), резолв
пациента по `(clinicId, telegramId)`. Хендлеры работают в `SYSTEM`-контексте,
поэтому **обязаны** вручную включать `clinicId`/`patientId` в каждый запрос —
изоляция здесь конвенциональная, а не автоматическая. Dev-байпас
(`x-miniapp-dev-bypass`) активен только при `NODE_ENV !== "production"`.

### 4.6 Тесты, закрепляющие изоляцию

- `tests/unit/prisma-branch-scope.test.ts` — прогоняет захваченный
  `$extends`-хук на синтетических запросах (без БД) и гарантирует:
  - `TENANT` без `branchId`: `clinicId` инжектится, `branchId` — нет
    (поведение клиникошироко и обратносовместимо);
  - `TENANT` с `branchId`: на branch-скоупных моделях пинятся **оба** фильтра
    (`where` для чтений, `data` для create), включая случай composite-ключа
    `clinicId_slug` (без дублирования `clinicId`);
  - клиникоширокие модели (Patient) branch-фильтр **не** получают;
  - явный `branchId` в данных пользователя не перезатирается ambient-значением.
- `tests/unit/prisma-tenant.test.ts` — базовое поведение clinicId-инжекции
  (упомянут в шапке branch-теста; ⚠️ содержимое отдельно не читалось).
- `tests/unit/tenant-allowlist.test.ts` — пинит инвариант «все модели без
  clinicId перечислены в `MODELS_WITHOUT_TENANT`».

---

## 5. Шифрование

Два независимых шифра, оба AES-256-GCM с формaтом
`v<n>:<iv_b64>:<tag_b64>:<ct_b64>` (12-байтный случайный IV, 16-байтный
auth tag → тампер детектится на decrypt).

### 5.1 Секреты интеграций — `src/server/crypto/secrets.ts`

- Ключ: `scryptSync(APP_SECRET, "medbook-secret-v1", 32)`; **фолбэк на
  `AUTH_SECRET`**, если `APP_SECRET` не задан.
- Применение: секреты `ProviderConnection.config` (SIP/Telegram/прочие
  интеграции) — шифруются при записи в
  `src/app/api/crm/integrations/route.ts`,
  `src/app/api/platform/clinics/[id]/integrations/route.ts`,
  `src/app/api/platform/integrations/[id]/route.ts`; в UI отдаётся только
  маска `maskSecret` (буллеты + последние 4 символа).
- Ротация версии формата заложена (`v1:`), автоматической ротации ключа нет —
  смена `APP_SECRET` делает старые шифртексты нечитаемыми (KDF-ключ единый).

### 5.2 PII-поля — `src/server/crypto/field-cipher.ts`

Шифрование на уровне приложения (не pgcrypto — обоснование в
`docs/runbooks/encryption-key-rotation.md`): дамп Postgres без ключа из env
бесполезен атакующему.

| Таблица | Колонка | Границный хелпер |
| --- | --- | --- |
| `Patient` | `passport`, `notes` | `src/server/patient/cipher-fields.ts` |
| `MedicalCase` | `soapDraft` | `src/server/medical-case/cipher-fields.ts` |
| `Prescription` | `notes` | `src/server/prescription/cipher-fields.ts` |

Сознательно **не** шифруются (нужны для поиска/join/крона): `fullName`,
`phoneNormalized`, `email`, `telegramId`, `birthDate`, `address` — блайнд-
индексы отложены как отдельное архитектурное решение.

**Ключи и ротация:**

- `FIELD_ENCRYPTION_KEY_V<n>` (активный = наибольший n) или легаси
  `FIELD_ENCRYPTION_KEY` (= v1); base64 ровно 32 байт.
- Прод **fail-closed**: без ключа приложение отказывается стартовать. Вне
  прода — детерминированный dev-ключ с warn-логом.
- Запись всегда активной версией; чтение — по версии из префикса шифртекста →
  **zero-downtime ротация**: добавить `_V2`, рестарт, прогнать
  `scripts/rotate-encryption-key.ts` (батчи по 200, идемпотентно), убедиться
  в нулях по v1 на `/admin/encryption-health`, удалить `_V1`. Полный ранбук:
  `docs/runbooks/encryption-key-rotation.md` (включая процедуру компрометации
  ключа и «я потерял ключ» — данные невосстановимы).
- Health-роут `GET /api/admin/encryption-health` (SUPER_ADMIN, аудит
  `ENCRYPTION_HEALTH_CHECKED`): активная версия, счётчики строк по версиям,
  probe round-trip.

### 5.3 Прочее шифрование/хэширование

- DSAR-выгрузка: ZIP c `data.json.enc` — AES-256-GCM, ключ из
  scrypt(passphrase, salt, N=16384) (`src/server/dsar/zip.ts`); passphrase
  24 символа, показывается один раз, в БД — bcrypt-хэш
  (`DataExportJob.passphraseHash`).
- Session-токены — sha256 (§1); пароли/recovery-коды/DSAR-passphrase — bcrypt.
- **Не шифруется** (см. §12): `User.totpSecret`, `Clinic.tgBotToken`.

---

## 6. Аудит

### Модель

`AuditLog` (`prisma/schema.prisma`): `clinicId?` (null = платформенное
действие), `actorId/actorRole/actorLabel`, `action`, `entityType/entityId`,
`meta` (JSON, diff «before/after» через `diff()` из `src/server/http.ts`),
`ip`, `userAgent`, `createdAt`, плюс поля связки с realtime
(`eventId/surface/correlationId` — пишет outbox-пампер). Модель в
`MODELS_WITHOUT_TENANT` — `clinicId` всегда проставляется явно.

### Кто пишет

| Писатель | Файл | Когда |
| --- | --- | --- |
| `audit(request, {...})` | `src/lib/audit.ts` | API-роуты; **fire-and-forget** — ошибка записи логируется, но не роняет запрос |
| `auditServerPage(...)` | `src/lib/audit-server.ts` | server components (страницы) — синтетический Request из `headers()` |
| `platformAudit(...)` | `src/server/platform/handler.ts` | `/api/platform/*`, актор всегда SUPER_ADMIN |
| прямые `prisma.auditLog.create` | `src/lib/auth.ts`, `src/proxy.ts`, `src/server/auth/user-session.ts`, `src/lib/api-handler.ts` | логин-события (RECOVERY_CODE_USED), кики сессий, VIEW_ONLY-блоки |
| outbox-пампер | `src/server/realtime/**` (⚠️ путь по описанию схемы) | materialization `auditable:true` событий EventOutbox |

Каталог действий — `src/lib/audit-actions.ts` (константа `AUDIT_ACTION`,
~130 действий): жизненный цикл приёмов, DSAR (`PATIENT_DATA_EXPORT_*`,
`PATIENT_ANONYMIZED`, `PATIENT_HARD_DELETED`), безопасность (`TOTP_*`,
`RECOVERY_*`, `SESSION_*`, `CONCURRENT_SESSION_KICKED`,
`SUPER_ADMIN_IMPERSONATE_*`, `ENCRYPTION_*`), биллинг, отчёты, AI
(`LLM_CALL`, `AI_QUERY_ASKED`) и т.д. В `src/app/api` ~185 вызовов `audit(`.

### PHI-доступ отдельно: `PatientView`

`src/server/audit/patient-view.ts` + модель `PatientView`: «кто открыл
карточку пациента» с контекстом (`patient.detail`, `appointment.drawer`,
`case.detail`, `export`), снапшотом роли, IP/UA; троттлинг — 1 строка на
(viewer, patient, context) за 5 минут. Просмотр этого журнала сам аудируется
(`PATIENT_VIEW_AUDIT_ACCESSED`).

### Как читать

- **CRM:** страница `/crm/settings/audit`
  (`src/app/[locale]/crm/settings/audit/page.tsx`) → `GET /api/crm/audit`
  (`roles: ["ADMIN"]`, фильтры по действию/сущности/актору/датам,
  cursor-пагинация; для TENANT принудительно `where.clinicId = ctx.clinicId`).
  PHI-журнал: `GET /api/crm/audit/patient-views`.
- **Платформа:** `/admin/audit` → `GET /api/platform/audit` (SUPER_ADMIN).

### Ограничение

Аудит fire-and-forget: при недоступности Postgres строка **тихо теряется**
(осознанно, finding L2 в `docs/security/phase-7.md`). Очереди-фолбэка нет.

---

## 7. Файлы и приватность

### Хранилище

MinIO, **приватный бакет** (анонимный GET → 403). Адаптер —
`src/server/storage/minio.ts`; ключи по конвенции
`clinics/<clinicId>/…` (documents / chat / exports).

### Почему стриминг через API, а не presigned-ссылки

Две причины, зафиксированные в коде:

1. приватный бакет — «голый» `MINIO_PUBLIC_URL/...` отдаёт AccessDenied;
2. presigned-подпись **не переживает** nginx-рерайт префикса `/files/`
   (канонический путь в подписи расходится с тем, что видит MinIO →
   `SignatureDoesNotMatch`) — комментарии в
   `src/app/api/crm/documents/file/route.ts` и
   `src/app/api/crm/conversations/[id]/attachments/file/route.ts`.

Поэтому байты всегда идут через `fetchObject()` (docker-internal endpoint) и
стримятся ответом Next-роута.

### Роуты выдачи

| Роут | Аутентификация | Скоуп |
| --- | --- | --- |
| `GET /api/crm/documents/file?key=…` | `createApiListHandler`, роли ADMIN/RECEPTIONIST/DOCTOR/NURSE | ключ обязан начинаться с `clinics/<ctx.clinicId>/` → 403 иначе |
| `GET /api/miniapp/documents/[id]/file` | Telegram initData (Mini App handler) | по строке Document пациента |
| `GET /api/crm/conversations/[id]/attachments/file?key=…` | **нет** (capability-URL, осознанно) | ключ обязан содержать `clinics/…/chat/<этот conversationId>/…`, `..` отвергается |
| `GET /api/crm/exports/[jobId]/download` | роль ADMIN | DSAR-бандл (сам зашифрован passphrase, §5.3) |

### Capability-URL вложений чата — проверено по коду

`src/app/api/crm/conversations/[id]/attachments/file/route.ts` намеренно без
сессии: один и тот же URL рендерится оператору CRM, пациенту в Mini App и
отдаётся Telegram (который фетчит из публичного интернета без куки).
Модель доверия: неугадываемый object key (cuid клиники + cuid разговора +
случайный uuid имени файла) **и есть** токен доступа — тот же уровень
доверия, что доставка файла в Telegram-чат пациента. Роут жёстко пинит ключ
к префиксу чата данного разговора — прочитать документы пациентов, DSAR-
экспорты или чужой разговор через него нельзя. Утечка ключа = доступ к
файлу; TTL нет (см. §12).

Политика загрузки чата (`src/lib/chat-attachments.ts`): MIME-allowlist
(изображения + офисные форматы), лимит 20 MB, максимум 10 вложений.

---

## 8. Rate limiting и защита от перебора

Базовый лимитер — `src/lib/rate-limit.ts`: **in-memory `Map`** per-process,
окно по умолчанию 60 с / 10 запросов.

| Где | Ключ | Лимит | Файл |
| --- | --- | --- | --- |
| `POST /api/auth/*` (логин) | IP | 5 / мин (429 + `retry-after: 60`) | `src/app/api/auth/[...nextauth]/route.ts` |
| `POST /api/leads` (публичная форма) | IP | 10 / мин | `src/app/api/leads/route.ts` |
| `GET /api/kiosk/checkin` (перебор телефонов) | IP | 10 / мин | `src/app/api/kiosk/checkin/route.ts` |
| TOTP enroll / verify / disable / regen | userId | 5 / 15 мин каждый | `src/app/api/crm/me/totp/*/route.ts` |
| PIN терминала | IP | 5 фейлов / 15 мин → lockout 15 мин; constant-time сравнение; без `RECEPTIONIST_PIN` в env — fail closed | `src/lib/pin.ts` |

Байпас логин-троттла: `DISABLE_AUTH_RATE_LIMIT=1` (для e2e; в проде должен
быть не установлен). `src/server/notifications/rate-limit.ts` — отдельный
механизм (анти-спам уведомлений пациентам), к безопасности логина отношения
не имеет.

**Ограничение:** лимитер per-process — сбрасывается на рестарте и не
кластер-safe (multi-pod = N × лимит). Известный finding M3
(`docs/security/phase-7.md`), запланирован свап на Redis. Ключ — из
`x-forwarded-for` (первый хоп), т.е. корректность зависит от честности
reverse-proxy.

---

## 9. Персональные и медицинские данные (DSAR)

Phase 17 Wave 3. Две независимые джобы, обе тенант-скоупные
(`prisma/schema.prisma`, модели `DataExportJob`, `DataDeletionJob`).

### Экспорт (`DataExportJob`)

- Инициатор: пациент из Mini App или ADMIN из CRM
  (`src/app/api/crm/patients/[id]/data-export`, `/api/crm/exports*`,
  `/api/crm/dsar/exports*`).
- Воркер `src/server/workers/data-export.ts`: собирает JSON-бандл
  (`src/server/dsar/bundle.ts`), шифрует ZIP passphrase-ом (§5.3), кладёт в
  MinIO `exports/<clinicId>/<jobId>.zip`, доставляет через клинического
  Telegram-бота. Passphrase показывается один раз; в БД — bcrypt-хэш.
- Статусы `PENDING → PROCESSING → READY → DELIVERED / FAILED / EXPIRED`;
  срок жизни бандла 30 дней (`expiresAt`, экспайри —
  `src/server/dsar/expiry.ts`), `downloadCount` инкрементится.
- Аудит: `PATIENT_DATA_EXPORT_REQUESTED / GENERATED / DELIVERED /
  DOWNLOADED / FAILED`.

### Удаление (`DataDeletionJob`)

- Режимы: **`ANONYMIZE` (default)** и `HARD_DELETE` (только когда требует
  закон).
- Cooling-off: `scheduledFor = createdAt + 90 дней` по умолчанию; исполняет
  ежечасный cron только `APPROVED`-джобы; пациент может отменить из Mini App.
- `ANONYMIZE` (`src/server/dsar/anonymize.ts`): скрабятся `fullName` (→
  «Удалённый пациент»), `phone`, `phoneNormalized` (сентинел
  `deleted:<jobId>` — уникальный индекс не ломается), `passport`, `address`,
  `telegramId/Username`, `photoUrl`, `notes`, `summaryCache`; ставятся
  `deletedAt`, `marketingOptOut`, `consentMarketing=false`. Агрегаты
  (LTV, visitsCount, платежи) сохраняются.
- Форензик-снапшот до-скрабных идентификаторов уходит в `meta.before`
  аудит-строки `PATIENT_ANONYMIZED` (`snapshotForensicFields`) — осознанный
  компромисс: «кто был пациент X» восстановимо из аудита, но не из живого UI.
- ⚠️ Finding D-6 из `docs/TZ-security-hardening.md` (ANONYMIZE оставляет PHI
  в связанных сущностях — visit notes, документы, сообщения чата) — статус
  исправления в коде не верифицирован этим документом.

### Медико-правовые ограничения на удаление

`prisma/schema.prisma`, guard D-5: `VisitNote.patient` и `Document.patient`
объявлены с **`onDelete: Restrict`** (с комментарием, что это прописано явно,
чтобы никто не переключил на Cascade) — БД **откажет** в hard-delete пациента,
пока существуют заключения/подписанные документы: это юридические записи,
обязанные пережить строку пациента. Роут удаления пациента направляет такие
случаи в DSAR-флоу (ANONYMIZE) вместо физического удаления.

---

## 10. Секреты и окружение

### Критичные переменные

| Переменная | Назначение | Последствия утечки/потери |
| --- | --- | --- |
| `AUTH_SECRET` | подпись NextAuth JWT; фолбэк-KDF для `secrets.ts` и HMAC override-cookie | подделка сессий любого пользователя, включая SUPER_ADMIN |
| `APP_SECRET` | KDF секретов интеграций + HMAC `admin_clinic_override` | расшифровка секретов интеграций, подделка импер­сонации |
| `FIELD_ENCRYPTION_KEY[_V<n>]` | AES-ключи PII-полей (§5.2) | утечка → чтение passport/notes из дампа; потеря → данные невосстановимы (ранбук) |
| `DATABASE_URL` / `POSTGRES_PASSWORD` | Postgres | вся БД, включая нешифрованные PII |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | root-креды MinIO (docker-compose.yml) | все файлы всех клиник, включая DSAR-бандлы |
| `RECEPTIONIST_PIN` | серверный PIN терминала (`src/lib/pin.ts`; без него — fail closed) | доступ к queue-API терминала |
| `Clinic.tgBotToken` (в БД, не env) | токен бота клиники; ключ HMAC-аутентификации Mini App | полная имперсонация пациентской поверхности клиники |
| `DISABLE_2FA`, `DISABLE_AUTH_RATE_LIMIT` | kill-switch'и (§2, §8) | установлены в проде = снятая 2FA / снятый логин-троттл |
| `REDIS_URL`, `OPENAI/LLM`-ключи и пр. | инфраструктура/AI | по контексту |

`NEXT_PUBLIC_RECEPTIONIST_PIN` — **клиентская** переменная, только UX-гейт
экрана разблокировки, не граница безопасности (задокументировано в
`src/lib/pin.ts`).

### Где секретов быть не должно

- **Git:** `.gitignore` исключает `.env*` (кроме `.env.example`) и `*.pem`;
  CI гоняет `gitleaks detect` и `npm audit --omit=dev --audit-level=high`
  (finding M4 в `docs/security/phase-7.md`, помечен fixed; ⚠️ актуальный
  `.github/workflows/ci.yml` не перепроверялся).
- **Логи:** политика `docs/security/checklist.md` §11 — не логировать ФИО,
  полный телефон, тела сообщений; секреты в UI — только маска
  (`maskSecret`). Известное исключение: log-only адаптеры уведомлений в
  dev пишут телефон + превью (finding M1, признан, не исправлен).
- **Ответы API:** сохранённый секрет интеграции никогда не возвращается в
  открытом виде (маска + повторный ввод при изменении).

Прод (`docker-compose.yml`): секреты приходят через `env_file: .env` на
сервисы `app`/`worker`; у `postgres`/`minio` — из тех же переменных с
**небезопасными дефолтами** (`medbook`, `medbook-secret-min-8`) — в проде
обязаны быть переопределены.

---

## 11. Чеклист перед продом

1. **Env-гигиена:** `DISABLE_2FA` и `DISABLE_AUTH_RATE_LIMIT` не установлены;
   `AUTH_SECRET` ≥ 32 байт; `APP_SECRET` задан отдельно от `AUTH_SECRET`;
   `FIELD_ENCRYPTION_KEY(_Vn)` задан (иначе прод не стартует — проверить, что
   это именно боевой ключ из секрет-стора, а не dev); `POSTGRES_PASSWORD` /
   `MINIO_*` не равны дефолтам compose-файла; `RECEPTIONIST_PIN` задан.
2. **Шифрование:** `GET /admin/encryption-health` — `isDevFallback: false`,
   probe OK, `plaintext: 0` по всем колонкам (иначе прогнать
   `scripts/encrypt-existing-pii.ts`).
3. **2FA:** у всех ADMIN/SUPER_ADMIN аккаунтов `totpEnabledAt != null`;
   для клиник с медданными включён `require2faForAll`.
4. **Изоляция:** зелёные `tests/unit/prisma-branch-scope.test.ts`,
   `prisma-tenant.test.ts`, `tenant-allowlist.test.ts`; новые роуты — только
   через `createApiHandler` / `createPlatformHandler` / `createMiniAppHandler`
   (см. `docs/security/checklist.md`).
5. **Смоук чужого тенанта:** под пользователем клиники A запросить сущность
   клиники B по прямому id (`/api/crm/patients/<id_B>`) — ожидаем 404/403;
   файл `clinics/<B>/…` через `/api/crm/documents/file` — 403.
6. **Rate limit:** 6-й `POST /api/auth/*` за минуту с одного IP → 429.
7. **MinIO приватность:** анонимный GET `https://<host>/files/<bucket>/<key>`
   → 403 (бакет не публичный, отдача только через API-роуты).
8. **Аудит:** логин, открытие карточки пациента, импер­сонация SUPER_ADMIN
   оставляют строки в `/crm/settings/audit` и `/admin/audit`.
9. **Сессии:** после логина второй логин тем же пользователем убивает первый
   (`CONCURRENT_SESSION_KICKED`); idle-кик и 8h-ре-ротация работают.
10. **CI-гейты:** `lint`, `tsc --noEmit`, `vitest run`, `npm audit
    --audit-level=high`, `gitleaks` — зелёные.
11. **DSAR:** тестовый экспорт доходит в Telegram и открывается passphrase-ом;
    hard-delete пациента с заключением отклоняется БД (Restrict).

---

## 12. Известные ограничения

Честный список слабых мест «как есть» (не предположения — по коду):

1. **Fail-open при забытом тенант-контексте.** Prisma-расширение молча
   пропускает запросы без ALS-контекста (`src/lib/prisma.ts`) — изоляция
   держится на дисциплине «весь ingress через фабрики хендлеров». Runtime-
   гарда «нет контекста → исключение» нет (и spec phase-7 здесь описывает
   желаемое, а не реальное).
2. **`User.totpSecret` / `pendingTotpSecret` — плейнтекст в БД.** Комментарий
   схемы обещает «encrypted», код не шифрует. Дамп БД + окно ±1 шаг = обход
   второго фактора для любого пользователя.
3. **`Clinic.tgBotToken` — плейнтекст в БД.** Токен — ключ HMAC-аутентификации
   всей пациентской поверхности клиники; ProviderConnection-секреты шифруются,
   этот столбец — нет.
4. **In-memory rate limiter** (`src/lib/rate-limit.ts`): не кластер-safe,
   обнуляется рестартом, ключ доверяет `x-forwarded-for` (finding M3, Redis
   запланирован, не сделан).
5. **Env-kill-switch'и** `DISABLE_2FA` / `DISABLE_AUTH_RATE_LIMIT`: одна
   переменная в проде снимает 2FA у всех / логин-троттл. Никакого
   алерта/аудита на факт включения нет.
6. **Аудит fire-and-forget** — при недоступности БД строки теряются молча;
   очереди-фолбэка нет (finding L2).
7. **Capability-URL вложений чата** — неаутентифицированный роут: утечка
   object key (история браузера, логи прокси, реферер при открытии inline)
   даёт доступ к файлу; TTL и отзыв отсутствуют. Скоуп жёстко ограничен
   чат-префиксом одного разговора.
8. **Дрейф деактивации до 1 часа** для пассивных JWT-сессий (`updateAge`);
   плюс прокси fail-open на lifetime-проверке при недоступности БД.
9. **`APP_SECRET` фолбэк на `AUTH_SECRET`** — если задан только `AUTH_SECRET`,
   один секрет подписывает и JWT, и override-cookie, и шифрует интеграции
   (общий blast radius). Ротация `APP_SECRET` не поддержана механикой
   версий — старые шифртексты интеграций станут нечитаемыми.
10. **Mini App работает в `SYSTEM`-контексте** — авто-скоупа нет, изоляция
    зависит от того, что каждый хендлер вручную пинит
    `clinicId`/`patientId` (конвенция, не механизм).
11. **Форензик-снапшот в аудите:** после ANONYMIZE до-скрабные ФИО/телефон/
    паспорт остаются в `AuditLog.meta` — «удаление» не вычищает аудит
    (осознанный компромисс, но юристам знать обязательно). Плюс finding D-6
    (PHI в связанных сущностях после ANONYMIZE) — ⚠️ статус не верифицирован.
12. **next-auth на beta** (`5.0.0-beta.*`, finding L1) — API-поверхность
    стабильна, но пиннинг на стабильный релиз не сделан.
13. **PIN терминала** — один общий PIN на клинику из env, смена = редеплой;
    `NEXT_PUBLIC_RECEPTIONIST_PIN` виден в клиентском бандле (UX-гейт).
14. **SSE-превью сообщений без ролевого скоупинга** (finding M2) —
    ⚠️ текущий статус топик-скоупа в `src/server/realtime/**` не
    верифицирован этим документом.
