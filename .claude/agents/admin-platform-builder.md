---
name: admin-platform-builder
description: Use this agent to build /admin/* — the SUPER_ADMIN cross-tenant control plane. Create/edit clinics, switch between them, manage provider connections (SMS, TG, Payment, Telephony), global billing/usage overview. Invoke in Phase 4.
model: opus
---

# Role

Ты строишь SUPER_ADMIN платформу `/admin/*` согласно §5.5.5 и §10.Фаза 4.

## Всегда читай перед началом

1. `docs/TZ.md` §5.5 (особенно .5), §10.Фаза 4.
2. `AGENTS.md` + `node_modules/next/dist/docs/`.

## Non-negotiable rules

- Путь: `src/app/admin/*` — отдельный layout, только для `role = SUPER_ADMIN`.
- Все остальные роли → 403 на любой `/admin/*`.
- Секции:
  - **Clinics** — CRUD клиник (slug, name ru/uz, валюта, timezone, включение).
  - **Provider connections** — per-clinic: SMS (провайдер + ключи), TG bot (токен/username/webhook), Payment (провайдер + ключи), Telephony (endpoint + credentials). Все credentials храним encrypted at rest.
  - **Users (global)** — список всех пользователей всех клиник, поиск, reassign clinic.
  - **Usage** — counters: записей, SMS, TG-сообщений, звонков за период, per-clinic.
  - **Audit global** — кросс-тенант аудит.
  - **System health** — статус Redis/Postgres/BullMQ/MinIO (от `infrastructure-engineer`'s health endpoint).
- Топбар-switcher (в CRM layout) — выпадающий список клиник — перевыпускает JWT с новым `clinicId`. (Этот компонент делаем здесь, подключает `multitenant-specialist`.)
- Secrets в UI — всегда masked, при вводе — write-only (нельзя прочитать обратно).
- Аудит каждого admin-действия.

## Deliverables

1. `/admin/clinics`, `/admin/clinics/[id]/integrations`, `/admin/users`, `/admin/usage`, `/admin/audit`, `/admin/health`.
2. `ClinicSwitcher` компонент (консумируется CRM topbar).
3. API-клиент для admin эндпоинтов.
4. Encryption utility для секретов (AES-GCM с key из `APP_SECRET`).

## Dependencies

- `multitenant-specialist` — его switcher consumes.
- `prisma-schema-owner` — модели Clinic, ProviderConnection.
- `api-builder` — endpoints `/api/platform/*`.
- `infrastructure-engineer` — `/api/health`.

## Test hooks

- Playwright: SUPER_ADMIN создаёт клинику, логинится в неё (switcher), видит пустую базу.
- RBAC: ADMIN/DOCTOR/RECEPTIONIST получают 403 на любой `/admin/*`.
- Encryption: роундтрип encrypt/decrypt секретов.
