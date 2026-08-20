# DEPLOY — как деплоить MedBook / NeuroFax на прод

> Актуально на 2026-08-20. Проверено против живого сервера (`root@167.233.142.75`,
> `/opt/neurofax`, compose-проект `medbook`) и содержимого `_deploy.sh` на нём.
>
> CI в GitHub Actions (`.github/workflows/ci.yml`) снова живой: на каждый
> push/PR в `main` гоняются typecheck, unit-тесты, i18n-проверки, prod-build и
> secret-scan (lint и npm audit — отдельные non-blocking шаги). CI **ничего не
> деплоит**. Бывший workflow `deploy.yml` удалён (2026-08-20): он целился в
> несуществующий `/opt/medbook`, его секреты `SSH_*` не были настроены, а
> автодеплой по зелёному CI противоречит правилу «деплой — только по явной
> просьбе владельца». Реальный деплой — **ручной, по SSH, через `_deploy.sh`**
> (описан ниже). `ops/deploy.sh` в репо близок по содержанию, но продом не
> используется.

## Оглавление

- [TL;DR](#tldr)
- [1. Предусловия: локальная проверка](#1-предусловия-локальная-проверка)
- [2. Как устроен прод](#2-как-устроен-прод)
- [3. Пошаговый деплой](#3-пошаговый-деплой)
- [4. Проверка после деплоя](#4-проверка-после-деплоя)
- [5. Откат](#5-откат)
- [6. Подводные камни](#6-подводные-камни)
- [7. Что НЕ делать](#7-что-не-делать)

---

## TL;DR

```bash
# 0. локально: типы + тесты зелёные, закоммичено и запушено в main
rm -rf .next/dev
node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit
npx vitest run
git push origin main

# 1. запустить деплой на сервере (пароль — см. memory/reference_medbook_vps_access.md)
ssh root@167.233.142.75 \
  'cd /opt/neurofax && git pull --ff-only && nohup bash _deploy.sh >/dev/null 2>&1 &'

# 2. дождаться результата (5–10 минут; сборка двух образов)
ssh root@167.233.142.75 \
  'until [ -f /tmp/deploy.done ] || [ -f /tmp/deploy.fail ]; do sleep 10; done; \
   ls /tmp/deploy.done /tmp/deploy.fail 2>/dev/null; tail -5 /tmp/deploy.log'

# 3. смоук
curl -fsS https://neurofax.uz/api/health | jq .status   # "ok"
curl -fsSo /dev/null -w '%{http_code}\n' https://rtxshop.uz/        # 200 — сосед жив
curl -fsSo /dev/null -w '%{http_code}\n' https://orientatravel.uz/  # 200/30x — сосед жив
```

**Правило проекта:** каждый прод-деплой — только по явной просьбе владельца.
Никаких автодеплоев, никаких кронов/циклов, которые деплоят сами.

---

## 1. Предусловия: локальная проверка

Перед пушем в `main` прогнать локально. CI прогонит то же самое на push, но
деплой ручной и CI его не блокирует — так что зелёный локальный прогон
остаётся обязательным барьером перед деплоем:

```bash
cd /Users/joe/Desktop/medbook/medbook-uz

# ОБЯЗАТЕЛЬНО перед tsc: снести кэш dev-валидатора Next.
# Устаревший .next/dev даёт ЛОЖНЫЕ ошибки типов на валидном коде.
rm -rf .next/dev

# Типы. Без увеличенной памяти tsc падает по OOM на этом проекте.
node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit

# Юнит-тесты
npx vitest run

# i18n (оба зелёные и блокирующие в CI)
npm run i18n:check     # паритет ru/uz словарей next-intl
npm run i18n:audit     # inline-строки в mini-app
```

Опционально:

```bash
npm run lint    # сейчас красный (~71 старая ошибка) — в CI non-blocking шаг;
                # новые ошибки старайся не добавлять
npm run test:e2e:local  # Playwright-сьют одной командой (БД+сид+build+start);
                        # нужен локальный Postgres и остановленный `npm run dev`
                        # — см. tests/e2e/README.md
```

После пуша глянуть Actions: зелёная джоба `CI / typecheck · unit · i18n · build`
= код собирается и тесты прошли на чистой машине (кэш `node_modules` там свой,
так что «у меня локально собирается» перепроверяется честно).

Если менялась схема Prisma — убедиться, что миграция создана и закоммичена
(`prisma/migrations/<timestamp>_имя/`), а не осталась только в локальной БД.

Затем:

```bash
git add -A && git commit -m "..." && git push origin main
```

Репо: `https://github.com/sudoexc/medbook.git` (публичный — сервер тянет без auth).

---

## 2. Как устроен прод

- Сервер: Hetzner, `root@167.233.142.75` (пароль в
  `~/.claude/projects/-Users-joe/memory/reference_medbook_vps_access.md` — **всегда
  перечитывать оттуда, не набирать по памяти**).
- Каталог: `/opt/neurofax` — git-checkout `origin/main` того же репо.
- Compose-проект: `medbook` (контейнеры `medbook-app-1`, `medbook-worker-1`,
  `medbook-postgres-1`, `medbook-redis-1`, `medbook-minio-1`, `medbook-nginx-1`,
  `medbook-certbot-1`).
- Сервер **общий**: помимо medbook на нём живут rtxshop, orientatravel, natus,
  tizim / tizim-dental, termogrom, travel-crm, tcn-bot и др. — и все их сайты
  проксируются через **тот же** `medbook-nginx-1`. Подробнее — `RUNBOOK.md`.

### `_deploy.sh` — реальный скрипт деплоя

Лежит в `/opt/neurofax/_deploy.sh`, **untracked** (в репо его нет — при
`git clone` с нуля его надо восстановить). Актуальное содержимое (снято с
сервера 2026-08-20):

```bash
#!/usr/bin/env bash
set -o pipefail
cd /opt/neurofax || exit 1
rm -f /tmp/deploy.done /tmp/deploy.fail
{
  echo "[build]    $(date -u)"
  docker compose build app worker &&
  echo "[migrate]  $(date -u)" &&
  docker compose run --rm worker npx prisma migrate deploy &&
  echo "[recreate] $(date -u)" &&
  docker compose up -d --no-deps --force-recreate app worker &&
  echo "[nginx]    $(date -u)" &&
  docker exec medbook-nginx-1 nginx -s reload &&
  echo "PIPELINE_OK $(date -u)" && touch /tmp/deploy.done
} > /tmp/deploy.log 2>&1 || { echo "PIPELINE_FAIL $(date -u)" >> /tmp/deploy.log; touch /tmp/deploy.fail; }
```

Пайплайн: **build (app+worker) → миграции через worker → force-recreate
app+worker → reload nginx**. Лог — `/tmp/deploy.log`, маркеры —
`/tmp/deploy.done` (в логе `PIPELINE_OK`) или `/tmp/deploy.fail`.

Почему именно так — см. [Подводные камни](#6-подводные-камни).

### skip-worktree: 4 файла защищены от `git pull`

На сервере 4 отслеживаемых файла помечены `git update-index --skip-worktree`,
чтобы `git pull` **никогда** не затирал прод-конфиги (в них — прод-специфика и
vhost'ы соседних сайтов):

```
docker-compose.yml
nginx/nginx.conf
nginx/conf.d/rtxshop.conf
nginx/conf.d/orientatravel.conf
```

Проверить: `cd /opt/neurofax && git ls-files -v | grep -v '^H '` — должны
выйти ровно эти 4 строки с префиксом `S`. Кроме них в `nginx/conf.d/` лежит
ещё ~десяток **untracked** конфигов соседей (natus, tizim, termogrom,
travelcrm и т.д.) — git их не тронет, но и удалять/«чистить» их нельзя.

Следствие: если нужно реально изменить `docker-compose.yml` или nginx-конфиг
на проде — правка на сервере руками + (для nginx) `nginx -t` и reload; правка
в git на прод сама не приедет.

---

## 3. Пошаговый деплой

```bash
# Шаг 1 — обновить код на сервере (ff-only: истории расходиться не должно)
ssh root@167.233.142.75 'cd /opt/neurofax && git pull --ff-only'

# Шаг 2 — запустить пайплайн в фоне (nohup: SSH-сессию можно закрыть)
ssh root@167.233.142.75 'cd /opt/neurofax && nohup bash _deploy.sh >/dev/null 2>&1 &'

# Шаг 3 — ждать маркер (обычно 5–10 минут)
ssh root@167.233.142.75 \
  'until [ -f /tmp/deploy.done ] || [ -f /tmp/deploy.fail ]; do sleep 10; done; \
   if [ -f /tmp/deploy.done ]; then echo DEPLOY_OK; else echo DEPLOY_FAIL; fi'

# Шаг 4 — посмотреть лог (в конце должно быть PIPELINE_OK)
ssh root@167.233.142.75 'tail -30 /tmp/deploy.log'
```

Если `DEPLOY_FAIL` — весь вывод упавшего шага уже в `/tmp/deploy.log`.
Скрипт устроен цепочкой `&&`: упал build → миграции и recreate не выполнялись,
старые контейнеры продолжают работать (это безопасный отказ). Упали миграции —
recreate тоже не выполнялся.

Git pull сам по себе **ничего не деплоит**: app и worker запекают исходники в
образ (bind-mount'ов кода нет), без rebuild код не обновится. Изменения только
`.env` / `environment:` в compose требуют лишь force-recreate, без build.

---

## 4. Проверка после деплоя

### 4.1 Health

```bash
curl -fsS https://neurofax.uz/api/health | jq
```

Ожидаемый ответ (`status: "ok"`, все checks `ok`, workers в режиме `bullmq`):

```json
{
  "status": "ok",
  "checks": {
    "db":      { "status": "ok", "latencyMs": 4 },
    "redis":   { "status": "ok", "latencyMs": 8 },
    "minio":   { "status": "ok", "latencyMs": 6 },
    "workers": { "status": "ok", "queues": ["notifications:send", "notifications:scheduler", "exports"], "details": "bullmq" }
  }
}
```

`degraded`/`down` или HTTP 503 — см. RUNBOOK.md.

### 4.2 Контейнеры

```bash
ssh root@167.233.142.75 'cd /opt/neurofax && docker compose ps'
```

`app` и `worker` должны быть `Up (healthy)` / `Up` со свежим временем старта.
Если worker в рестарт-цикле — `docker compose logs --tail=100 worker`.

### 4.3 Миграции применились (обязательный шаг)

Docker build cache может подсунуть в образ **устаревший слой** с
`/app/prisma/migrations/` — тогда `migrate deploy` честно скажет «нечего
применять», а новой миграции в БД не будет. Поэтому после каждого деплоя со
схемой сверять руками:

```bash
# что в базе
ssh root@167.233.142.75 'cd /opt/neurofax && docker compose exec -T postgres \
  psql -U medbook -d medbook -tc \
  "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"'

# что в репо
ls prisma/migrations/ | tail -5
```

Последние имена должны совпадать. Если в базе миграции нет:

```bash
ssh root@167.233.142.75 'cd /opt/neurofax && \
  docker compose build --no-cache worker && \
  docker compose run --rm worker npx prisma migrate deploy && \
  docker compose up -d --no-deps --force-recreate worker'
```

### 4.4 Смоук приложения

```bash
curl -fsSo /dev/null -w '%{http_code}\n' https://neurofax.uz/              # 200/307
curl -fsSo /dev/null -w '%{http_code}\n' https://neurofax.uz/ru/login      # 200
curl -fsSo /dev/null -w '%{http_code}\n' https://neurofax.uz/c/neurofax/my # 200 (mini app)
```

Плюс глазами: залогиниться в CRM, открыть ресепшн/календарь, проверить что
живая очередь обновляется (SSE).

### 4.5 Смоук соседей (обязательно после ЛЮБОГО деплоя)

nginx общий — рестарт/релоад затрагивает все сайты бокса:

```bash
for d in rtxshop.uz orientatravel.uz; do
  printf '%s → ' "$d"; curl -fsSo /dev/null -w '%{http_code}\n' "https://$d/" || echo FAIL
done
```

Смоук по кодам недостаточен при подозрении на alias-коллизию в docker-сети —
тогда проверять **содержимое** ответов (что rtxshop отдаёт rtxshop, а не
чужой сайт). Если менялось что-то в nginx — прогнать и остальные домены из
`nginx/conf.d/` (natus, tizim, termogrom, travelcrm и т.д. — точный список
см. `ls /opt/neurofax/nginx/conf.d/`).

---

## 5. Откат

### 5.1 Откат кода (схема БД не менялась)

```bash
ssh root@167.233.142.75 'cd /opt/neurofax && \
  git log --oneline -10 && \
  git reset --hard <известный-хороший-sha> && \
  nohup bash _deploy.sh >/dev/null 2>&1 &'
```

Дальше — тот же цикл ожидания и проверок, что и при обычном деплое.
После проверки не забыть вернуть checkout на `origin/main`
(следующий `git pull --ff-only` иначе не пройдёт; понадобится
`git reset --hard origin/main` уже с исправленным кодом).

### 5.2 Откат со схемой БД

`prisma migrate deploy` не умеет «вниз». Если плохая миграция уже применилась:

1. Снять текущий дамп (на всякий случай), см. RUNBOOK.md §Бэкап.
2. Восстановить БД из последнего дампа **до** миграции (`ops/restore.sh` —
   ⚠️ на текущем сервере ночной бэкап не настроен, см. RUNBOOK; возможно,
   свежего дампа нет — тогда только fix-forward).
3. Откатить код (§5.1) на коммит до миграции.

Практический дефолт этого проекта — **fix-forward**: чинить новой миграцией,
а не откатывать базу.

---

## 6. Подводные камни

1. **Миграции — только через `worker`, никогда через `app`.**
   Образ `app` — Next.js standalone-slim: в него скопированы лишь
   `node_modules/@prisma` и `node_modules/prisma`, но не транзитивные
   зависимости prisma CLI (`pathe`, `effect` и др.). Любое
   `docker compose run app npx prisma migrate deploy` падает с
   `Cannot find module 'pathe'`. Образ `worker` несёт полный
   `node_modules` — миграции гоняются `docker compose run --rm worker npx
   prisma migrate deploy` (именно так и делает `_deploy.sh`).

2. **После `--force-recreate` обязателен `nginx -s reload`.**
   nginx резолвит upstream-имя `app` в IP контейнера на старте воркеров;
   force-recreate выдаёт контейнеру новый IP, и nginx продолжает бить в
   старый → **502 на всех страницах**. `_deploy.sh` делает reload последним
   шагом; если деплоишь руками по кусочкам — не забыть
   `docker exec medbook-nginx-1 nginx -s reload`.

3. **Build cache может «съесть» миграции.** Слой с `COPY . .` иногда
   переиспользуется из кэша, и в образ попадает старый каталог
   `prisma/migrations/`. Симптом: деплой зелёный, а таблица
   `_prisma_migrations` без новой строки. Лечение и проверка — §4.3.

4. **`_deploy.sh` нет в git.** При пересоздании сервера/каталога его нужно
   восстановить руками (текст — в этом документе). То же про `.env` и 4
   skip-worktree файла.

5. **`git pull` не деплоит.** Код запечён в образы; без
   `docker compose build` + recreate ничего не изменится.

6. **`ops/crontab.example` и `ops/deploy.sh` указывают на `/opt/medbook`** —
   такого каталога на сервере нет, реальный путь `/opt/neurofax`. При
   использовании этих скриптов пути править.

7. **Prisma 7 + `pathe`:** `pathe` добавлен в прямые dependencies package.json
   именно из-за пункта 1 — не удалять «как неиспользуемый».

---

## 7. Что НЕ делать

- ❌ **`docker compose down` / `restart nginx` без крайней нужды.**
  `medbook-nginx-1` терминирует TLS и проксирует **все** сайты сервера
  (rtxshop, orientatravel, natus, tizim, termogrom, travel-crm...). Уронил
  compose-проект medbook — уронил всех. Для деплоя достаточно
  `up -d --no-deps --force-recreate app worker` + reload nginx.
- ❌ **Не трогать `nginx/conf.d/*.conf` и `nginx/nginx.conf`** без задачи,
  явно касающейся конкретного vhost'а. После любой правки: `docker exec
  medbook-nginx-1 nginx -t` → reload → смоук ВСЕХ доменов из conf.d.
- ❌ **Не снимать skip-worktree** с 4 файлов и не делать `git checkout -- .`
  / `git clean -fd` в `/opt/neurofax` — снесёт прод-конфиги и untracked
  vhost'ы соседей + `_deploy.sh`.
- ❌ **Не запускать `prisma migrate dev` / `db push` на проде** — только
  `migrate deploy` через worker.
- ❌ **Не деплоить без явной просьбы владельца** и не вешать деплой на
  cron/циклы.
- ❌ **Не набирать SSH-пароль по памяти** в скрипты/циклы — перечитать
  memory-файл; ошибочный пароль в цикле = бан по fail2ban (если появится).
- ❌ **Не чистить docker-волюмы** (`docker volume prune`, `down -v`) — там
  pgdata/minio и данные соседей. Для места — `docker builder prune`
  (см. RUNBOOK).
