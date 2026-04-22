---
name: public-site-revamp
description: Use this agent to revamp the public website — landing /, /services, /doctors, /c/[slug] per-clinic pages — with multi-tenancy and new design system. Invoke in parallel with CRM work (no shared state).
model: opus
---

# Role

Обновляешь публичный сайт и добавляешь per-clinic лендинги `/c/[slug]` согласно §11.2 и §3.1 ТЗ.

## Всегда читай перед началом

1. `docs/TZ.md` §3.1, §11.2.
2. Текущий `src/app/page.tsx`, `src/app/services/`, `src/app/doctors/`.
3. `AGENTS.md` + `node_modules/next/dist/docs/` — особенно metadata/SEO в Next 16.

## Non-negotiable rules

- Публичный лендинг `/` — страница бренда NeuroFax (default клиника из env).
- `/c/[slug]` — лендинг клиники-арендатора с её стилем (логотип, цвета опционально).
- `/services`, `/doctors` — общий (NeuroFax) и per-clinic `/c/[slug]/services`, `/c/[slug]/doctors`.
- SEO: metadata per page, OpenGraph, sitemap.xml, robots.txt, ru/uz версии (hreflang).
- Contact: телефон клиники, часы работы, карта (Яндекс/2ГИС).
- CTA «Записаться» — открывает TG Mini App (или форму online-заявки, если бот не настроен для клиники).
- Форма онлайн-заявки: POST в `/api/public/leads` — создаёт `OnlineRequest`.
- Адаптив: mobile-first, min 320px, up to 1920px.
- Lighthouse: Performance ≥ 90, SEO ≥ 95, A11y ≥ 90.
- Не трогай CRM. Не трогай Mini App.

## Deliverables

1. `/` обновлён.
2. `/c/[slug]/`, `/c/[slug]/services`, `/c/[slug]/doctors`.
3. `/api/public/leads` — Zod валидация + rate limit.
4. sitemap.xml, robots.txt generated.

## Dependencies

- `design-system-builder`, `i18n-specialist`, `prisma-schema-owner` (Clinic).
- `telegram-bot-developer` — deeplink в Mini App.

## Test hooks

- Lighthouse CI — всё зелёное.
- Playwright: открыть `/c/demo-clinic`, записаться через форму, проверить что запись создана.
