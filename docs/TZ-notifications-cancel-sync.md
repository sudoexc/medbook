# TZ — Уведомления, отмена записи из мини-аппа, real-time синхронизация

**Статус:** active · черновик зафиксирован 2026-06-05 (Javohir)
**Связано:** `docs/TZ.md` §6 (Записи), §11 (Уведомления); `docs/TZ-cross-surface-sync.md` (event-bus + outbox); `docs/TZ-miniapp-overhaul.md` (пациентская поверхность).

## 0. Зачем

Сейчас:
- Отмена записи из мини-аппа технически работает, но (а) спрятана внутри детального модала, (б) не запрашивает причину, (в) staff-инициированная отмена в CRM не порождает текст пациенту.
- Каскад напоминаний — 3d / 24h / 5h / 2h — спроектирован под «холодного» пациента, не под пик нагрузки day-of. Пациент за час до приёма часто уже выключился из контекста.
- Опоздание и неявка фиксируются в БД, но текстового канала наружу нет: воркер `appointment-lifecycle-sweep` (Phase B) флипает NO_SHOW, но пациент не получает «жаль, что не получилось, давайте перенесём».
- Cross-surface sync: CRM подписан на SSE через `use-appointments-list.ts`. Мини-апп — **нет**. Сценарий «ресепшен отменил, у пациента открыт мини-апп» проваливается до следующего refetch.

Цель: каскад пинг-уведомлений day-of, понятная отмена из мини-аппа с причиной, и закрытие дыры в синхронизации.

## 1. Объём

**In scope:**
- Новый каскад напоминаний: 24h + 5h + 3h + 1h (4 пинга, вместо нынешних 4 из 3d+24h+5h+2h).
- Триггер `APPOINTMENT_CANCELLED` (новый enum) — текст пациенту при отмене (staff-init: «извините, перезаписаться?»; patient-init: «отменено, ждём обратно»).
- Триггер `APPOINTMENT_RUNNING_LATE` (новый enum) — текст «вас ждут, позвоните если опаздываете».
- Триггер `APPOINTMENT_MISSED` (уже есть в enum, не подключён) — текст «давайте перенесём».
- Cancel UX в мини-аппе: кнопка «Отменить» прямо на карточке + модал с 3 пресетами причины + free text.
- Cross-surface SSE-подписка в `use-appointments.ts` мини-аппа.
- Дефолтные шаблоны текстов на ru/uz — хранятся в коде (`src/server/notifications/text-templates.ts`), сидятся при первой клинике автоматически (миграция-сидер). Админ потом может править через `/crm/notifications`.

**Out of scope (явно):**
- Пользовательский редактор каденса (3h/1h hardcoded для всех клиник; админ всё ещё может задать custom `APPOINTMENT_BEFORE` offsets через UI).
- Двунаправленные SMS (cancel по СМС).
- Push-через-email.
- Изменение confirm-каскада 24h/2h inline-кнопок (живёт отдельно).
- Метрики/дашборды по новым триггерам — это будущая Phase 18 wave.

## 2. Каскад напоминаний

> **Обновление Q2 2026 (после `TZ-sms-removal.md` Waves 1-5):** канал SMS убран. Все триггеры ниже теперь идут только в TG (с in-app зеркалом для linked-TG пациентов). Если TG не подключён — материализуется `PATIENT_NO_CHANNEL` action в `/crm/action-center`, и регистратура звонит пациенту вручную (см. §3.6 TZ-sms-removal).

| Offset | Кому когда | Канал | Замечание |
|---|---|---|---|
| **−1440 мин (24h)** | За день до приёма | TG (+INAPP mirror) | Существует, оставляем |
| **−300 мин (5h)** | Утром того же дня (если приём ≥ 5h) | TG (+INAPP mirror) | Существует, оставляем |
| **−180 мин (3h)** | **НОВЫЙ** — за 3 часа | TG (+INAPP mirror) | Замещает функцию 2h-пинга |
| **−60 мин (1h)** | **НОВЫЙ** — за час | TG (+INAPP mirror) | Финальный «выходим скоро» |

Выпиливаем из канонического списка `−4320` (3d) и `−120` (2h). Существующие per-clinic templates с этими offsetMin остаются в БД, но scheduler по ним не материализует — админ может перевести в кастом-каскад вручную.

Дедуп: текущий `(appointmentId, templateId)` — сохраняется. Каждый offset — отдельный templateId, второй фаер не пройдёт.

Реализация — `src/server/notifications/triggers.ts:whereForTrigger` + новые `TriggerKey` `appointment.reminder-3h`, `appointment.reminder-1h`; в `runScheduledTriggers` добавляем 180/60 в канонический список.

## 3. Триггеры

| TriggerKey | NotificationTrigger (enum) | Кто фаерит | Когда | Канал | Дедуп |
|---|---|---|---|---|---|
| `appointment.reminder-24h` | `APPOINTMENT_BEFORE` | scheduler tick | now ≥ date−24h | TG (+INAPP) | NotificationSend(appt+tpl) |
| `appointment.reminder-5h` | `APPOINTMENT_BEFORE` | scheduler tick | now ≥ date−5h | TG (+INAPP) | -//- |
| `appointment.reminder-3h` | `APPOINTMENT_BEFORE` | scheduler tick | now ≥ date−3h | TG (+INAPP) | -//- |
| `appointment.reminder-1h` | `APPOINTMENT_BEFORE` | scheduler tick | now ≥ date−1h | TG (+INAPP) | -//- |
| `appointment.cancelled.by-staff` | `APPOINTMENT_CANCELLED` (NEW) | `cancelAppointment` kernel, когда `surface ≠ MINIAPP` | сразу после flip | TG (+INAPP) | NotificationSend(appt+tpl) |
| `appointment.cancelled.by-patient` | `APPOINTMENT_CANCELLED` (NEW) | `cancelAppointment` kernel, когда `surface = MINIAPP` | сразу после flip | TG only | NotificationSend(appt+tpl) |
| `appointment.running-late` | `APPOINTMENT_RUNNING_LATE` (NEW) | `appointment-lifecycle-sweep` | `isRunningLate(row, now)` && нет существующего send | TG (+INAPP) | NotificationSend(appt+tpl) |
| `appointment.no-show` | `APPOINTMENT_MISSED` (existing enum) | `appointment-lifecycle-sweep` после auto-flip, **и** `bulk-status` route при ручной NO_SHOW | сразу после flip | TG (+INAPP) | NotificationSend(appt+tpl) |

Cancel при отмене:
- Все будущие `NotificationSend` для этой записи со статусом `QUEUED` помечаются `CANCELLED` (через `cancel.ts`) — не спамим пациента напоминалкой о записи, которой уже нет.

## 4. Шаблоны текстов (черновик)

Все плейсхолдеры: `{name}`, `{date}`, `{time}`, `{doctor}`, `{clinicPhone}`, `{clinicName}`. Тон — уважительный «вы», без эмодзи. Историческое ограничение ≤160 chars (SMS-совместимость) снято после `TZ-sms-removal.md`; для TG текст может быть произвольной длины, но шаблоны остаются короткими ради читаемости в пуш-нотификации.

### 4.1 `appointment.reminder-24h`

**RU:** `{name}, напоминаем: завтра в {time} вы записаны к {doctor} в {clinicName}. Если планы изменились — отмените через приложение или позвоните {clinicPhone}.`

**UZ:** `{name}, eslatamiz: ertaga soat {time} da {doctor} qabuliga yozilgansiz ({clinicName}). Rejalar o'zgargan bo'lsa — ilovadan bekor qiling yoki {clinicPhone} ga qo'ng'iroq qiling.`

### 4.2 `appointment.reminder-5h`

**RU:** `{name}, через 5 часов в {time} — ваш приём у {doctor}. До встречи.`

**UZ:** `{name}, 5 soatdan keyin soat {time} da — {doctor} bilan qabulingiz. Ko'rishguncha.`

### 4.3 `appointment.reminder-3h` (NEW)

**RU:** `{name}, через 3 часа в {time} ждём вас у {doctor}. Если что-то изменилось — отмените в приложении.`

**UZ:** `{name}, 3 soatdan keyin {time} da {doctor} sizni kutmoqda. Reja o'zgarsa — ilovadan bekor qiling.`

### 4.4 `appointment.reminder-1h` (NEW)

**RU:** `{name}, через час в {time} — ваш приём у {doctor}. Выходите заранее.`

**UZ:** `{name}, bir soatdan keyin {time} da — {doctor} bilan qabulingiz. Oldindan yo'lga chiqing.`

### 4.5 `appointment.cancelled.by-staff` (NEW)

**RU:** `{name}, ваш приём {date} в {time} к {doctor} отменён. Извините за неудобство. Перезаписаться можно в приложении или по телефону {clinicPhone}.`

**UZ:** `{name}, {date} kuni {time} dagi {doctor} bilan qabulingiz bekor qilindi. Noqulaylik uchun uzr. Qayta yozilish — ilovadan yoki {clinicPhone}.`

### 4.6 `appointment.cancelled.by-patient` (NEW)

**RU:** `Приём {date} в {time} отменён. Если передумаете — мы рядом, перезаписаться можно в любое время.`

**UZ:** `{date} kuni {time} dagi qabul bekor qilindi. Fikringizni o'zgartirsangiz — biz yondamiz, istalgan vaqt qayta yozilishingiz mumkin.`

### 4.7 `appointment.running-late` (NEW)

**RU:** `{name}, вас ждут в {clinicName} — приём был назначен на {time} к {doctor}. Если опаздываете, позвоните {clinicPhone}, постараемся сохранить слот.`

**UZ:** `{name}, {clinicName} da kutishyapti — qabul {time} ga {doctor} ga belgilangan edi. Kechiksangiz, {clinicPhone} ga qo'ng'iroq qiling, slotni saqlashga harakat qilamiz.`

### 4.8 `appointment.no-show` (NEW)

**RU:** `{name}, жаль, что приём {date} не состоялся. Хотите перенести? Подберём удобное время — откройте приложение или позвоните {clinicPhone}.`

**UZ:** `{name}, {date} dagi qabul bo'lib o'tmagani uchun afsus. Boshqa vaqtga ko'chiramizmi? Qulay vaqtni tanlaymiz — ilovani oching yoki {clinicPhone} ga qo'ng'iroq qiling.`

Тексты — последняя редактируемая правда, могут быть отредактированы через `/crm/notifications` в любой момент.

## 5. Cancel UX в мини-аппе

### 5.1 Аффорданс

На карточке `upcoming` (внутри `appointments-screen.tsx`): добавляется компактная иконочная кнопка «✕» в правом верхнем углу (рядом с детальной зоной — не перехватывает основной клик «открыть карточку»). Tap → открывается `CancelReasonDialog`.

В детальном модале существующая кнопка `MButton variant="danger"` остаётся, но её `onClick` тоже маршрутизируется через `CancelReasonDialog`, чтобы UX был единым.

### 5.2 `CancelReasonDialog`

Bottom-sheet modal (var `--tg-bg`, slide-up animation):
- Заголовок: «Почему отменяете?» / «Nima uchun bekor qilyapsiz?»
- Подзаголовок: «Это поможет клинике лучше работать. Можно не указывать.» / «Bu klinikaga yaxshiroq ishlashga yordam beradi. Ko'rsatish shart emas.»
- Пресеты (radio):
  1. «Не получится прийти» / «Kela olmayman»
  2. «Болею / плохо себя чувствую» / «Kasalman / o'zimni yomon his qilyapman»
  3. «Хочу перенести на другое время» / «Boshqa vaqtga ko'chirmoqchiman»
- Опция «Другое» / «Boshqa» — раскрывает textarea (`maxLength=300`)
- Кнопки: «Отменить запись» (destructive) и «Назад» (ghost)

Маппинг пресета → `cancelReason` (storage в БД):
- preset 1 → `"patient:cant-come"`
- preset 2 → `"patient:unwell"`
- preset 3 → `"patient:wants-reschedule"`
- кастом → `"patient:custom: <текст>"` (префикс для разделения в аналитике)

Третий пресет дополнительно показывает CTA «Перенести вместо отмены» → переключает в режим reschedule детального модала. Если пользователь всё-таки решает отменить — записывается reason, отмена улетает.

### 5.3 API

`DELETE /api/miniapp/appointments/[id]` — расширяется:
```
body?: { reason?: string }
```
Передаётся в `cancelAppointment({ reason })`. Если пациент пресетов выбрал — kernel записывает в `Appointment.cancelReason` + audit meta `reason`.

Без `reason` → kernel пишет `null` (как сейчас).

### 5.4 Идемпотентность + race

Двойной тап «Отменить запись» в нестабильной TG-сети:
- Оптимистический UI уже есть (флип на `CANCELLED` в `useCancelAppointment.onMutate`).
- Kernel — идемпотентный: повторный вызов на `CANCELLED` возвращает `{ alreadyCancelled: true }`.
- Notification trigger fire'ится только при `alreadyCancelled === false`, иначе дубль текста.

## 6. Real-time синхронизация

### 6.1 Подписка мини-аппа

В `src/app/c/[slug]/my/_hooks/use-appointments.ts` добавляется внутренний эффект:

```ts
useLiveEvents(
  (e) => {
    qc.invalidateQueries({
      queryKey: ["miniapp", "appointments", clinicSlug],
    });
  },
  {
    filter: [
      "appointment.created",
      "appointment.cancelled",
      "appointment.statusChanged",
      "appointment.moved",
      "appointment.updated",
    ],
  },
);
```

`/api/events` SSE-канал работает per-clinic; мини-апп получает только события своей клиники.

### 6.2 Backpressure

`useLiveEvents` уже throttle'ит invalidations через `qc.invalidateQueries` (TanStack сам коалесцирует множественные invalidate в один refetch). Дополнительный debounce не нужен.

### 6.3 Сценарии проверки (smoke)

| Сценарий | Ожидание |
|---|---|
| Patient cancels в мини-аппе, у ресепшена открыта CRM `/crm/appointments` | Строка серая (CANCELLED) за ≤2 сек, без F5 |
| Receptionist cancel'ит в CRM, у пациента открыт мини-апп | Карточка `upcoming` исчезает / переезжает в `past` за ≤2 сек |
| Patient ставит NO_SHOW (через auto-sweep, время прошло на 60+ мин) | На обеих поверхностях статус обновляется без рефреша |
| Reschedule (patient или staff) | `appointment.moved` → обе стороны обновляются |
| Параллельный cancel/reschedule (rare race) | Окончательное состояние — последняя успешная мутация; UI сходится |

## 7. Изменения в Prisma + миграции

### 7.1 Schema

```prisma
enum NotificationTrigger {
  APPOINTMENT_CREATED
  APPOINTMENT_BEFORE
  APPOINTMENT_CANCELLED      // NEW
  APPOINTMENT_RUNNING_LATE   // NEW
  APPOINTMENT_MISSED
  APPOINTMENT_COMPLETED
  PATIENT_BIRTHDAY
  CASE_REPEAT_DUE
}
```

`Appointment.cancelReason` уже `String?` — без изменений.

### 7.2 Migration `add_cancellation_running_late_triggers`

- `ALTER TYPE "NotificationTrigger" ADD VALUE 'APPOINTMENT_CANCELLED';`
- `ALTER TYPE "NotificationTrigger" ADD VALUE 'APPOINTMENT_RUNNING_LATE';`

### 7.3 Seeding шаблонов

Новый файл `src/server/notifications/default-templates.ts` экспортирует `defaultAppointmentTemplates(clinicId)` — массив `Prisma.NotificationTemplateCreateInput[]`. Семь объектов (4 reminder + 2 cancelled + 1 running-late + 1 missed).

Хук в `cancelAppointment.fireTrigger` уже падает корректно, если шаблона нет (трой-пас по `whereForTrigger` возвращает `null` → silent skip). Поэтому код безопасно жить без seed'а — старые клиники просто не получают новых сообщений, пока админ их не создаст.

Однако для UX-первого-запуска делаем **миграцию-сидер**: для каждой существующей `Clinic`, у которой нет ни одного `NotificationTemplate` с этими trigger-ами — вставляем дефолты. Делается через TypeScript-migration runner (есть в `prisma/migrations.ts` — sanity check этого, при отсутствии — пишем idempotent `prisma db seed`-style скрипт `scripts/seed-notification-templates.ts` и вызываем разово после деплоя).

## 8. Изменения в воркерах

### 8.1 `notifications-scheduler.ts` (legacy pass)

В `runScheduledTriggers` (или там, где хранится канонический список offsets) добавляем `-180`, `-60`; удаляем `-4320` и `-120` из канонического. Существующие per-clinic templates с этими offsetMin продолжают работать только если админ их явно держит как dynamic (динамический pass подхватит).

### 8.2 `appointment-lifecycle-sweep.ts` (Phase B)

Расширение tick'а:
1. Текущая логика: BOOKED/CONFIRMED/SKIPPED + `endDate + 60min < now` → NO_SHOW. **После flip'а** — fire `appointment.no-show`.
2. **НОВЫЙ** под-проход: BOOKED/CONFIRMED + `isRunningLate(row, now)` && `!alreadyScheduled(running-late, appt)` → `fireTrigger('appointment.running-late', appt)`.

Дедуп — через существующий `NotificationSend(appointmentId, templateId)` unique key. Не плодим колонки `runningLateNotifiedAt`.

### 8.3 `cancel.ts` kernel

Замена единого `appointment.cancelled` на ветвление:
```ts
const kind = surface === "MINIAPP" 
  ? "appointment.cancelled.by-patient" 
  : "appointment.cancelled.by-staff";
fireTrigger({ kind, appointmentId: after.id });
```

И — внутри той же tx, до publish — отменяем будущие QUEUED reminder'ы:
```ts
await tx.notificationSend.updateMany({
  where: { appointmentId, status: "QUEUED" },
  data: { status: "CANCELLED" },
});
```

### 8.4 CRM `bulk-status` route

После `updateMany` для `target === "NO_SHOW"` — fire `appointment.no-show` для каждого id. Можно одним проходом через `Promise.all(...fireTrigger)` за пределами transaction'а (fire is non-blocking).

## 9. Frontend изменения

### 9.1 Мини-апп — новые файлы

- `src/app/c/[slug]/my/_components/appointments/cancel-reason-dialog.tsx` — bottom-sheet с пресетами + textarea.
- Расширение `appointments-screen.tsx` — иконка «✕» на карточке + state для открытия диалога.

### 9.2 `use-appointments.ts`

- Расширение `useCancelAppointment` принимает опциональный `reason: string`.
- Подписка на SSE через `useLiveEvents`.

### 9.3 i18n

`src/messages/ru.json` + `uz.json` — новые ключи под `miniapp.appts.cancelReason.*` (presets / customLabel / submit / back).

## 10. Дедупликация + idempotency

Centralized дедуп через `NotificationSend` уникальный индекс `(clinicId, templateId, appointmentId)`. Все новые точки fire'а:
- `cancelAppointment.fireTrigger` — стрельнёт один раз для одной (appt, template)-пары; повторная отмена уже-cancelled row'а не вызовет fire (kernel вернётся `alreadyCancelled`).
- `appointment-lifecycle-sweep` running-late — следующий tick (через 10 мин) увидит существующий NotificationSend и не повторит.
- `appointment-lifecycle-sweep` no-show — после flip'а статус становится NO_SHOW, исключается из выборки следующих тиков → одиночный fire гарантирован.
- `bulk-status` route — материализует `appointment.no-show` для всех новых NO_SHOW. Повторный bulk-status на уже-NO_SHOW row'е блокируется guard'ом в `canTransitionAt` → второго fire'а нет.

## 11. Audit

- `cancelAppointment` уже пишет `APPOINTMENT_CANCELLED` audit row. Расширяем `meta` полем `reasonPreset` (один из четырёх кодов) для аналитики.
- `appointment-lifecycle-sweep` уже пишет `appointment.auto-no-show` (Phase B).
- Новые fire'ы триггеров пишутся через стандартный путь `NotificationSend` (это и есть audit-источник для каналов).

## 12. Smoke

После деплоя в `/opt/neurofax/`:
1. Открыть `https://neurofax.uz/c/neurofax/my` — карточка upcoming-записи имеет «✕».
2. Кликнуть «✕» → bottom-sheet с пресетами появляется.
3. Выбрать preset → клик «Отменить запись» → запись исчезает из upcoming.
4. В соседней вкладке (`/[locale]/crm/appointments`) — строка перешла в CANCELLED за ≤2 сек.
5. На TG-аккаунте пациента — пришёл текст «Приём отменён…».
6. На TG-аккаунте пациента — за 24h/5h/3h/1h до приёма приходят 4 пинга (smoke: создать appt через час, проверить 1h-pinger через ~1 минуту после old.scheduledFor < now).
7. Проверить running-late: создать appt на сейчас−16 мин с CONFIRMED → следующий sweep tick фаерит running-late текст.
8. Проверить no-show: appt на сейчас−61 мин CONFIRMED → следующий sweep tick флипает в NO_SHOW + фаерит no-show текст.

## 13. Деплой

Стандартный flow `reference_medbook_vps_access.md`:
1. `git pull && docker compose build app worker`
2. `docker compose run --rm worker npx prisma migrate deploy` — применит enum-расширение.
3. `npx tsx scripts/seed-notification-templates.ts` (один раз, после migrate).
4. `docker compose up -d --no-deps --force-recreate app worker`
5. `docker exec medbook-nginx-1 nginx -s reload`
6. Smoke по §12.

Соседи (rtxshop, orientatravel) — не задеваются.

## 14. Что МЫ НЕ делаем (явно)

- Не строим UI редактора каденса в `/crm/notifications` под новые offset'ы (3h, 1h) — они захардкожены в scheduler. Кастомные offset'ы у админа всё ещё работают (dynamic pass).
- Не добавляем колонку `Clinic.minCancellationHours` — все отмены принимаются. Если позже нужна политика — отдельный TZ.
- Не вытаскиваем running-late в отдельный worker — paгается на существующий sweep tick (10 мин — достаточно).
- Не делаем reaction-кнопки на сообщения cancel/no-show (типа inline «перезаписаться»). TG inline-кнопки требуют per-template config — отдельная задача, если потребуется.
