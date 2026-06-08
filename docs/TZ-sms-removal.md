# TZ — Удаление SMS из системы (TG + Call Center only)

**Статус:** draft · зафиксирован 2026-06-06 (Javohir)
**Связано:** `docs/TZ.md` §§4 (Каналы коммуникации), §6 (Записи), §7 (Call Center), §11 (Уведомления); `docs/TZ-notifications-cancel-sync.md` (каскад напоминаний — заменяет «TG → SMS fallback» на «TG only»); `docs/TZ-cross-surface-sync.md` (event-bus + webhooks).

## 0. Зачем

SMS как канал нам не нужен. Реальная нагрузка по работе с пациентом распределена так:

- **Telegram (бот + мини-апп)** — основной асинхронный канал: подтверждение записей через inline-кнопки, напоминания, чат, документы, оплата. Покрытие в Узбекистане у TG близко к 100% среди наших клиентов.
- **Call Center** — синхронный канал: звонок ресепшена/оператора пациенту при no-show, риске, перепланировании.

SMS поверх этих двух не даёт нового сигнала:
- Дублирует напоминание из TG (≈90% пациентов получают оба и игнорируют SMS).
- Pull-back пациентов без TG все равно требует звонка — SMS не конвертит сам по себе.
- Тратит бюджет (Eskiz/Playmobile — copecks за штуку, но кумулятивно ощутимо при кампаниях).
- Тянет за собой провайдер-интеграции, rate-limit, STOP-слова, DLR-webhook, opt-out — отдельный слой кода без проп. бизнес-ценности.

**Решение:** убираем SMS из всех новых write-paths. TG + Call Center покрывают весь жизненный цикл напоминания/коммуникации.

## 1. Объём

**In scope (удаляем):**
- Все исходящие SMS write-paths: ad-hoc отправка пациенту, тестовая отправка из настроек, bulk-SMS из drawer записей, SMS-CTA в action-center / call-center.
- Каскад напоминаний — переписать резолвер каналов: TG only. Никакого «TG → SMS fallback».
- CRM-инбокс `/crm/sms` (страница, навигация, переводы).
- Карточка пациента: кнопка SMS в quick-actions, диалог SMS, фильтр канала SMS в коммуникациях.
- Настройки клиники: поле SMS sender name, секция SMS-провайдера в `/crm/settings/integrations`, SMS-квоты в биллинге.
- Мини-апп: SMS как preferredChannel — больше не показываем; backfill silently → `TG`.
- Webhook `/api/sms/webhook/[clinicSlug]` — полное удаление, включая SMS STOP keyword detector и SMS-YES confirmation flow.
- Маркетинг-AI: SMS-вариант копирайта (200ch версия).
- ENV: `ESKIZ_EMAIL`, `ESKIZ_PASSWORD`, `ESKIZ_SENDER`.

**Keep (не трогаем):**
- `Patient.phone` / `Patient.phoneNormalized` / `Clinic.phone` — нужны для звонков из Call Center и идентификации.
- Утилиты `src/lib/phone.ts` — нормализация телефонов (call-центр их использует).
- Историю: `Communication` rows с `channel=SMS`, `NotificationSend` rows с `channel=SMS`, `Conversation/Message` thread c `channel=SMS`, аудит-записи `communication.sms.send` / `integration.sms.test` / `appointment.confirmed.via_sms_reply` — read-only остаются, отображаются как «(legacy)».
- `ConfirmationVia.SMS_REPLY` — оставляем enum value для исторических подтверждений; новые записи никогда не создаём.

**Out of scope (явно):**
- Email-канал — не трогаем (он и так log-only, отдельная история).
- Замена SMS на push-уведомления — не делаем, TG бота достаточно.
- Миграция «телефон-only» пациентов на TG автоматически — это бизнес-процесс ресепшена.
- Резерв «холодного» канала вместо SMS (typed letter, IVR-звонок и т.п.) — не нужен.

## 2. Целевая матрица каналов

| Канал | Триггер | Кто отправляет | Что показываем в UI |
|---|---|---|---|
| **TG bot/miniapp** | автоматические напоминания, подтверждения, отмены, бродкасты | scheduler/worker → bot API | основной канал, "Telegram" в фильтрах |
| **Call (out)** | риск-сегмент, no-show, переноc, follow-up | оператор вручную из Call Center / Action Center | "Позвонить" — primary CTA в риск-карточках |
| **In-app chat** | переписка ресепшена/врача с пациентом в мини-аппе | оператор / врач | "Чат" — внутри патентной карточки |
| ~~SMS~~ | ~~напоминания, broadcast, ad-hoc~~ | удаляется | удаляется из UI |
| Email | сейчас log-only, оставляем как есть | — | "Email" остаётся в фильтрах для совместимости |

**Принцип:** если пациент без `telegramId`, мы не пытаемся достучаться альтернативным каналом автоматически — мы создаём `Action` для оператора («связаться с пациентом без TG»), и оператор звонит из Call Center.

## 3. Изменения по слоям

### 3.1 Prisma schema (`prisma/schema.prisma`)

**Phase A — без миграции (rolling), enum values остаются:**
- `CommunicationChannel.SMS` — оставляем, чтобы старые `Communication` rows читались.
- `ConfirmationVia.SMS_REPLY` — оставляем (исторические подтверждения).
- `ProviderKind.SMS` — оставляем (исторические `ProviderConnection` rows можно показать как "disabled").

**Phase B — миграция (отдельным релизом, через 1-2 недели после Phase A):**
- `Clinic.smsSenderName String?` → DROP COLUMN.
- `ProviderConnection` где `kind = 'SMS'` → DELETE (мы их больше не читаем).
- Опционально: переименовать enum значения на `LEGACY_SMS` / `LEGACY_SMS_REPLY` для прозрачности — но это breaking для read-paths, отложим.

### 3.2 Server services

**Удалить полностью:**
- `src/server/notifications/adapters/sms.ts`
- `src/server/notifications/adapters/sms-log-only.ts`
- `src/server/notifications/adapters/sms-eskiz-stub.ts`
- `src/lib/sms-stop.ts`

**Изменить:**

`src/server/notifications/adapters/index.ts`:
- Убрать `pickSms()`, `sms` ключ в returned adapters, импорт SMS adapter классов.
- В `ProviderConnection` query — убрать `"SMS"` из `kind: { in: [...] }`, оставить только `"TELEGRAM"`.

`src/server/notifications/rules.ts`:
- Тип `channels` → `Array<"TG"> | null` (выпиливаем `"SMS"`).
- `resolveChannels()` — убрать ветку SMS: если у пациента нет `telegramId`, возвращаем `[]` и логируем reason `"no-tg-channel"`. Это превращает доставку в no-op для TG-less пациентов; в Phase B такие случаи материализуются в Action для оператора (см. §3.6).

`src/server/notifications/rate-limit.ts`:
- Удалить `SMS` из `Channel` union и из лимитов.

`src/server/notifications/record-delivery.ts`:
- Удалить `SMS` из `NotificationChannel`. Старые rows читаются по строковому совпадению.

`src/server/notifications/triggers.ts`:
- `getRecipient()` — убрать ветки `if (channel === "SMS") return patient.phone`.
- Каскад `appointment.reminder-*` материализуется только в `TG`.

`src/server/workers/notifications-send.ts`:
- Убрать ветку `if (channel === "SMS") adapters.sms.send(...)` и связанные failure-paths.

`src/server/campaigns/launch.ts`:
- `CampaignChannel` union → `"TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP"` (без `"SMS"`).
- Существующие SMS-кампании в БД (`Campaign.channel = 'SMS'`) на старте launcher: ранний `throw` с понятным сообщением «SMS campaigns are no longer supported».

`src/server/campaigns/dormant-audience.ts`:
- Убрать `smsReady`, расчёт `hasSms`.

`src/server/conversations/find-or-create.ts`:
- Cold-start: предпочитаем `TG`; если нет — конверсация не создаётся автоматически, ресепшен берёт через Call Center.

`src/server/billing/usage.ts` + `src/server/billing/plan-limits.ts`:
- Удалить `smsCountThisMonth`, `ensureSmsLimit`, `maxSmsPerMonth` из feature-flags / plan limits.

`src/server/ai/marketing-copy.ts`:
- `MarketingCopyChannel` — убрать `"SMS"`. AI больше не генерирует SMS-вариант (200ch).

`src/server/appointments/confirm.ts`:
- Кейс `via: "SMS_REPLY"` остаётся в типе (для исторических апдейтов через старые рутины — фактически dead-code после удаления webhook, но не падает).

### 3.3 API routes

**Удалить (route-файлы целиком):**
- `src/app/api/sms/webhook/[clinicSlug]/route.ts` — вебхук провайдера.
- `src/app/api/crm/communications/sms/route.ts` — ad-hoc исходящая SMS.
- `src/app/api/crm/integrations/sms/test/route.ts` — тестовая SMS из настроек.

**Изменить:**
- `src/app/api/crm/communications/[id]/messages/route.ts` (L209-228) — убрать SMS branch.
- `src/app/api/crm/conversations/[id]/messages/route.ts` (L215-228) — убрать SMS branch.
- `src/app/api/crm/clinic/secrets/route.ts` (L46-48) — убрать обработку `smsSenderName`.
- `src/app/api/crm/settings/notifications/templates/[id]/route.ts` — `channels: Array<"TG" | "SMS">` → `Array<"TG">`.
- `src/app/api/platform/usage/route.ts` — убрать `smsSent`.
- `src/app/api/crm/actions/sla/route.ts` — убрать SMS из channels array.
- `src/app/api/crm/shell-summary/route.ts` — убрать SMS unread count.
- `src/app/api/crm/ai/marketing-copy/route.ts` — убрать SMS из ChannelEnum.

### 3.4 CRM UI

**Удалить (целиком):**
- `src/app/[locale]/crm/sms/page.tsx` + `_components/sms-page-client.tsx` — раздел SMS-инбокса.
- `src/app/[locale]/crm/patients/[id]/_components/sms-dialog.tsx` — quick-send диалог.
- Сабменю «SMS-Email» из `src/app/[locale]/crm/settings/page.tsx` (`smsEmail` ключ + `sms` путь).
- SMS-блок в `integrations-client.tsx` (карточка SMS + `SmsTestButton`).
- Поле `smsSenderName` в `clinic-settings-client.tsx`.
- SMS-related виджеты в `billing-client.tsx` (`smsCountThisMonth`, `maxSmsPerMonth`).

**Изменить:**

`src/app/[locale]/crm/notifications/_components/template-editor.tsx`:
- Дефолтный channel `"SMS"` → `"TG"`.
- Удалить SMS-select-option и `smsSegments()` helper.

`src/app/[locale]/crm/notifications/_components/ai-copy-suggest.tsx`:
- Убрать SMS из ChannelType и character-limit маппинга.

`src/app/[locale]/crm/notifications/campaigns/new/_client.tsx`:
- Убрать SMS/TG toggle, оставить только TG.
- Скрыть `smsReady` count.

`src/app/[locale]/crm/notifications/_components/notifications-*.tsx` (sidebar, list, details-rail, page-client):
- Убрать `SMS: MessageSquareIcon` из channel-icons map.
- Убрать SMS из VISIBLE / CHANNELS constants.

`src/app/[locale]/crm/patients/[id]/_components/patient-card-client.tsx`:
- Убрать `smsOpen` state, импорт `SmsDialog`, проп `onOpenSmsDialog`.

`src/app/[locale]/crm/patients/[id]/_components/patient-hero.tsx` / `patient-header.tsx` / `patient-quick-actions.tsx`:
- Убрать `onOpenSmsDialog` пропы и SMS-кнопки. Quick-action остаётся **«Позвонить»** + **«Открыть TG»** + **«Чат»**.

`src/app/[locale]/crm/patients/[id]/_components/tabs/communications-tab.tsx`:
- Убрать SMS-фильтр и иконку.

`src/app/[locale]/crm/appointments/_components/appointments-bulk-bar.tsx`:
- Удалить `sendSms()` функцию и кнопку «SMS напоминание». На замене: **«Напомнить в TG»** (массовая постановка триггера в очередь).

`src/app/[locale]/crm/action-center/_components/risk-today-section.tsx`:
- Убрать `smsPath` и SMS CTA. Primary CTA остаётся **«Позвонить»**, secondary — **«Открыть карточку»**.
- (Это закрывает audit blocker #1: SMS reminder widget bug в reception-live становится moot после §3.4 удаления.)

`src/app/[locale]/crm/call-center/_components/call-actions-rail.tsx`:
- Убрать `smsHref` и кнопку SMS. Star action — звонок (он и был primary), secondary — TG message.

`src/app/[locale]/crm/reception/_hooks/use-reception-live.ts`:
- L102 `channel: "SMS" | "TG"` → `"TG"`.
- `computeUpcomingReminders()` (L260, L289) — убрать SMS-комментарии и SMS-ветки. (Это закрывает audit blocker #1.)

`src/app/[locale]/doctor/settings/_components/notifications-tab.tsx`:
- Убрать SMS-чекбокс из настроек врача.

### 3.5 Mini App (пациентская поверхность)

- `src/app/c/[slug]/my/...`:
  - На экране настроек, если был выбор preferredChannel — убрать опцию SMS.
  - `Patient.preferredChannel = 'SMS'` при загрузке профиля → silently treat as `TG`.

### 3.6 Action Center: новый триггер «no-channel»

Когда `resolveChannels()` возвращает `[]` (пациент без TG), не теряем сигнал:
- В `src/server/notifications/triggers.ts` (или ближе к месту материализации) — вместо silent-skip создаём `Action` типа `PATIENT_NO_CHANNEL` (новый ActionType).
- Action попадает в `/crm/action-center` с предложением «связаться через Call Center».
- Дедуп: одно action per `(patientId, triggerKey)` в течение 24h.

(Это компенсация удаления SMS-fallback. Без неё мы теряем доставку для TG-less пациентов.)

### 3.7 i18n (`src/messages/{ru,uz}.json`)

**Удалить ключи (≈70 в каждой локали):**
- `smsInbox.*` (раздел SMS-инбокса).
- `patientCard.sms*` (диалог).
- `appointments.smsReminder.*`.
- `notifications.channels.SMS`.
- `settings.smsEmail`, `settings.clinic.smsSenderName`, `settings.integrations.sms*`.
- `billing.maxSmsPerMonth`, `billing.smsCountThisMonth`.
- `callCenter.actions.sendSms`, `actionCenter.actions.sendSms`.

**Оставить (для отображения истории):**
- `communications.channel.SMS = "SMS (архив)"` / `"SMS (arxiv)"` — рендерим badge в исторических Communication rows.
- `confirmation.via.SMS_REPLY` — badge у исторических подтверждений.

### 3.8 Webhook / провайдеры

- `/api/sms/webhook/[clinicSlug]` route → 410 Gone на короткий период (Phase A.5) → удаление route-файла (Phase B).
- Eskiz / Playmobile интеграции: `ProviderConnection` rows с `kind=SMS` остаются в Phase A; в Phase B мы их `DELETE` миграцией.
- Если у клиники есть активный Eskiz contract — это операционная задача поддержки (расторгнуть отдельно), код не пытается этим управлять.

### 3.9 Тесты

**Удалить:**
- `tests/unit/sms-stop-detection.test.ts`
- `tests/unit/sms-confirm-webhook.test.ts`
- SMS-блоки из:
  - `tests/unit/confirm-appointment.test.ts` (L213, L407, L427, L481, L504)
  - `tests/unit/settings-schemas.test.ts` (L241-250 `TestSmsSchema`)
  - `tests/unit/feature-nav.test.ts` (SMS nav-item asserts)
  - `tests/unit/ai-marketing-copy.test.ts` (SMS variant tests)
  - `tests/unit/notifications-rate-limit.test.ts` (SMS rate-limit suite)
  - `tests/unit/notifications/rules-config.test.ts`
  - `tests/unit/billing/plan-limits-pure.test.ts` (`maxSmsPerMonth`)
  - `tests/unit/billing/usage.test.ts` (SMS counting)
  - `tests/unit/api-handlers.test.ts` (`SendSmsSchema` validation)
  - `tests/unit/feature-flags.test.ts` (`maxSmsPerMonth`)
  - `tests/unit/appointment-confirmation-flow.test.ts` (L7, L78, L486-487, L634-763 — full SMS branch)
  - `tests/unit/realtime-events.test.ts` (L202 SMS in event channel)
  - `tests/unit/realtime-publish.test.ts` (L102 SMS platform)
  - `tests/unit/subscription-handlers.test.ts` (L176, L189 `maxSmsPerMonth`)
- `tests/e2e/seed.ts` (L94 SMS reply CTA mention).

**Добавить:**
- `tests/unit/notifications-no-channel-action.test.ts` — материализация `PATIENT_NO_CHANNEL` action при TG-less пациенте.
- `tests/unit/legacy-sms-readback.test.ts` — старая Communication с `channel=SMS` корректно рендерится в коммуникациях пациента как «(архив)».

### 3.10 ENV / config

- `.env.example` — выпиливаем секцию `# -------------------- SMS gateways --------------------` целиком (`ESKIZ_EMAIL`, `ESKIZ_PASSWORD`, `ESKIZ_SENDER`).
- `docker-compose.yml` — если в env-секциях были упоминания, убрать (нужно перепроверить).
- Prod VPS: после деплоя Phase A убрать переменные из `/opt/neurofax/.env` (отдельный шаг операционно).

### 3.11 Аудит-actions

`src/lib/audit-actions.ts`:
- Существующие action types `communication.sms.send`, `integration.sms.test`, `appointment.confirmed.via_sms_reply`, `opt-out.sms-stop` — **оставляем в enum** для чтения исторических записей. Новые рутины их не пишут.
- Комментарии в файле обновить (L31, L35, L201, L605) — указать «(legacy, no longer emitted)».

### 3.12 Документация

**Обновить:**
- `docs/TZ.md` §4 (Каналы), §6 (Записи), §7 (Call Center), §11 (Уведомления) — выпилить упоминания SMS как activе-канала, добавить «исторические записи остаются, новые не создаются».
- `docs/TZ-notifications-cancel-sync.md` — таблица каскада: убрать `→ SMS fallback`, оставить только TG.
- `docs/TZ-cross-surface-sync.md` — убрать SMS webhook / DLR упоминания.
- `docs/api/communications.md` — пометить `/sms` endpoint как deprecated/removed.
- `docs/security/phase-7.md` — пометить C1 (SMS webhook secret) как «N/A, surface removed».
- `docs/ROADMAP-11x.md` — вычеркнуть SMS-roadmap пункты или пометить «cancelled, see TZ-sms-removal».

**Создать:**
- `docs/progress/LOG.md` — добавить запись о принятии решения и waves.
- Этот документ (`docs/TZ-sms-removal.md`) — источник правды.

## 4. План по фазам (waves)

### Wave 1 — Server kill-switch (1 день, не-breaking)

Цель: остановить любые исходящие SMS немедленно, без UI-ломки.

1. В `pickSms()` (`adapters/index.ts`) — всегда возвращаем `LogOnlySmsAdapter` (игнорируя clinic config).
2. В `resolveChannels()` — фильтруем `"SMS"` из результата (даже если template его содержит).
3. В `/api/crm/communications/sms` и `/api/crm/integrations/sms/test` — короткий 410 Gone с понятным error code `"SmsRemoved"`.
4. В `/api/sms/webhook/[clinicSlug]` — 200 OK no-op (на случай если провайдер ещё дёргает).

Эффект: SMS de facto перестают уходить, никакой UI ещё не сломан. Откатываемо одним PR.

### Wave 2 — UI убираем (1-2 дня)

1. Удаляем sidebar item «SMS-Email» / `/crm/sms` route, SMS dialog в карточке пациента, SMS-CTA в action/call-center.
2. Out-bulk-bar: убираем кнопку «SMS напоминание», переименовываем оставшуюся в «Напомнить в TG».
3. Notification templates editor: убираем SMS как канал.
4. Campaigns new: убираем SMS toggle.
5. Mini App: скрываем SMS из preferredChannel-селектора.
6. i18n: помечаем удаляемые ключи `__DEPRECATED__:` префиксом для grep-проверки, потом сносим.

После Wave 2 — `npm run lint`, `tsc --noEmit`, фронтовые тесты должны зеленеть. Деплой.

### Wave 3 — Server cleanup (2-3 дня, тесты надо переписать)

1. Удаляем route-файлы: `/api/sms/webhook/...`, `/api/crm/communications/sms`, `/api/crm/integrations/sms/test`.
2. Удаляем `src/server/notifications/adapters/sms*.ts` и `src/lib/sms-stop.ts`.
3. Чистим `adapters/index.ts`, `rules.ts`, `triggers.ts`, `rate-limit.ts`, `workers/notifications-send.ts`, `campaigns/*.ts`, `billing/*.ts`, `ai/marketing-copy.ts`.
4. Удаляем тесты из §3.9.
5. Добавляем `tests/unit/legacy-sms-readback.test.ts` чтобы убедиться: исторические rows читаются.

### Wave 4 — Action Center «no-channel» trigger (1-2 дня)

1. Добавляем `ActionType.PATIENT_NO_CHANNEL` в enum (миграция).
2. В материализаторе уведомлений: если `resolveChannels() === []`, создаём action.
3. UI: action-center показывает «связаться через Call Center» CTA.

(Wave 4 можно сделать параллельно с Wave 3 — они не пересекаются.)

### Wave 5 — Schema cleanup (после стабилизации, через 1-2 недели)

Миграция `prisma/migrations/<ts>_drop-sms-config/migration.sql`:
```sql
ALTER TABLE "Clinic" DROP COLUMN IF EXISTS "smsSenderName";
DELETE FROM "ProviderConnection" WHERE "kind" = 'SMS';
-- Enum values остаются для совместимости с историческими rows.
```

ENV cleanup на prod (`/opt/neurofax/.env`).

### Wave 6 — Documentation pass (0.5 дня)

Обновить `docs/TZ.md`, `docs/TZ-notifications-cancel-sync.md`, `docs/TZ-cross-surface-sync.md`, `docs/api/communications.md`, `docs/ROADMAP-11x.md` согласно §3.12.

## 5. Связь с audit-блокерами (от 2026-06-06)

Audit 4 разделов (Ресепшн / Центр действий / Записи / Расписание) нашёл 8 блокеров. После удаления SMS:

| Блокер | Что меняется |
|---|---|
| #1 Reception SMS reminder widget `.status` vs `.queueStatus` bug (`reception-live.ts:412`) | **MOOT** — виджет удаляется в Wave 2/3. |
| #2 Reception 2000-row pagination silent cap | без изменений, остаётся в полировочном backlog |
| #3 Action Center — missing `publishEventSafe` on mutations | без изменений |
| #4 Action Center CONFIRMED status type cast (`risk-today/route.ts:313`) | без изменений |
| #5 Appointments TZ bugs (`appointment-drawer.tsx:840`, `appointments-table.tsx:132`) | без изменений |
| #6 Appointments `bulk-status` route — missing queueStatus sync + SSE | без изменений (SMS bulk был отдельной кнопкой — она удаляется в Wave 2) |
| #7 STATUS_VARIANT missing SKIPPED | без изменений |
| #8 Calendar TZ bugs / 2000-row cap / "Today" stale | без изменений |

Итого: один блокер закрывается удалением фичи. Остальные семь идут в обычный bug-fix wave после Wave 2.

## 6. Откат / совместимость

- Wave 1 (kill-switch) — откатываемо одной revert-commit.
- Wave 2-3 — после деплоя SMS-функционала больше нет; откат потребует возврата кода и провайдер-конфига.
- Wave 5 (schema cleanup) — необратима без `pg_restore`. Перед миграцией снять снапшот БД (стандартная процедура medbook prod-deploys).
- Исторические данные (Communication, Conversation/Message, NotificationSend, AuditLog) — read-only, доступны на всех фазах.

## 7. Acceptance criteria

После Wave 3:
- [ ] Никакой код не вызывает `adapters.sms.send()`.
- [ ] `grep -ri 'sms' src/` возвращает только: (а) комментарии «legacy», (б) исторический enum-handler в read-path, (в) phone-normalization (для звонков).
- [ ] CRM UI: ни одного видимого упоминания SMS, кроме badge «архив» в исторических коммуникациях.
- [ ] Notification scheduler: при TG-less пациенте создаёт `PATIENT_NO_CHANNEL` action, а не silently-skips.
- [ ] Mini App: пациент с `preferredChannel=SMS` (legacy) видит default-UI как если бы `preferredChannel=TG`.
- [ ] `npm test` зеленеет.
- [ ] Соседи на shared VPS (rtxshop, orientatravel) не задеты — smoke `curl https://rtxshop.uz`, `https://orientatravel.uz` после деплоя.

После Wave 5:
- [ ] `\d Clinic` не содержит `smsSenderName`.
- [ ] `SELECT * FROM "ProviderConnection" WHERE kind='SMS'` пуст.

## 8. Open questions (нужно подтвердить с тобой)

1. **Удалять ли `Clinic.smsSenderName` в Phase A или ждать Phase B?**
   Рекомендация: ждать Phase B (минимизировать breaking-change поверхность в Phase A; column просто перестаёт читаться).

2. **Что делать с активными Eskiz/Playmobile контрактами клиник?**
   Это операционная задача — отдельно списком клиник проверить, у кого подписка, и помочь расторгнуть. Код за это не отвечает.

3. **Нужен ли badge «архив» на исторических SMS communications, или просто скрываем?**
   Рекомендация: badge `[архив]` рядом с каналом. Прячет → потеря инфы для аудита.

4. **PATIENT_NO_CHANNEL action — авто-маршрутизация в Call Center как-то особенно?**
   Сейчас action попадает в общий `/crm/action-center`. Если хотим — можем сразу проставлять `assignedTo` = роль "operator" (если в clinic есть один оператор) или добавлять SLA × 24h.

5. **Мини-апп: ли стоит показывать пациенту «вы можете подключить TG для напоминаний» при отсутствии linked TG?**
   Это уже Mini App работа — отдельная задача (вероятно `TZ-miniapp-overhaul`), здесь только обозначаем.

## 9. Изменения за пределами кода

- Обновить публичную страницу/маркетинг (если где-то упоминаются «SMS-напоминания»).
- Сообщить активным клиникам, что SMS-канал убран (templated письмо/звонок).
- При следующем merge в `docs/TZ.md` — секция «Каналы» переписана.
