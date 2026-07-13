# ТЗ — Исходы обзвона риска + каскад напоминаний 5д/3д/1д/3ч

**Статус:** Approved 2026-07-13 (владелец) · автор: фидбек с прода
**Проблема:** виджет «Риск сегодня» (Action Center) — кнопка «Обработано» ничего
не сохраняет (просто `Action.status=DONE`), исход разговора теряется, а строки
`NO_SHOW_RISK_HIGH` **воскрешаются движком через 15 мин** (recompute в
`repository.ts:145` возвращает DONE→OPEN, т.к. звонок не меняет входы риска).
Отсюда «клиент исчезает / непонятная логика». Плюс каскад напоминаний в коде =
24ч/5ч/3ч/1ч, а нужен 5д/3д/1д/3ч.

---

## 1. Исходы «Обработано» (6)

Кнопка «Обработано» → меню исхода. Каждый делает **правильную durable-запись**,
чтобы строка вела себя предсказуемо и клиент не терялся.

| Исход | Ввод | Доменное действие | Судьба строки |
|---|---|---|---|
| ✅ Подтвердил | — | `confirmAppointment(via: INBOUND_CALL)` | DONE(outcome), не воскреснет |
| 🔁 Перенести | новый слот (диалог) | reschedule (существующий PATCH) → напоминания перепланируются | DONE(outcome=RESCHEDULED) |
| ⏰ Перезвонить позже | дата-время + заметка | `SNOOZED, snoozeUntil=callbackAt` | вернётся в callbackAt |
| 📅 Хочет прийти позже | дата возврата + заметка | `SNOOZED, snoozeUntil=returnDate`; (опц. отменить текущую) | всплывёт как «хотел вернуться» |
| ❌ Отказался | причина | `cancelAppointment(reason=note)` | DONE(outcome=REFUSED) |
| 📵 Не дозвонился | — | `callAttempts++`, `SNOOZED +NO_ANSWER_SNOOZE`; после N — эскалация severity | вернётся через короткий снуз |

## 2. Схема — расширение `Action` (аддитивно)

```prisma
model Action {
  // … existing
  outcome      String?   // CONFIRMED|RESCHEDULED|CALLBACK|RETURN_LATER|REFUSED|NO_ANSWER
  outcomeNote  String?   @db.Text
  callbackAt   DateTime? // когда всплыть заново (CALLBACK) / дата возврата (RETURN_LATER)
  resolvedById String?   // User, кто зафиксировал исход
  callAttempts Int       @default(0)
}
```
Миграция строго additive (nullable / default). Индекс не нужен (читается по строке).

## 3. Фикс воскрешения (единственная правка ядра)

`src/server/actions/repository.ts` `upsertAction` — не воскрешать DONE-строку,
если по ней зафиксирован исход и запись ещё не прошла:

```ts
const outcomeLocked =
  existing.status === "DONE" &&
  existing.outcome != null &&
  existing.expiresAt != null &&
  now < existing.expiresAt;
const wasTerminal = !outcomeLocked && (DONE|DISMISSED|EXPIRED);
```
SNOOZED и так переживает recompute (уже есть). Итог: как только человек записал
исход — строка не всплывает сама до времени приёма.

## 4. Эндпоинт `POST /api/crm/actions/[id]/outcome`

Body: `{ outcome, note?, callbackAt?, newDate? }`. Роли ADMIN/RECEPTIONIST/DOCTOR.
Пишет outcome/outcomeNote/callbackAt/resolvedById + доменное действие (§1) в одной
транзакции, audit. Для `NO_ANSWER` — `callAttempts++`, снуз `NO_ANSWER_SNOOZE_MIN`
(config, деф. 120), при `callAttempts >= NO_ANSWER_MAX` (деф. 3) severity→high.
`CONFIRMED`/`REFUSED` закрывают все связанные open-Actions по appointmentId.

Существующий `done`-роут остаётся для не-риск-действий (обратная совместимость).

## 5. UI виджета — `risk-today-section.tsx`

- Кнопку «Обработано» → сплит: primary «Обработано» открывает поповер из 6
  исходов (иконки + подписи из i18n). «Перенести» открывает существующий
  reschedule-диалог; на успехе постит outcome=RESCHEDULED. «Перезвонить/Хочет
  прийти» — date-time пикер + заметка. «Отказался» — заметка (причина).
- **«Обработано сегодня (N)»** становится раскрываемым: список обработанных строк
  с исходом, кто, когда, callbackAt. Ничего не проваливается в пустоту.
- В строке — контекст: сколько напоминаний уже ушло (NotificationSend по
  appointmentId) + подтвердил/нет. Чип «3 напоминания · не подтвердил».

## 6. `risk-today` route — обогащение

- Каждая строка: `remindersSent` (count NotificationSend APPOINTMENT_BEFORE по
  appointmentId), `confirmed` (bool).
- `handledToday`: вернуть массив `{ appointmentId, patientName, outcome,
  outcomeNote, callbackAt, resolvedByName, doneAt }` (не только счётчик).

## 7. Каскад напоминаний → 5д/3д/1д/3ч

Заменяет 24ч/5ч/3ч/1ч (TZ-notifications-cancel-sync §2 — этот пункт замещаем).

- Оффсеты: **-7200 (5д) / -4320 (3д) / -1440 (1д) / -180 (3ч)**.
- `triggers.ts`:
  - `TRIGGER_KEYS` +`appointment.reminder-5d`; `reminder-3d` возвращается в
    канон; `reminder-24h`(=1д) и `reminder-3h` остаются; `-5h`/`-1h`/`-2h`
    выпадают из канона (слаги живут для legacy).
  - `scheduleAppointmentReminders`: полосы 5д/3д/1д/3ч.
  - `runScheduledTriggers`: горизонт 25ч → **121ч** (>5д); полосы 119–120ч /
    71–72ч / 23–24ч / 2–3ч; вернуть счётчики reminders5d/3d/1d/3h; обновить
    вызывающего в scheduler-воркере.
- `default-templates.ts`: 5д/3д/1д/3ч шаблоны (RU текст, канал TG, confirm-кнопка
  на всех APPOINTMENT_BEFORE).
- **Данные прода:** скрипт `scripts/reminder-cadence-5d3d1d3h.ts` — обновить
  offsetMin существующих NotificationTemplate строк неурофакса + создать
  недостающие (5д/3д) из дефолтов. Иначе планировщик зовёт slug, которого нет.
- Спам-гард и отмена pending при cancel — уже есть, не трогаем.

## 8. Тесты
- outcome-роут: каждый из 6 → правильная запись (confirm/cancel/snooze/attempts).
- resurrection-guard: DONE+outcome не воскресает до expiresAt; без outcome —
  воскресает как раньше.
- cadence: `scheduleAppointmentReminders` ставит 4 полосы на новых оффсетах;
  `runScheduledTriggers` бэндит корректно на 5д/3д/1д/3ч.

## 9. Фазы
- A (ядро): §2 схема+миграция, §3 фикс, §4 эндпоинт, §6 route — я.
- B (UI): §5 — агент.
- C (каскад): §7 — агент.
- Интеграция + тесты §8 + tsc + commit. Деплой — по явному «деплой».
