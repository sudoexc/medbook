# NEW-CLINIC — подключение новой клиники (мульти-тенант онбординг)

> Актуально на 2026-08-20, сверено с кодом (`src/app/api/platform/clinics/route.ts`,
> `src/app/api/public/signup/confirm/route.ts`, `src/server/onboarding/*`,
> `src/app/api/crm/onboarding-status/route.ts`).
>
> Система мульти-тенантная: одна инсталляция, изоляция по `clinicId` через
> Prisma-extension (`runWithTenant`). Новая клиника = новые строки в БД + бот в
> Telegram; отдельного деплоя не требуется.
>
> Запуск **боевой** клиники рядом с демо (порядок действий, проверки,
> разделение демо/прод) — `docs/operations/GO-LIVE.md`; этот файл — справочник
> по механике онбординга.

## Оглавление

- [1. Два пути создания клиники](#1-два-пути-создания-клиники)
- [2. Путь A: через админ-консоль SUPER_ADMIN](#2-путь-a-через-админ-консоль-super_admin)
- [3. Путь B: self-service `/signup`](#3-путь-b-self-service-signup)
- [4. Что создаётся и что нужно досоздать](#4-что-создаётся-и-что-нужно-досоздать)
- [5. Настройка силами админа клиники (чеклист из 9 шагов)](#5-настройка-силами-админа-клиники-чеклист-из-9-шагов)
- [6. Telegram-бот клиники](#6-telegram-бот-клиники)
- [7. Домен / поддомен](#7-домен--поддомен)
- [8. Финальная проверка после онбординга](#8-финальная-проверка-после-онбординга)

---

## 1. Два пути создания клиники

| | A: админ-консоль | B: self-service |
|---|---|---|
| Кто | SUPER_ADMIN в `/admin/clinics` | сама клиника на `/signup` |
| Что создаётся | Clinic + первый ADMIN + опционально плейбук (селект в форме) | Clinic + ADMIN + подписка TRIAL (basic, 14 дней) + плейбук (услуги + шаблоны уведомлений) |
| Когда использовать | ручной онбординг «под ключ» | самостоятельная регистрация |

Предусловие для пути A — существующий SUPER_ADMIN. Если его нет (свежая БД):

```bash
# на проде — через worker-контейнер
ssh root@167.233.142.75 'cd /opt/neurofax && \
  docker compose exec -T -e SUPER_PASS="<надёжный-пароль>" worker \
  npx tsx scripts/bootstrap-super-admin.ts'
# создаёт/обновляет пользователя super@neurofax.uz с ролью SUPER_ADMIN
```

## 2. Путь A: через админ-консоль SUPER_ADMIN

1. Залогиниться SUPER_ADMIN'ом → открыть `https://neurofax.uz/admin/clinics`.
2. «Создать клинику» (форма → `POST /api/platform/clinics`). Поля:
   - `slug` — латиницей, уникальный; попадёт в URL пациентских поверхностей
     `/c/<slug>/my` и в путь TG-webhook. **Изменить потом больно — выбирать
     сразу правильно.**
   - `nameRu` / `nameUz`, адреса, телефон, email;
   - `timezone` (дефолт `Asia/Tashkent`), `currency` (дефолт UZS),
     `brandColor`;
   - `ownerEmail` / `ownerName` — первый администратор клиники. Email
     глобально уникален по всей платформе;
   - `playbook` (опционально) — плейбук специализации из того же каталога,
     что у `/signup` (`general` / `dental` / `neurology` / `pediatric` /
     `cosmetology`). Выбран → сразу после создания насыпаются типовые
     услуги, 4 базовых шаблона уведомлений и график рабочего дня
     (`applyPlaybook`, идемпотентно; сбой плейбука клинику не откатывает —
     в ответе будет `playbookApplied: false`).
3. В ответе придёт **временный пароль владельца — показывается ОДИН раз**,
   нигде не хранится и не восстанавливается. Передать админу клиники по
   защищённому каналу. При первом входе система заставит сменить пароль
   (`mustChangePassword`).
4. Всё выполняется в одной транзакции: Clinic + User(ADMIN); в аудит
   пишется `clinic.create`.

## 3. Путь B: self-service `/signup`

1. Клиника заполняет форму на `https://neurofax.uz/signup` (название, email,
   телефон, тариф, опционально — плейбук специализации).
2. На email уходит ссылка с токеном (`ClinicSignupToken`); клик →
   `POST /api/public/signup/confirm`, который в одной транзакции:
   - создаёт Clinic (`slug = slugify(название)` + суффикс при коллизии);
   - создаёт ADMIN-пользователя (временный пароль показывается один раз,
     `mustChangePassword`);
   - создаёт Subscription: план `basic`, статус `TRIAL`,
     `trialEndsAt = +14 дней` (истечение триала обрабатывает воркер
     trial-expiry → `PAST_DUE`);
   - применяет **плейбук** (если выбран): `general`, `dental`, `neurology`,
     `pediatric` или `cosmetology` — насыпает типовые услуги с ценами
     ташкентского рынка, 4 базовых шаблона уведомлений (подтверждение + 
     напоминания 3д/24ч/2ч) и дефолты рабочего дня/слота. Плейбук
     идемпотентен, можно докатить позже:
     `applyPlaybook(clinicId, slug)` из `src/server/onboarding/apply-playbook.ts`.

## 4. Что создаётся и что нужно досоздать

Автоматически НЕ создаётся почти ничего из операционного каркаса — это
осознанно: структуру заводит админ клиники через CRM. Карта:

| Сущность | Кто/где создаёт |
|---|---|
| **Clinic** | путь A или B |
| **User (ADMIN)** | путь A или B (временный пароль, смена при входе) |
| **Subscription** | путь B — автоматически (basic TRIAL); путь A — ⚠️ создать вручную в `/admin/clinics/<id>` (вкладка биллинга; API `/api/admin/clinics/[id]/subscription`). Без подписки план-гейты считают клинику бестарифной |
| **Branch (филиал)** | `/crm/settings/branches` — создать первый филиал и пометить его основным (`isDefault`). Модели с `branchId` умеют жить с `null`, но резолвер ветки ждёт дефолтный филиал |
| **Service (услуги)** | плейбук (путь A с выбранным плейбуком, путь B) или `/crm/settings/services` |
| **Cabinet (кабинеты)** | `/crm/settings/cabinets` |
| **Doctor (врачи)** | `/crm/doctors` (создание врача заводит и User с ролью DOCTOR для кабинета врача) |
| **DoctorSchedule (расписания)** | карточка врача `/crm/doctors/<id>` — недельная сетка приёма |
| **NotificationTemplate** | плейбук (4 шт., пути A и B) или сид всех дефолтов (8 шт. + новые ключи): см. ниже |
| **Пользователи-сотрудники** | `/crm/settings/users` (ресепшн, колл-центр, медсёстры) |
| **Telegram-бот** | §6 |

Досыпать полный набор дефолтных шаблонов уведомлений (идемпотентно, проходит
по ВСЕМ клиникам, существующие ключи не трогает):

```bash
ssh root@167.233.142.75 'cd /opt/neurofax && \
  docker compose run --rm worker npx tsx scripts/seed-notification-templates.ts && \
  docker compose run --rm worker npx tsx scripts/backfill-new-templates.ts'
```

(`backfill-new-templates.ts` добавляет более поздние ключи: `reminder.5h`,
`case.repeat-due` и др.)

## 5. Настройка силами админа клиники (чеклист из 9 шагов)

Дашборд CRM показывает клинике прогресс онбординга
(`GET /api/crm/onboarding-status`). Онбординг считается завершённым, когда:

1. **clinic** — заполнены телефон + адрес (`/crm/settings/clinic`);
2. **cabinets** — ≥1 активный кабинет;
3. **services** — ≥1 активная услуга;
4. **doctors** — ≥1 активный врач;
5. **doctorSchedule** — ≥1 активный слот расписания врача;
6. **templates** — ≥1 шаблон уведомлений;
7. **firstPatient** — зарегистрирован первый пациент;
8. **firstAppointment** — создана первая запись;
9. **tgBotConnected** — подключён Telegram-бот (`Clinic.tgBotToken` заполнен).

Полезные разделы настроек: `/crm/settings/{clinic,branches,cabinets,services,
users,roles,notifications,integrations,branding,exchange-rates,billing}`.

## 6. Telegram-бот клиники

У **каждой клиники свой бот** (токен хранится на строке Clinic:
`tgBotToken`, `tgBotUsername`, `tgWebhookSecret`).

1. Владелец клиники создаёт бота у [@BotFather](https://t.me/BotFather)
   (`/newbot`), получает токен вида `123456:AA...`.
2. Админ клиники открывает `/crm/settings/integrations` → мастер подключения
   Telegram → вставляет токен. Мастер (`POST /api/crm/integrations/tg/connect`)
   за один шаг:
   - валидирует токен через `getMe` и сверяет username;
   - ставит команды бота (RU+UZ: /start, /booking, /cancel, /help),
     описания, кнопку меню с Mini App;
   - регистрирует webhook на
     `https://neurofax.uz/api/telegram/webhook/<slug>` (origin берётся из
     `NEXT_PUBLIC_APP_URL`, must be HTTPS) с секретом `tgWebhookSecret`;
   - сохраняет токен/username/секрет на Clinic + аудит.
3. Проверка/починка webhook из консоли:

```bash
ssh root@167.233.142.75 'cd /opt/neurofax && \
  docker compose exec -T worker npx tsx scripts/check-tg-webhook.ts'
# перерегистрация (например, после смены домена):
ssh root@167.233.142.75 'cd /opt/neurofax && \
  docker compose exec -T worker npx tsx scripts/set-tg-webhook.ts <slug> https://neurofax.uz'
```

Пациентская поверхность (Mini App) живёт на `/c/<slug>/my` — открывается из
кнопки меню бота. Пациент, нажавший `/start`, привязывает свой чат — только
после этого ему доходят уведомления канала TELEGRAM.

Платформенные интеграции с секретами других провайдеров (телефония и т.п.)
SUPER_ADMIN заводит в `/admin/clinics/<id>` → Integrations
(`ProviderConnection`, секреты шифруются AES-GCM, плейнтекст назад не
отдаётся).

## 7. Домен / поддомен

По умолчанию клиника не требует ничего доменного: CRM — общий
`neurofax.uz/crm` (тенант определяется по пользователю), пациенты —
`neurofax.uz/c/<slug>/my`.

Опция Pro/Enterprise — **кастомный поддомен** `<sub>.neurofax.uz`
(`Clinic.customSubdomain`, задаётся клиникой в `/crm/settings/branding`,
маршрутизацию включает платформа вручную). Процедура описана в
`docs/runbooks/custom-subdomain.md`, но ⚠️ **тот ранбук устарел
инфраструктурно**: он ссылается на старый VPS `5.129.242.246` и bare-metal
nginx (`/etc/nginx/sites-available`). На текущем сервере nginx контейнерный:

- конфиг правится в `/opt/neurofax/nginx/conf.d/` (добавить `<sub>.neurofax.uz`
  в `server_name` vhost'а neurofax), затем
  `docker exec medbook-nginx-1 nginx -t && docker exec medbook-nginx-1 nginx -s reload`;
- DNS: A-запись `<sub>.neurofax.uz → 167.233.142.75` (или CNAME на apex);
- TLS: ⚠️ проверить, что действующий сертификат покрывает поддомен
  (wildcard `*.neurofax.uz` через DNS-challenge либо доп. SAN через
  webroot-certbot из compose) — на текущем сервере наличие wildcard **не
  проверено**;
- шаги про Cloudflare/1Password из старого ранбука — сверить с реальностью
  (⚠️ требует проверки).

После включения: `curl -I https://<sub>.neurofax.uz/` → 200 и брендированная
пациентская поверхность (host-резолвер в `src/middleware.ts`).

## 8. Финальная проверка после онбординга

```bash
# 1. Вход владельца: временный пароль принят, система заставила сменить
open https://neurofax.uz/ru/login

# 2. Пациентская поверхность отвечает
curl -fsSo /dev/null -w '%{http_code}\n' https://neurofax.uz/c/<slug>/my   # 200

# 3. Webhook бота зарегистрирован и без ошибок
ssh root@167.233.142.75 'cd /opt/neurofax && \
  docker compose exec -T worker npx tsx scripts/check-tg-webhook.ts'
```

Руками:

- [ ] чеклист онбординга на дашборде CRM — все 9 пунктов зелёные;
- [ ] тестовая запись: создать пациента → записать к врачу → запись видна в
      календаре и на ресепшн, живая очередь обновляется без F5 (SSE);
- [ ] уведомление о записи реально пришло в Telegram тестовому «пациенту»
      (нажать /start у бота клиники, создать запись, дождаться confirmation);
- [ ] Mini App открывается из кнопки меню бота, показывает бренд клиники;
- [ ] `/admin/clinics` — у клиники корректные счётчики (users/patients/
      appointments) и активная подписка (для пути A — не забыт ручной шаг);
- [ ] аудит: `/admin/audit` содержит `clinic.create` и подключение бота;
- [ ] изоляция тенантов: под пользователем новой клиники не видны данные
      neurofax (открыть пациентов/записи — списки пустые до первых своих).
