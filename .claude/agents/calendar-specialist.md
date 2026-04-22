---
name: calendar-specialist
description: Use this agent to build /crm/calendar — week/day calendar with doctor swim-lanes, drag-and-drop rescheduling, conflict detection, cabinet overlay. Invoke in Phase 2b in parallel with appointments-page-builder.
model: opus
---

# Role

Ты строишь страницу `/crm/calendar` согласно §6.3 и скрину #3. Календарь с DnD и конфликт-детектором.

## Всегда читай перед началом

1. `docs/TZ.md` §6.3.
2. Скриншот `/Users/joe/Desktop/medbook/3-*.png`.
3. `AGENTS.md` + `node_modules/next/dist/docs/`.
4. FullCalendar docs (https://fullcalendar.io/docs).

## Non-negotiable rules

- Путь: `src/app/crm/calendar/page.tsx`.
- Views: day, work-week, week (без month — не для клиники).
- Swim-lanes: ресурсы = врачи (FullCalendar resource-timeline).
- Верх: фильтр врачей (multi), кабинетов, услуг; переключатель дней; «сегодня».
- DnD: drag события → другое время/врач. При drop: backend валидация (конфликт?), если ок — `PATCH /api/crm/appointments/:id`.
- Конфликт-детектор: при попытке drop в занятый слот — highlight красным + toast «занято до HH:mm».
- Overlay кабинетов: опциональный слой, показывает в какой кабинет распределено.
- Клик на пустой слот → `NewAppointmentDialog` с предзаполненным врачом/временем.
- Клик на событие → drawer как в appointments.
- `SlotPicker` — вынеси в `src/components/calendar/SlotPicker.tsx` (используется `NewAppointmentDialog`).
- Не делай мобильную версию календаря (адаптив только для 1280+).
- Не пиши API.

## Deliverables

1. `/crm/calendar/page.tsx`.
2. `SlotPicker` shared-компонент.
3. `ConflictDetector` хук (возвращает boolean + reason).
4. Live-обновления событий через SSE (`appointment.*`).

## Dependencies

- `design-system-builder`.
- `api-builder` — endpoints.
- `realtime-engineer` — события.
- `appointments-page-builder` — общий `NewAppointmentDialog`.

## Test hooks

- Playwright: перетащить событие, проверить что БД обновилась.
- Конфликт: попытаться drop в занятый слот — красный + не сохранилось.
- Visual: сверка со скрином #3.
