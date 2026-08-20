# E2E-тесты (Playwright)

## Быстрый старт — одна команда

```bash
npm run test:e2e:local            # весь сьют
npm run test:e2e:local -- 04      # только спеки, матчащиеся на «04»
npm run test:e2e:local -- --ui    # UI-режим Playwright
```

Скрипт (`scripts/e2e-local.sh`) сам: создаёт БД `neurofax_e2e` (если нет) →
`prisma migrate deploy` → идемпотентный сид (`tests/e2e/seed.ts`) →
`npm run build` → `playwright test` против **production-сервера**
(`next start` на порту 3001, поднимает Playwright через `webServer`).

Почему прод-сборка: `next dev` компилирует роуты лениво, и «холодные» первые
запросы (10с+) заставляют API-спеки флакать по таймауту. Для быстрого
внутреннего цикла можно пропустить сборку: `E2E_DEV=1 npm run test:e2e:local --
04` (dev-сервер, менее стабильно).

## Что нужно на машине

- **Postgres** на `localhost:5432` (Homebrew: `brew services start postgresql@16`).
  Другой инстанс/юзер — через `E2E_DB_URL=postgresql://user:pass@host:port/db`.
- **Chromium для Playwright** — один раз: `npm run e2e:install`.
- **Остановленный `npm run dev`.** Next 16 держит lock «один dev-сервер на
  каталог проекта» — при живом dev-сервере webServer сьюта не стартует.
  Скрипт проверяет это и откажется запускаться.
- Redis и MinIO **не нужны**: приложение само падает на in-memory-очередь и
  стаб-хранилище, когда `REDIS_URL`/`MINIO_ENDPOINT` не заданы.

## Как устроен сьют

- `playwright.config.ts` — порт 3001, `DATABASE_URL_TEST` прокидывается
  webServer-у как `DATABASE_URL`. Локально 2 воркера, в CI 1 (общая база).
  ⚠️ Не добавляйте `--hostname 127.0.0.1` в startCommand: под Next 16 это
  ломает locale-rewrite корня в бесконечный `307 → /` (см. комментарий в
  конфиге).
- `seed.ts` — идемпотентный сид: 2 клиники (`neurofax`, `demo-clinic`), роли
  ADMIN/RECEPTIONIST/CALL_OPERATOR/3×DOCTOR + SUPER_ADMIN, услуги, кабинеты,
  пациенты, записи «на сегодня 10:00–14:00», шаблоны уведомлений.
- `helpers.ts` — логин через NextAuth credentials POST (без UI), `checkA11y`
  (axe-core), подпись Mini-App `initData`.
- `fixtures/seed-handles.ts` — email/пароли посеянных пользователей.
- Спеки, которым нужен подписанный Telegram `initData` (mini-app booking),
  самопропускаются без `TG_BOT_TOKEN_TEST` — это ожидаемо.

## Отдельные команды (то, что делает скрипт)

```bash
export E2E_DB_URL="postgresql://$(whoami)@localhost:5432/neurofax_e2e"
DATABASE_URL="$E2E_DB_URL" npx prisma migrate deploy
DATABASE_URL="$E2E_DB_URL" npm run e2e:seed
DATABASE_URL_TEST="$E2E_DB_URL" npx playwright test
```

Отчёт после прогона: `npx playwright show-report` (артефакты — `test-results/`,
трейсы и скриншоты пишутся на первом ретрае/фейле).
