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
- [5. Обслуживание демо-данных](#5-обслуживание-демо-данных)
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
| `medbook-minio-1` | `minio/minio` | S3-хранилище файлов (bucket `medbook` — приватный, файлы отдаются через streaming-proxy приложения, не по presigned URL); volume `miniodata` |
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
docker compose up -d --no-deps --force-recreate app worker
docker exec medbook-nginx-1 nginx -s reload
```

Проверка результата:

```bash
docker compose exec -T postgres psql -U medbook -d medbook -tc \
  "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"
```

---

## 4. Бэкап и восстановление

> 🔴 **СОСТОЯНИЕ НА 2026-08-20: автоматический бэкап medbook на текущем сервере
> НЕ НАСТРОЕН.** Проверено: в `crontab -l` root'а есть только бэкап
> travel-crm; в MinIO нет бакета `medbook-backups` (только `medbook` и
> `rtxshop`) — т.е. ночной дамп не запускался ни разу с миграции на Hetzner.
> Пока прод — демо-окружение без реальных пациентов, это терпимо; **перед
> заходом первой живой клиники бэкап обязан быть включён.**

### 4.1 Включить ночной бэкап (однократно)

Скрипт в репо: `ops/backup.sh` (pg_dump → gzip → MinIO
`medbook-backups/backups/`, ретенция 30 дней). Внимание: пример крона в
`ops/crontab.example` указывает на несуществующий `/opt/medbook` — путь
заменить:

```bash
ssh root@167.233.142.75
( crontab -l 2>/dev/null; echo '0 3 * * * cd /opt/neurofax && ./ops/backup.sh >> /var/log/medbook-backup.log 2>&1' ) | crontab -
# прогнать руками и убедиться, что дамп лёг:
cd /opt/neurofax && ./ops/backup.sh
```

⚠️ Скрипт использует docker-сеть `medbook_default` и креды MinIO из `.env` —
при первом запуске проверить, что бакет `medbook-backups` создался и файл
`pg-medbook-<дата>.sql.gz` появился.

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
  docker compose exec -T postgres psql -U medbook -d medbook
```

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

---

## 5. Обслуживание демо-данных

Прод neurofax.uz сейчас — **демо-окружение** (реальных пациентов нет).
Демо-жизнь клиники создаётся сидами; оба гоняются **из контейнера worker**:

### 5.1 `seed-mega-neurofax.ts` — полная пересборка

```bash
ssh root@167.233.142.75 'cd /opt/neurofax && \
  docker compose exec -T worker npx tsx scripts/seed-mega-neurofax.ts'
```

- 🔴 **РАЗРУШИТЕЛЬНЫЙ**: вытирает у клиники `neurofax` ВСЕ доменные данные
  (пациенты, записи, кейсы, визиты, платежи, документы, переписки, звонки,
  лиды, аудит клиники...) и генерирует заново богатый срез «работающей
  клиники».
- Сохраняет каркас: Clinic, Branch, User, Doctor, Service, Cabinet,
  DoctorSchedule, NotificationTemplate, интеграции, подписку.
- Запускать только осознанно и только на демо. На БД с реальной клиникой —
  никогда (сид жёстко нацелен на slug `neurofax`, но осторожность обязательна).

### 5.2 `seed-today-live.ts` — освежить «сегодня»

```bash
ssh root@167.233.142.75 'cd /opt/neurofax && \
  docker compose exec -T worker npx tsx scripts/seed-today-live.ts'
```

Пересобирает **только сегодняшнюю** живую очередь под текущий момент времени
(табло выглядит «в середине смены»): two-lanes порядок, тикеты, срочный bump.
Прошлые/будущие дни не трогает. Идемпотентен, можно гонять перед каждым показом.

### 5.3 Сиды «протухают»

У mega-сида горизонт по датам — записи насыпаны на ограниченное число дней
вперёд. Через ~2 недели календарь и «сегодня» пустеют — демо выглядит мёртвым.
Это не баг, лечится повторным прогоном:

- быстрый вариант перед показом: `seed-today-live.ts` (если пациенты/записи в
  целом ещё есть, а пустое только «сегодня»);
- полный вариант: `seed-mega-neurofax.ts` (когда высохло всё).

После mega-сида время «сегодняшних» событий строится по Ташкенту — если табло
показывает пустой день из-за UTC-сдвига, прогнать `seed-today-live.ts`.

---

## 6. Регулярные проверки

### Ежедневно (1 минута)

```bash
curl -fsS https://neurofax.uz/api/health | jq '.status,.checks.workers.details'   # "ok","bullmq"
ssh root@167.233.142.75 'cd /opt/neurofax && docker compose ps --format "{{.Name}} {{.Status}}" | grep -v healthy || true'
```

- health `ok`;
- ни одного контейнера в `Restarting`;
- (пока прод демо) табло/календарь не пустые — иначе §5.

### Еженедельно

```bash
ssh root@167.233.142.75 'df -h / ; docker system df'          # диск < 80%
ssh root@167.233.142.75 'docker builder prune -af'            # профилактика кэша сборки
# свежий бэкап существует (после включения крона §4.1):
ssh root@167.233.142.75 'cd /opt/neurofax && docker run --rm --network medbook_default \
  -e MC_HOST_x="http://$(grep MINIO_ACCESS_KEY .env | cut -d= -f2):$(grep MINIO_SECRET_KEY .env | cut -d= -f2)@minio:9000" \
  minio/mc:latest ls x/medbook-backups/backups/ | tail -3'
# TLS не истекает (< 20 дней — разбираться с certbot):
echo | openssl s_client -connect neurofax.uz:443 -servername neurofax.uz 2>/dev/null | openssl x509 -noout -enddate
# соседи живы:
for d in rtxshop.uz orientatravel.uz; do curl -sSo /dev/null -w "$d %{http_code}\n" https://$d/; done
```

- `_prisma_migrations` совпадает с `prisma/migrations/` (после каждого деплоя
  со схемой — DEPLOY.md §4.3);
- лог fail-деплоев: `/tmp/deploy.fail` не должен существовать;
- демо-сиды не протухли (§5.3).
