# RUNBOOK — эксплуатация и инциденты MedBook / NeuroFax

> Актуально на 2026-08-20, сверено с живым сервером. Прод: `https://neurofax.uz`,
> Hetzner `root@167.233.142.75` (пароль — в
> `~/.claude/projects/-Users-joe/memory/reference_medbook_vps_access.md`),
> каталог `/opt/neurofax`, compose-проект `medbook`.
>
> Про деплой — `docs/operations/DEPLOY.md`. Про онбординг клиник —
> `docs/operations/NEW-CLINIC.md`.
>
> ⚠️ Старый `docs/runbook.md` частично устарел (пути `/opt/medbook`,
> CI/CD-деплой) — при расхождениях верить этому файлу.

## Оглавление

- [1. Архитектура прод-окружения](#1-архитектура-прод-окружения)
- [2. Диагностика](#2-диагностика)
- [3. Типичные инциденты](#3-типичные-инциденты)
- [4. Бэкап и восстановление](#4-бэкап-и-восстановление)
- [5. Демо-данные и сиды: на проде запрещены](#5-демо-данные-и-сиды-на-проде-запрещены)
- [6. Регулярные проверки](#6-регулярные-проверки)

---

## 1. Архитектура прод-окружения

### 1.1 Контейнеры medbook

```bash
ssh root@167.233.142.75 'cd /opt/neurofax && docker compose ps'
```

| Контейнер | Образ | Роль |
|---|---|---|
| `medbook-app-1` | локальный build, `Dockerfile` | Next.js 16 standalone (порт 3000): CRM, admin-консоль, mini app, все API, SSE `/api/events` |
| `medbook-worker-1` | локальный build, `Dockerfile.worker` | BullMQ-воркеры: notifications send/scheduler, outbox pumper (SSE-шина), TG polling, lifecycle sweep, trial expiry, exports, medication reminders и др. (`src/server/workers/start.ts`) |
| `medbook-postgres-1` | `postgres:16-alpine` | БД `medbook`, user `medbook`, volume `pgdata` |
| `medbook-redis-1` | `redis:7-alpine` | BullMQ-очереди + pub/sub для SSE fan-out; maxmemory 256mb allkeys-lru; volume `redisdata` |
| `medbook-minio-1` | `minio/minio` | S3-хранилище файлов (bucket `medbook` — приватный, файлы отдаются через streaming-proxy приложения, не по presigned URL; наружу через nginx не проксируется, `location /files/` удалён, audit INF-07); volume `miniodata` |
| `medbook-nginx-1` | `nginx:alpine` | **Общий reverse-proxy всего сервера**: 80/443, TLS, все vhost'ы из `nginx/conf.d/` |
| `medbook-certbot-1` | `certbot/certbot` | Продление Let's Encrypt каждые 12ч, volume `letsencrypt` |

`app` и `worker` запекают код в образ (bind-mount'ов исходников нет).
Worker имеет `NODE_OPTIONS=--dns-result-order=ipv4first` — без этого TG polling
виснет (docker bridge без IPv6, а api.telegram.org резолвится в IPv6).

### 1.2 Соседи на сервере — блast radius

Сервер общий. В `/opt/`: `neurofax`, `rtxshop`, `orientatravel`, `natus`,
`tizim`, `tizim-dental`, `termogrom`, `travel-crm`, `tcn-bot`, `goodmark-bot`,
`amazon-radar`, `woot-radar` и др. (состав растёт — актуальный список:
`ls /opt/` + `docker ps`).

**Всё, что общее — это зона поражения при работе с medbook:**

- `medbook-nginx-1` проксирует ВСЕ сайты бокса. Vhost'ы в
  `/opt/neurofax/nginx/conf.d/`: `rtxshop.conf`, `orientatravel.conf`,
  `natus.conf`, `tizim.conf`, `dent.conf`, `termogrom.conf`,
  `00-travelcrm-map.conf`, `crm.orientatravel.uz.conf`, `aladdin.conf`,
  `grandtour.conf` и т.д. Большинство — untracked в git; 4 файла защищены
  skip-worktree (см. DEPLOY.md §2).
- После любого изменения общей инфраструктуры (nginx, docker-сеть, рестарт
  compose-проекта) — смоук соседей:

```bash
for d in rtxshop.uz orientatravel.uz termogrom.uz tizimagency.uz; do
  printf '%s → ' "$d"; curl -sSo /dev/null -w '%{http_code}\n' "https://$d/" || echo FAIL
done
```

- Известный капкан: generic-имя сервиса (например `app`) в общей docker-сети
  `medbook_default` даёт alias-коллизию → nginx round-robin'ом отдаёт чужой
  сайт. Поэтому при подозрениях смоук делать **по содержимому** ответа, не
  только по коду 200.
- Postgres/Redis/MinIO medbook **не** общие с соседями по данным (у rtxshop,
  tizim, travel-crm свои БД-контейнеры), но живут на том же хосте — диск и
  память общие.

---

## 2. Диагностика

### 2.1 Health-эндпоинт

```bash
curl -fsS https://neurofax.uz/api/health | jq
```

Возвращает `status: ok|degraded|down` (HTTP 503 при down) и почек-статусы
`checks.db / redis / minio / workers`. `workers.details: "bullmq"` = Redis
подключён; `"in-memory"` на проде — тревога (REDIS_URL потерялся).
Критичен только db: redis/minio дают `degraded`.

Детальный админский срез: `GET /api/platform/health` (нужна сессия SUPER_ADMIN).

### 2.2 Логи

```bash
ssh root@167.233.142.75
cd /opt/neurofax
docker compose logs -f --tail=200 app       # Next.js: API, SSE, ошибки рендера
docker compose logs -f --tail=200 worker    # очереди, TG polling, шедулеры
docker compose logs --tail=100 nginx        # 502/504, TLS
docker compose logs --tail=100 postgres
tail -50 /tmp/deploy.log                    # последний деплой
```

### 2.3 Очереди (BullMQ)

```bash
# ключи очередей
docker compose exec redis redis-cli --scan --pattern 'bull:*' | sort | head -30
# глубина ожидающих задач по очереди уведомлений
docker compose exec redis redis-cli llen bull:notifications:send:wait
docker compose exec redis redis-cli llen bull:notifications:send:failed
# память Redis
docker compose exec redis redis-cli INFO memory | grep -E 'used_memory_human|maxmemory_human'
```

Растущий `:wait` при живом воркере = воркер не разбирает; смотреть
`docker compose logs worker`.

Состояние отправок на уровне БД:

```bash
docker compose exec -T postgres psql -U medbook -d medbook -c \
  "SELECT status, count(*) FROM \"NotificationSend\"
   WHERE \"createdAt\" > now() - interval '1 day' GROUP BY 1;"
```

⚠️ имя таблицы/колонок сверить с `prisma/schema.prisma` при первом запуске —
могут быть @@map'ы.

### 2.4 SSE (живые обновления)

Транспорт: мутация → `EventOutbox` (БД) → outbox-pumper в worker → локальная
шина + Redis `events:<clinicId>` → `/api/events` (EventSource в браузере).
Схема — `docs/realtime.md`.

Проверка цепочки:

```bash
# 1. pumper жив? (в логах worker должен упоминаться outbox)
docker compose logs --tail=50 worker | grep -i outbox
# 2. события летят через Redis?
docker compose exec redis redis-cli psubscribe 'events:*' &
# ...сделать любое действие в CRM (перенести запись) — должно напечататься событие
# 3. эндпоинт отвечает потоком (нужна кука сессии CRM):
curl -N -H "cookie: $CRM_SESSION" https://neurofax.uz/api/events | head -5
```

Нюанс: на шине два поколения конвертов событий (v1: `clinicId` на верхнем
уровне; v2: в `tenantScope`). Потребители (особенно mini app) должны понимать
оба — парсинг только по старой схеме молча теряет v2-события.

---

## 3. Типичные инциденты

### 3.1 502 на всех страницах после деплоя

Причина №1: app пересоздан (`--force-recreate`), у контейнера новый IP, а
nginx держит старый.

```bash
docker exec medbook-nginx-1 nginx -s reload
```

Если не помогло: `docker compose ps` (app вообще жив? healthy?),
`docker compose logs --tail=100 app` (падает на старте — чаще всего кривой
`.env` или недоступная БД). Полный рестарт nginx (`docker compose restart
nginx`) — крайняя мера, затрагивает всех соседей, после — смоук всех доменов.

### 3.2 «Не обновляется вживую» (SSE)

Симптом: записи создаются, но табло/ресепшн не видят изменений без F5.

1. `curl .../api/health` — redis `ok`?
2. Цепочка из §2.4: pumper → Redis pub/sub → `/api/events`.
3. Частая причина — воркер упал/перезапускается: `docker compose ps`,
   `logs worker`. Outbox при этом копится и после подъёма воркера доедет.
4. Nginx-конфиг для SSE должен иметь отключенную буферизацию
   (`proxy_buffering off` / заголовок `X-Accel-Buffering: no`) — если SSE
   «залипает» ровно на прокси, проверить vhost neurofax в `nginx/conf.d`.
5. Последняя мера: `docker compose restart app` (порвёт активные
   EventSource-коннекты, клиенты переподключатся сами) + `nginx -s reload`.

### 3.3 Уведомления не уходят (Telegram)

1. `docker compose logs --tail=200 worker` — ошибки отправки?
2. Глубина очереди — §2.3. `failed` растёт → смотреть текст ошибки в логах.
3. Статусы в БД — §2.3 (SQL по NotificationSend).
4. Вебхук/токен бота клиники:

```bash
docker compose exec -T worker npx tsx scripts/check-tg-webhook.ts   # состояние webhook
# перепривязать webhook (клиника neurofax, прод-домен):
docker compose exec -T worker npx tsx scripts/set-tg-webhook.ts neurofax https://neurofax.uz
```

5. Шаблоны включены? `/crm/settings/notifications` (isActive у шаблона),
   мастер-переключатели на Clinic (`medicationRemindersEnabled` и т.п.).
6. У пациента должен быть привязан TG-чат (пациент хоть раз нажимал /start
   у бота клиники) — иначе канал TELEGRAM для него молча пропускается.

### 3.4 Кончается место на диске

```bash
df -h /
docker system df          # где именно распухло
```

Главный пожиратель на этом сервере — **build cache** (каждый деплой собирает
два больших образа). Безопасная чистка:

```bash
docker builder prune -af                # кэш сборки — безопасно, следующий деплой просто дольше
docker image prune -f                   # висячие (dangling) образы — безопасно
```

**НЕ запускать**: `docker system prune -a --volumes`, `docker volume prune` —
снесёт данные (pgdata/minio) и остановленные контейнеры соседей.
Также посмотреть логи контейнеров (`/var/lib/docker/containers/*/*-json.log`)
и старые бэкап-архивы в `/opt/*.tgz`.

### 3.5 Упал / рестартится worker

```bash
docker compose ps worker
docker compose logs --tail=200 worker
```

- Падение на старте: чаще всего БД недоступна или несовместимая схема
  (задеплоили код раньше миграции — прогнать миграции, §3.6).
- TG polling виснет: проверить, что в compose у worker остался
  `NODE_OPTIONS=--dns-result-order=ipv4first`.
- Разовый перезапуск: `docker compose restart worker`. Уведомления,
  накопившиеся в очереди/outbox, доедут после подъёма.

### 3.6 База не мигрировала

Симптом: 500-ки с Prisma-ошибками про несуществующую колонку/таблицу, либо
после деплоя в `_prisma_migrations` нет свежей записи.

```bash
cd /opt/neurofax
# статус
docker compose run --rm worker npx prisma migrate status
# применить (ТОЛЬКО через worker — в app-образе нет зависимостей prisma CLI,
# упадёт с "Cannot find module 'pathe'")
docker compose run --rm worker npx prisma migrate deploy
# если migrate говорит "ничего применять", а миграция точно есть в git —
# это устаревший слой build cache внутри образа worker:
docker compose build --no-cache worker
docker compose run --rm worker npx prisma migrate deploy
# проверка подписок до старта нового worker (код 2: DEPLOY.md §3 шаг 0)
docker compose run --rm --no-deps worker npx tsx scripts/subscription-lifecycle-dryrun.ts
docker compose up -d --no-deps --force-recreate app worker
docker exec medbook-nginx-1 nginx -s reload
```

Проверка результата:

```bash
docker compose exec -T postgres psql -U medbook -d medbook -tc \
  "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"
```

### 3.7 Ресепшн получает 402 «лимит тарифа»

Симптом: новая карточка пациента, запись или талон живой очереди
отказывают с `plan_limit` (HTTP 402). Так отвечает квота-гард CRM на лимитах
Basic: у клиники нет подписки, она на тарифе Basic или подписка CANCELLED
(планировщик отменяет PAST_DUE после 14 дней льготного периода).

```bash
cd /opt/neurofax
# что с подписками всех клиник и что сделает планировщик (ничего не пишет)
docker compose run --rm --no-deps worker npx tsx scripts/subscription-lifecycle-dryrun.ts
```

Клиника NeuroFax (владелец платформы): закрепить бессрочную ACTIVE подписку
Pro, `DEPLOY.md` §3 шаг 0. Планировщик её не трогает, но отменить её могли
руками в админке. Другая клиника: «Тарификация»
(`/admin/clinics/<id>/billing`): «Восстановить» возвращает отменённую
подписку (если её срок уже прошёл, то PAST_DUE с новым льготным периодом),
или перевести её на ACTIVE.

---

## 3.5 Мониторинг

`ops/watchdog.sh` — крон каждые 5 минут, опрашивает `/api/health` и пишет в
`/var/log/medbook-watchdog.log`.

| Что | Значение |
|---|---|
| Крон | `*/5 * * * * cd /opt/neurofax && ./ops/watchdog.sh` |
| Куда алерты | Telegram: `ALERT_TG_TOKEN` (токен бота) и `ALERT_TG_CHAT_ID` в `.env`; старые имена `TELEGRAM_BOT_TOKEN` / `WATCHDOG_TG_CHAT_ID` тоже работают. Без них сторож только пишет лог |
| Доставка | `ALERT_TG_API_BASE` (по умолчанию `TELEGRAM_API_BASE` приложения, иначе `https://api.telegram.org`), `ALERT_TG_PROXY` (любой прокси curl, например `socks5h://127.0.0.1:40000`). До 5 попыток с паузой 2, 4, 8, 16 с; доставленным считается только ответ `"ok":true` |
| Состояние | `/var/lib/medbook-watchdog.state`: `ok` или строки `класс\|ключ\|текст` по каждой проблеме, о которой уже сообщили |

Сообщения приходят **только когда меняется набор проблем**: новая проблема,
усиление (например, `workers: degraded`, потом HTTP 503), частичное или полное
восстановление. Пока набор тот же, сторож молчит, долгая авария не превращается
в спам каждые 5 минут. Проверяются все подсистемы из health (`db`, `redis`,
`minio`, `workers`) — в тексте алерта перечислены все упавшие, а не первая
попавшаяся. 🔴 значит сайт не отвечает 200 (или `db` не ok), 🟠 значит сайт
работает, но сбоит фоновая часть или сертификат. Раньше состояние было одно
(`ok` / `bad`), и висящая мягкая проблема (событие в DEAD держит `workers` в
`degraded` сутки) глушила алерт о настоящем падении.

Состояние пишется только после того, как Telegram подтвердил доставку. Если
отправить не вышло, в логе `alert NOT delivered`, и следующий запуск пошлёт
то же сообщение снова. Ошибка 4xx (неверный токен, нет такого чата) не
повторяется внутри запуска, но видна в логе каждые 5 минут, пока её не
исправят.

`workers` в health настоящий (audit INF-01): воркер раз в 30 секунд пишет пульс
в Redis (хэш `medbook:worker:heartbeats`), каждый периодический цикл пишет свой
пульс после тика. Нет пульса процесса дольше 2 минут: `workers=down`; цикл
опоздал на два тика, строка outbox не доставлена дольше минуты, событие ушло в
DEAD за последние сутки, уведомление висит в QUEUED полчаса после срока:
`workers=degraded`. Общий статус тогда `degraded` (HTTP 200), сторож шлёт
алерт. У контейнера `worker` есть healthcheck (файл пульса), его видно в
`docker compose ps`.

```bash
curl -s https://neurofax.uz/api/health | jq .checks.workers
```

Сертификаты (audit INF-03): сторож проверяет сертификат, который nginx отдаёт
прямо сейчас, для хостов из `WATCHDOG_CERT_HOSTS` (по умолчанию `neurofax.uz`),
и шлёт алерт, если до конца меньше 14 дней. Продление: certbot после каждого
обновления запускает deploy hook `ops/certbot/request-nginx-reload.sh`, тот
кладёт флаг в volume `letsencrypt`; крон `ops/nginx-reload-on-renew.sh` (раз в
час) делает `nginx -t` и `nginx -s reload`, флаг снимает. Лог:
`/var/log/medbook-nginx-reload.log`.

Проверить, что сторож жив:

```bash
ssh root@167.233.142.75 'tail -5 /var/log/medbook-watchdog.log; cat /var/lib/medbook-watchdog.state 2>/dev/null'
```

Проверить сам канал алертов (сымитировать падение, не трогая боевое состояние):

```bash
cd /opt/neurofax
WATCHDOG_URL=https://neurofax.uz/api/health-nope WATCHDOG_STATE=/tmp/wd.state ./ops/watchdog.sh
WATCHDOG_STATE=/tmp/wd.state ./ops/watchdog.sh   # отбой
rm -f /tmp/wd.state
```

⚠️ Сторож проверяет только доступность. Ошибки внутри приложения (исключения
на конкретной странице) он не видит — для этого в проекте есть Sentry
(`src/instrumentation.ts`), но он **выключен**: `SENTRY_DSN` в `.env` пустой.
Чтобы включить — завести проект в Sentry и вписать DSN.

## 4. Бэкап и восстановление

> ✅ **СОСТОЯНИЕ НА 2026-08-20: ночной бэкап включён и проверен.**
> Крон root'а: `15 3 * * * cd /opt/neurofax && ./ops/backup.sh`, лог —
> `/var/log/medbook-backup.log`. Восстановление проверено на практике
> (дамп развёрнут во временную базу, 0 ошибок, счётчики строк сошлись
> с боевой: Patient 260, Appointment 1392, VisitNote 441, Document 130).

### 4.1 Что и куда бэкапится

`ops/backup.sh` кладёт в **директорию на хосте** `/var/backups/medbook/<дата>/`
три артефакта:

| Файл | Что внутри |
|---|---|
| `pg-medbook-<ts>.sql.gz` | Полный логический дамп Postgres (~3 МБ сжатый) |
| `files-<ts>.tar.gz` | Файлы клиники из бакета MinIO: документы, вложения чата, памятки (~11 МБ) |
| `restore-kit-<ts>.tar.gz.gpg` | **Зашифрованный** набор для восстановления: `.env` (в нём `FIELD_ENCRYPTION_KEY`, `APP_SECRET`), прод-`docker-compose.yml`, `nginx/nginx.conf` + `nginx/conf.d/` (vhost'ы соседей), `_deploy.sh`. Только если настроено шифрование, см. §4.5 |

Ретенция — 14 дней (`BACKUP_RETENTION_DAYS`), примерно 200 МБ на диске.

Почему на диск хоста, а не в MinIO: предыдущая версия скрипта складывала дамп
в тот самый MinIO, который и должна была защищать — круговая зависимость, и
смерть диска уносила обе копии. (Заодно та версия была нерабочей: `mc`
запускался без `--entrypoint sh`, из-за чего зеркалирование падало.)

⚠️ **Это по-прежнему копия НА ТОМ ЖЕ СЕРВЕРЕ.** Она спасает от повреждения
базы, неудачной миграции, ошибочного сида или сорванного деплоя — но **не от
потери сервера**. Копию нужно регулярно забирать наружу:

```bash
# с локальной машины — забрать последние бэкапы
rsync -avz root@167.233.142.75:/var/backups/medbook/ ~/medbook-backups/
```

### 4.1.1 Проверить, что бэкап живой

```bash
ssh root@167.233.142.75 'ls -lh /var/backups/medbook/*/ | tail -20; tail -5 /var/log/medbook-backup.log'
```

Признаки беды: нет папки за сегодня; дамп меньше 1 МБ; в логе `FAILED:`.

### 4.1.2 Проверить, что дамп реально восстанавливается

Раз в пару месяцев — разворачиваем во временную базу, сверяем и удаляем.
Скрипт грузит дамп одной транзакцией с остановкой на первой ошибке, сверяет
число строк Patient, Appointment, VisitNote и Document с дампом и при любом
расхождении завершается с ненулевым кодом (без строки «dry run OK»):

```bash
ssh root@167.233.142.75
cd /opt/neurofax && DRY_RUN=1 ./ops/restore.sh
```

### 4.2 Ручной дамп Postgres (перед рискованными операциями)

```bash
ssh root@167.233.142.75 'cd /opt/neurofax && docker compose exec -T postgres \
  pg_dump -U medbook -Fp --no-owner --no-acl medbook' | gzip > medbook-$(date +%F).sql.gz
```

### 4.3 Восстановление Postgres

Из MinIO-бэкапа — интерактивный `ops/restore.sh` (спросит подтверждение,
**ДРОПАЕТ базу**):

```bash
cd /opt/neurofax && ./ops/restore.sh pg-medbook-<timestamp>.sql.gz
```

Из локального дампа:

```bash
gunzip -c medbook-2026-08-20.sql.gz | \
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 --single-transaction \
  -U medbook -d medbook -f -
```

Без `-v ON_ERROR_STOP=1` psql продолжает после ошибки и выходит с кодом 0,
то есть «успешно» заливает половину базы.

⚠️ проверить на практике оба пути — с миграции на Hetzner restore не
прогонялся.

### 4.4 Данные MinIO (файлы клиник)

Снять копию бакета `medbook`:

```bash
cd /opt/neurofax
docker run --rm --network medbook_default \
  -e MC_HOST_m="http://$(grep MINIO_ACCESS_KEY .env | cut -d= -f2):$(grep MINIO_SECRET_KEY .env | cut -d= -f2)@minio:9000" \
  -v /root/minio-backup:/backup minio/mc:latest mirror m/medbook /backup/medbook
```

Восстановление — тот же `mirror` в обратную сторону (`/backup/medbook m/medbook`).
Альтернатива — целиком волюм: `docker run --rm -v medbook_miniodata:/data -v
/root:/out alpine tar czf /out/miniodata.tgz /data` (при остановленном MinIO).
⚠️ обе процедуры на этом сервере не репетировались — проверить.

#### MinIO наружу не открыт (audit INF-07)

В репо `nginx/nginx.conf` больше нет `upstream medbook_minio` и
`location /files/` (весь S3 и admin API MinIO торчали в интернет, приложение
этот путь не использует: файлы идут через свои роуты `/api/*/file`). На сервере
`nginx.conf` свой (skip-worktree), поэтому один раз руками, после
`ops/pull-keep-prod-configs.sh` (DEPLOY.md §3, шаги 1 и 1b):

```bash
cd /opt/neurofax
# 0. кто ещё смотрит в MinIO: ожидаются только два блока в nginx.conf.
#    Vhost в conf.d с minio:9000 (files.<домен>) это та же дыра: выключить так же
grep -rn "medbook_minio\|minio:900" nginx/nginx.conf nginx/conf.d/
# 1. убрать оба блока из серверной копии
cp -p nginx/nginx.conf /root/prod-conf-bak/nginx.conf.pre-inf07
sed -i -e '/^[[:space:]]*upstream medbook_minio[[:space:]]*{/,/^[[:space:]]*}/d' \
       -e '/^[[:space:]]*location \/files\/[[:space:]]*{/,/^[[:space:]]*}/d' nginx/nginx.conf
diff /root/prod-conf-bak/nginx.conf.pre-inf07 nginx/nginx.conf
#    diff: удалены ТОЛЬКО эти два блока. Иначе вернуть копию и править руками
# 2. проверить новый файл, затем recreate (inode, см. DEPLOY.md §3 шаг 1b)
docker cp nginx/nginx.conf medbook-nginx-1:/etc/nginx/nginx.candidate.conf
docker exec medbook-nginx-1 nginx -t -c /etc/nginx/nginx.candidate.conf
docker exec medbook-nginx-1 rm -f /etc/nginx/nginx.candidate.conf
docker compose up -d --no-deps --force-recreate nginx
docker exec medbook-nginx-1 nginx -t
docker exec medbook-nginx-1 grep -c medbook_minio /etc/nginx/nginx.conf   # 0
# 3. смоук
curl -s -o /dev/null -w '%{http_code}\n' https://neurofax.uz/files/minio/health/live  # 404
curl -fsS https://neurofax.uz/api/health | jq .checks.minio.status                    # "ok"
for d in neurofax.uz rtxshop.uz orientatravel.uz termogrom.uz tizimagency.uz; do
  printf '%s → ' "$d"; curl -sSo /dev/null -w '%{http_code}\n' "https://$d/" || echo FAIL
done
```

Плюс глазами: в CRM открыть любой документ пациента и вложение чата (идут
через приложение, должны открываться как раньше). Откат:
`cp -p /root/prod-conf-bak/nginx.conf.pre-inf07 nginx/nginx.conf && docker
compose up -d --no-deps --force-recreate nginx`.

`docker-compose.yml` в репо больше не подставляет ключи MinIO по умолчанию
(`${MINIO_ACCESS_KEY:?…}`). Серверную копию менять не обязательно. Если
переносить: сначала `grep -cE '^MINIO_(ACCESS|SECRET)_KEY=.+' .env` должен
дать `2`, после правки `docker compose config -q && echo OK`. Если в `.env`
ключей нет, MinIO работает на ключах по умолчанию: правку не переносить, а
завести ключи (это смена ключей MinIO, отдельная процедура).


### 4.5 Ключи и конфиги: restore kit (audit INF-08)

Дамп сам по себе клинику не восстанавливает. Паспорта и заметки пациентов,
SOAP-черновики, заметки к назначениям и TOTP-секреты зашифрованы ключом
`FIELD_ENCRYPTION_KEY` (`_V<n>`), токены ботов клиник ключом из `APP_SECRET`.
Оба живут только в `.env` на сервере. Потерян сервер без `.env`: эти поля не
расшифровать никогда, врачам с 2FA не войти, боты не работают. Прод-версии
`docker-compose.yml`, `nginx.conf` с vhost'ами соседей и `_deploy.sh` тоже есть
только на сервере (skip-worktree / untracked, см. DEPLOY.md).

Поэтому `ops/backup.sh` каждую ночь кладёт рядом с дампом
`restore-kit-<ts>.tar.gz.gpg`. Архив идёт из `tar` сразу в `gpg`, открытый
текст на диск не попадает. Режим задаётся в `/opt/neurofax/.env`:

- `BACKUP_GPG_RECIPIENT=<id или email ключа>` (предпочтительно): шифрование
  публичным ключом, приватный ключ на сервере не хранится. Один раз на
  сервере: `gpg --import owner-backup.pub.asc`. Приватный ключ хранит владелец
  (офлайн + копия в менеджере паролей).
- `BACKUP_PASSPHRASE=<длинная случайная строка>`: симметричный AES256.
  Сгенерировать без пробелов и кавычек (`.env` читают и bash, и compose):
  `openssl rand -base64 32`. Фразу обязательно хранить **и вне сервера**
  (менеджер паролей владельца): копия на сервере сгорит вместе с сервером.

Ничего не задано: kit не пишется, в логе строка
`RESTORE KIT NOT SAVED: …` (дамп и файлы при этом делаются как обычно).
Ключи открытым текстом рядом с дампом не лежат никогда. Нужен пакет `gnupg`
(`gpg --version`); без него тоже строка `RESTORE KIT NOT SAVED`.

Проверить, что kit пишется:

```bash
ssh root@167.233.142.75 'ls -l /var/backups/medbook/$(date -u +%F)/; grep -E "restore kit|RESTORE KIT" /var/log/medbook-backup.log | tail -3'
```

Копия вне сервера по-прежнему через `BACKUP_REMOTE` (§4.1, rsync всей папки
дня, kit уезжает вместе с дампом) или ручной `rsync` на ноутбук.

#### Восстановление на новом сервере

1. Поставить Docker, склонировать репозиторий в `/opt/neurofax`.
2. Достать из копии вне сервера папку дня: дамп, файлы и kit.
3. Расшифровать kit **на своей машине или на новом сервере** (нужен
   приватный ключ или фраза из эскроу) и разложить по местам:
   ```bash
   mkdir -p /root/kit && cd /root/kit
   gpg --decrypt restore-kit-<ts>.tar.gz.gpg | tar -xzf -
   ls -la   # .env docker-compose.yml nginx/ _deploy.sh
   cp .env docker-compose.yml _deploy.sh /opt/neurofax/
   cp nginx/nginx.conf /opt/neurofax/nginx/nginx.conf
   cp -r nginx/conf.d/. /opt/neurofax/nginx/conf.d/
   cd /opt/neurofax && git update-index --skip-worktree docker-compose.yml nginx/nginx.conf \
     nginx/conf.d/rtxshop.conf nginx/conf.d/orientatravel.conf
   ```
   Ключ `FIELD_ENCRYPTION_KEY` должен быть **тем же**, что в kit: с другим
   ключом зашифрованные поля не читаются.
4. Поднять postgres и залить дамп (`./ops/restore.sh <дамп>` или §4.3),
   затем `docker compose run --rm worker npx prisma migrate deploy`.
5. Вернуть файлы клиники в MinIO (§4.4, `mirror` в обратную сторону из
   распакованного `files-<ts>.tar.gz`).
6. Поднять стек, `docker exec medbook-nginx-1 nginx -t` и reload, смоук всех
   доменов из `conf.d`.
7. Проверка ключа: `/admin/encryption-health` показывает `Probe round-trip OK`
   и строки под `v1`/`v<n>`; карточка пациента с паспортом открывается; вход
   врача с 2FA проходит.

После каждой смены `.env` (ротация ключа, новый секрет) проверить, что
следующий ночной kit записан.
---

## 5. Демо-данные и сиды: на проде запрещены

Прод neurofax.uz — **реальная клиника**: живая очередь ресепшна, заключения
врачей, записи и оплаты настоящих пациентов. Демо-сидов на проде нет и быть не
должно. Любой из них либо удалит медицинские документы, либо подмешает
выдуманных пациентов, визиты и оплаты в расписание и выручку клиники.

### 5.1 Что нельзя запускать на проде

Никогда, ни с какими флагами:

- `seed-mega-neurofax.ts`, `wipe-neurofax-demo.ts`, `seed-today-live.ts`
  (удаляют данные клиники);
- `seed-demo-data.ts`, `seed-prod-demo.ts`, `seed-clinical-life.ts`
  (добавляют демо-пациентов, визиты, оплаты, заключения от имени врачей);
- `seed-labs-reminders-dev.ts`, `seed-doctor-qa.ts`, `seed-joe-two.ts`,
  `total-stress-seed.ts`, `stress-*.ts` (тестовые, только локальная база);
- `prisma/seed.ts` (перезаписывает название, адрес и шаблоны клиники
  `neurofax`, добавляет случайных пациентов, визиты и оплаты),
  `fix-double-inprogress.ts` (закрывает визиты и пишет оплаты),
  `guard-e2e.ts` (тестовый врач и пациенты), `cleanup-test-conversations.ts`
  (удаляет переписки Telegram).

В образ worker попадают только скрипты из явного списка
`scripts/worker-allowlist.txt` (исправления данных, шифрование, импорт
каталогов, настройка ботов и учёток, отчёты); всё, чего в списке нет, в образ
не входит. Кроме того, все скрипты выше проходят через один предохранитель
`scripts/_destructive-guard.ts`:

- тестовые скрипты, а также `seed-mega-neurofax.ts` и `wipe-neurofax-demo.ts`
  (жёстко нацелены на slug `neurofax`) при `NODE_ENV=production` (образ
  worker) отказывают всегда, обхода нет;
- удаляющие скрипты при `NODE_ENV=production` тоже отказывают всегда, ни
  `--force`, ни переменные окружения не помогают;
- удаляющие скрипты отказывают на клинике, где есть подписанные в
  приложении заключения (не считая демо-пациентов с тегом `demo-seed`), в
  любой среде (ноутбук с `DATABASE_URL` прода тоже) и без всякого обхода:
  признак берётся из самих подписанных версий заключений, а не из журнала,
  так что ни тихая неделя, ни стёртый журнал его не обнулят;
- в клинике с реальными данными (подписанные заключения; в журнале есть
  действия персонала: карточки пациентов, талоны живой очереди, заключения;
  люди работали в системе последние 72 ч) или при `NODE_ENV=production`
  отказ, пока `ALLOW_DEMO_SEED_ON_REAL_DATA` не назовёт клинику по slug.
  Готовую команду с именем клиники отказ не печатает: slug демо-клиники
  вписывают сами. **Для neurofax эту переменную не ставить никогда.**
  `seed-clinical-life.ts` на клинике с реальными данными не запускается даже
  с ней: он подписывает документы от имени врачей;
- после всех этих проверок удаляющие скрипты без `--force` ничего не
  делают (подсказку «добавь --force» клиника с реальными данными не видит);
- `stress-payments-analytics-ai.ts` и `stress-settings-crud.ts` работают
  через API и запускаются только против локального приложения
  (`STRESS_BASE_URL` на localhost).

`prisma/seed-presets.ts` и SQL из `prisma/seed-presets-sql.ts` больше не
стирают шаблоны врачей: пакет получают только врачи, у которых шаблонов ещё
нет.

`prisma/seed-protocols.ts` пишет только глобальные протоколы (без клиники и
врача): недостающие создаёт, существующие обновляет на месте (id не меняется,
скрытие протокола клиникой сохраняется), ничего не удаляет. Личные протоколы
врачей («сохранить как протокол») и протоколы клиники не читает и не трогает.
По умолчанию DRY RUN: `docker compose exec -e APPLY=1 worker npx tsx
prisma/seed-protocols.ts`. `prisma/seed-handouts.ts` выключает только
глобальные памятки, памятки клиники не трогает.

`prisma/seed-drugs.ts` только добавляет: бренды и формы, которые уже есть у
препарата (из госреестра, из `enrich-drug-forms.ts`), сохраняет.

Пары взаимодействий для проверки назначений (таблица `DrugInteraction`, общая
для всех клиник) миграции не заполняют. На новом сервере таблица пуста, и
проверка видит только классовые правила из кода. Поэтому после
`prisma/seed-drugs.ts` и при каждой правке `prisma/_drug-interactions-data.ts`:

```bash
ssh root@167.233.142.75 'cd /opt/neurofax && docker compose exec -T worker npx tsx prisma/seed-drug-interactions.ts'
ssh root@167.233.142.75 'cd /opt/neurofax && docker compose exec -T postgres \
  psql -U medbook -d medbook -tc "SELECT count(*) FROM \"DrugInteraction\";"'
```

Сид заменяет весь набор одной транзакцией: проверка назначений во время
прогона видит старый набор, а не пустую таблицу. Счётчик после прогона больше
нуля. Если сид пишет `ERROR: skipped` и завершается с кодом 1, в каталоге нет
препарата из пары: сначала `prisma/seed-drugs.ts`.

Предохранитель: последний рубеж, а не разрешение. Если команда из старой
заметки, истории терминала или памяти предлагает «освежить демо» на проде,
она устарела.

### 5.2 Где показывать демо

- Локальная база разработчика: `npx tsx scripts/seed-mega-neurofax.ts --force`,
  затем `APPLY=1 npx tsx scripts/seed-prod-demo.ts` (демо-пациенты с тегом
  `demo-seed`) и `npx tsx scripts/seed-today-live.ts --force`.
- Отдельная демо-клиника на стейджинге (свой slug, запуск из рабочей копии
  репозитория, не из образа worker): `seed-demo-data.ts`,
  `seed-clinical-life.ts` и `seed-labs-reminders-dev.ts` без `CLINIC_SLUG` не
  запускаются, `seed-today-live.ts` берёт `CLINIC_SLUG`, `seed-prod-demo.ts`
  берёт `DEMO_CLINIC_SLUG`. `seed-mega-neurofax.ts` и `wipe-neurofax-demo.ts`
  жёстко нацелены на slug `neurofax`, то есть только для локальной базы.

`seed-today-live.ts` удаляет только записи с демо-меткой и берёт только
пациентов с тегом `demo-seed`: реальную запись он не тронет, но на проде ему
всё равно не место (демо-очередь встала бы на табло реальных врачей).

### 5.3 Что на проде можно: исправления данных

Скрипты исправления данных (`backfill-*.ts`, `fix-*.ts`,
`import-clinic-formulary.ts`, `close-stale-in-progress-visits.ts`) написаны
для реальной клиники. Порядок всегда один:

1. ручной бэкап (§4.2);
2. прогон без `APPLY` (DRY RUN): читает и печатает план, ничего не пишет;
3. прогон с `APPLY=1`, если план совпадает с ожиданием.

```bash
ssh root@167.233.142.75 'cd /opt/neurofax && docker compose exec -T worker npx tsx scripts/<имя>.ts'
ssh root@167.233.142.75 'cd /opt/neurofax && docker compose exec -T -e APPLY=1 worker npx tsx scripts/<имя>.ts'
```

`seed-neurofax-real.ts` (каталог клиники) тоже по умолчанию DRY RUN и только
добавляет недостающее: цены, расписания, услуги врачей, активность врачей и
учёток он не меняет. Удалённое в CRM он не возвращает: врача, удалённого
навсегда (или чья учётка осталась без профиля врача), и услугу со сменённым
кодом он пропускает и пишет почему. Перезапись требует явных флагов
(`--reset-prices`, `--reset-schedules`, `--reset-doctor-services`,
`--reactivate`, `--recreate-removed`, `--deactivate-others`). Цены и
расписания на проде меняются в настройках CRM, не этим скриптом.

---

## 6. Регулярные проверки

### Ежедневно (1 минута)

```bash
curl -fsS https://neurofax.uz/api/health | jq '.status,.checks.workers.details'   # "ok","bullmq"
ssh root@167.233.142.75 'cd /opt/neurofax && docker compose ps --format "{{.Name}} {{.Status}}" | grep -v healthy || true'
```

- health `ok`;
- ни одного контейнера в `Restarting`.

### Еженедельно

```bash
ssh root@167.233.142.75 'df -h / ; docker system df'          # диск < 80%
ssh root@167.233.142.75 'docker builder prune -af'            # профилактика кэша сборки
# свежий бэкап существует (ops/backup.sh пишет на диск хоста, §4.1):
ssh root@167.233.142.75 'ls -lh /var/backups/medbook/*/ | tail -6; tail -3 /var/log/medbook-backup.log'
# TLS не истекает (< 20 дней — разбираться с certbot):
echo | openssl s_client -connect neurofax.uz:443 -servername neurofax.uz 2>/dev/null | openssl x509 -noout -enddate
# соседи живы:
for d in rtxshop.uz orientatravel.uz; do curl -sSo /dev/null -w "$d %{http_code}\n" https://$d/; done
```

- `_prisma_migrations` совпадает с `prisma/migrations/` (после каждого деплоя
  со схемой — DEPLOY.md §4.3);
- лог fail-деплоев: `/tmp/deploy.fail` не должен существовать;
- бэкап за вчера есть, дамп больше 1 МБ, в логе нет `FAILED:` (§4.1.1);
- свежая копия забрана с сервера наружу (§4.1, `rsync`).
