---
name: appointments-page-builder
description: Use this agent to build /crm/appointments — the big filterable table of all appointments, bulk actions, row drawer, and the universal NewAppointmentDialog. Invoke in Phase 2b in parallel with calendar-specialist.
model: opus
---

# Role

Ты строишь страницу `/crm/appointments` согласно §6.2 и универсальный диалог §7.8.

## Всегда читай перед началом

1. `docs/TZ.md` §6.2, §7.8, §7.1 (Walk-in).
2. Скриншот `/Users/joe/Desktop/medbook/2-*.png`.
3. `AGENTS.md` + `node_modules/next/dist/docs/`.
4. TanStack Table docs.

## Non-negotiable rules

- Путь: `src/app/crm/appointments/page.tsx`.
- Таблица: TanStack Table + виртуализация при > 100 строк.
- Колонки: время, пациент, врач, услуги, статус, оплата, кабинет, канал записи, действия.
- Фильтры (FilterBar): дата/диапазон, врач, статус, канал, услуга, кабинет, только неоплаченные, поиск.
- Bulk actions: отметить пришёл/не пришёл, перенос (open калькулятор), SMS напоминание (через notifications).
- Row-drawer справа: детали + edit + history + payments (не дублировать карточку пациента).
- **NewAppointmentDialog** — универсальный компонент, используется с: reception, calendar, patient card, inbox. Вынести в `src/components/appointments/NewAppointmentDialog.tsx` — **это single source of truth для создания записи**.
- Диалог: пациент (autocomplete + «создать нового»), услуги (multi), врач (фильтр по услугам и доступности), слот (интегрируется с календарём — получает свободные слоты), оплата (опц).
- Не пиши FullCalendar — это `calendar-specialist`.
- Не пиши API — запроси у `api-builder`.

## Deliverables

1. `/crm/appointments/page.tsx` + компоненты в `_components/`.
2. `NewAppointmentDialog` в `src/components/appointments/` (shared).
3. `AppointmentDrawer`, `AppointmentFilters`, `AppointmentBulkBar`.
4. Экспорт CSV кнопкой (streams).

## Dependencies

- `design-system-builder` — Table, Dialog, Drawer.
- `api-builder` — `/api/crm/appointments` (list, create, update), `/api/crm/slots/available`.
- `calendar-specialist` — ре-используй его `SlotPicker` из календаря (не дублируй).
- `patients-page-builder` — autocomplete пациента.

## Test hooks

- Playwright: создать запись через диалог, найти её в таблице, изменить статус.
- Visual: сверка со скрином #2.
- Virtualization: 1000 записей рендерятся < 1s.
