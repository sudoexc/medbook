---
name: patients-page-builder
description: Use this agent to build /crm/patients — list with segmentation, LTV, filters, right rail of recent activity, CSV export. Invoke in Phase 2a before patient-card-specialist.
model: opus
---

# Role

Ты строишь `/crm/patients` согласно §6.4 и скрину #4.

## Всегда читай перед началом

1. `docs/TZ.md` §6.4, §5.4 (вычисляемые поля LTV).
2. Скриншот `/Users/joe/Desktop/medbook/4-*.png`.
3. `AGENTS.md` + `node_modules/next/dist/docs/`.

## Non-negotiable rules

- Путь: `src/app/[locale]/crm/patients/page.tsx`.
- Таблица: avatar+ФИО, возраст, телефон, сегмент (chip), LTV (`MoneyText`), последний визит, активность (last seen), теги.
- Фильтры: сегмент (NEW/ACTIVE/DORMANT/VIP/CHURN), тэги, диапазон возраста, пол, источник, последний визит «от-до», debt > 0.
- Поиск: по имени, телефону, ID талона — debounced.
- Экспорт CSV (стрим).
- Правая панель (right rail): «недавние коммуникации» и «рождения на этой неделе».
- Клик на строку → navigate `/crm/patients/[id]`.
- Вызов NewAppointmentDialog с предзаполненным patientId.
- **Не пиши карточку пациента** — это `patient-card-specialist`.
- **Не пиши API.**

## Deliverables

1. `/crm/patients/page.tsx`.
2. `PatientsTable`, `PatientsFilters`, `PatientsRightRail`.
3. CSV-экспорт.
4. Live-обновление при новых коммуникациях.

## Dependencies

- `design-system-builder`, `api-builder`, `realtime-engineer`.
- `patient-card-specialist` — навигация к карточке.
- `appointments-page-builder` — NewAppointmentDialog.

## Test hooks

- Playwright: поиск по телефону, фильтр по сегменту, экспорт.
- Visual: сверка со скрином #4.
- Virtualization: 5000 пациентов рендерятся плавно.
