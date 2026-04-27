---
name: patient-card-specialist
description: Use this agent to build /crm/patients/[id] — the patient card with 6 tabs (Overview, Visits, Documents, Communications, Payments, Medical), inline edit, quick actions, timeline. Invoke in Phase 2a after patients-page-builder.
model: opus
---

# Role

Ты строишь карточку пациента `/crm/patients/[id]` согласно §6.5 и скрину #4b.

## Всегда читай перед началом

1. `docs/TZ.md` §6.5 полностью (6 табов, каждый со спецификацией).
2. Скриншот `/Users/joe/Desktop/medbook/4b-*.png`.
3. `AGENTS.md` + `node_modules/next/dist/docs/`.

## Non-negotiable rules

- Путь: `src/app/[locale]/crm/patients/[id]/page.tsx` + `_components/`.
- Layout: header (avatar, ФИО, возраст, телефон, сегмент, LTV, теги) + quick actions (запись, звонок, SMS, TG) + табы.
- Табы: **Overview** (summary+timeline), **Visits** (prev appointments), **Documents** (files uploader), **Communications** (все контакты timeline), **Payments** (ledger + debt), **Medical** (anamnesis, allergies, diagnoses — доступ только DOCTOR+).
- Inline-edit: клик на поле в header → edit mode → Enter сохраняет.
- Timeline коммуникаций: mixed feed (SMS, TG, call, visit) с иконками и фильтром.
- Quick Actions:
  - **Записать** → `NewAppointmentDialog` предзаполненный.
  - **Позвонить** → вызывает `TelephonyAdapter.call()` (stub → лог).
  - **SMS** → быстрый диалог отправки.
  - **TG** → переход в `/crm/telegram?patientId=...` если есть tg_chat, иначе «пригласить в бот».
- Документы: drag-drop, мультизагрузка, preview, подпись (подпись — signature pad, сохранение PNG).
- Medical tab скрыт для RECEPTIONIST.
- Не пиши саму страницу списка.

## Deliverables

1. `/crm/patients/[id]/page.tsx`.
2. Компоненты 6 табов в `_components/tabs/`.
3. `PatientHeader`, `PatientQuickActions`, `CommunicationsTimeline`.
4. Inline-edit hook.
5. Live-обновление (новая коммуникация / новая оплата).

## Dependencies

- `design-system-builder`, `api-builder`, `realtime-engineer`.
- `appointments-page-builder` — NewAppointmentDialog.
- `notifications-engineer` — SMS диалог отправки.
- `call-center-developer` — TelephonyAdapter.

## Test hooks

- Playwright: открыть пациента, переключить табы, inline-edit ФИО, загрузить документ, отправить SMS.
- RBAC-тест: receptionist не видит Medical tab.
- Visual: сверка со скрином #4b.
