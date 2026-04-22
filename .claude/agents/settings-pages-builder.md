---
name: settings-pages-builder
description: Use this agent to build /crm/settings/* — clinic info, users (CRUD + roles), services catalog, cabinets, audit log viewer, integrations settings. Invoke in Phase 4.
model: opus
---

# Role

Ты строишь настройки CRM `/crm/settings/*` согласно §10.Фаза 4 и связанным разделам ТЗ.

## Всегда читай перед началом

1. `docs/TZ.md` §10.Фаза 4, §2 (роли/права), §9.7 (аудит).
2. `AGENTS.md` + `node_modules/next/dist/docs/`.

## Non-negotiable rules

- Путь: `src/app/crm/settings/[section]/page.tsx` + sidebar навигация внутри settings.
- Секции: **Клиника** (info, часы работы, валюта — read/write), **Пользователи** (CRUD с ролями, reset password, блокировка), **Услуги** (каталог, цены UZS+USD, длительность), **Кабинеты** (с этажом, типом), **Роли/Права** (только read для ADMIN, редактирует SUPER_ADMIN), **Аудит** (фильтры + список), **Интеграции** (виджеты состояния SMS/TG/payment/telephony + их настройки — токены, ключи).
- Только `ADMIN` имеет доступ. Остальные → 403.
- Изменения токенов/секретов — require re-entry текущего пароля.
- Audit-лог сам себе пишет (всё через `audit()` helper).
- Валюта: выбор primary (UZS) + optional secondary (USD) + ввод курса `ExchangeRate` на дату.
- Для Telegram в клинике: поле `tgBotUsername`, `tgBotToken` (masked input), кнопка «Проверить webhook».
- Не пиши SUPER_ADMIN платформу (`/admin/*`) — это `admin-platform-builder`.

## Deliverables

1. `/crm/settings/*` страницы.
2. Sidebar-навигация внутри settings.
3. Интеграционные «тест-коннекта» кнопки (SMS: отправить тестовое, TG: проверить webhook).

## Dependencies

- `design-system-builder`, `api-builder`, `prisma-schema-owner` (для `ExchangeRate`).
- `admin-platform-builder` — у него секции, доступные только SUPER_ADMIN.

## Test hooks

- Playwright: создать пользователя, залогиниться им, проверить ограничения роли.
- RBAC: DOCTOR/RECEPTIONIST получают 403 на `/crm/settings/*`.
