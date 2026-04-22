# MedBook / NeuroFax — Progress Log

**Каждая новая сессия — начинай с чтения этого файла.** Здесь фиксируется состояние между контекстными пропусками.

- **Спецификация:** `docs/TZ.md` (единственный источник правды).
- **Команда агентов:** `.claude/agents/*.md` (31 шт, model: opus).
- **Safety тег:** `pre-rebuild-2026-04-22` (коммит `ec24c4d`, сняться `git reset --hard pre-rebuild-2026-04-22`).

## Соглашения

- Каждая фаза — один блок ниже. Формат: статус, дата, что сделано, файлы, тесты, известные минусы.
- В конце фазы запускается cross-cutting ревью: `security-reviewer`, `a11y-engineer`, `performance-optimizer`, `test-engineer`, `ux-polisher`, `code-reviewer`.
- После каждой фазы — `git commit` с тегом `phase-N-done` + обновление этого файла.

---

## Phase 0 — Зачистка + фундамент — ✅ DONE 2026-04-22

**Коммиты:** `447fcb3` (cleanup) · `38998cd` (prisma) · `566e6dd` (i18n) · `f47466a` (design-system) · `edb1715` (tenancy) · `phase-0-done` tag.

### Что сделано

- **Зачистка (`migration-cleaner`):** снёс `src/app/[locale]/(dashboard)/`, `[locale]/login`, `src/components/charts/`, `auto-print.tsx`, `api/export`. LEGACY-пометки на `api/telegram/notify`, `api/appointments/[id]`, `api/payments`.
- **Prisma (`prisma-schema-owner`):** 28 моделей, 23 enum, initial migration `20260422080121_phase-1-initial`. Seed: 2 клиники (neurofax, demo-clinic), 1 SUPER_ADMIN, по 10 пациентов, 5 услуг, 20 appointments, 10 templates, FX rate.
- **i18n (`i18n-specialist`):** next-intl для ru/uz, full formatters (`formatMoney`, `formatMoneyDual`, `formatDate`, `formatPhone`, `formatName`). MoneyText атом. Language switcher.
- **Design-system (`design-system-builder`):** Tailwind токены (primary teal #3DD5C0), shadcn/ui (22 компонента), 13 атомов в `src/components/atoms/`, 6 молекул в `src/components/molecules/`, layout-shell (sidebar + topbar + right-rail), theme-provider (next-themes). Placeholder-страницы для 10 CRM-разделов.
- **Tenancy (`multitenant-specialist`):** `src/lib/tenant-context.ts` (AsyncLocalStorage), `src/lib/prisma.ts` через `$extends`, `src/lib/api-handler.ts` (createApiHandler), `src/lib/auth.ts` (clinicId в JWT), clinic-switcher UI stub. 18 vitest тестов — зелёные.

### Build / тесты

- `npx tsc --noEmit` — clean.
- `npm run build` — exit 0 (минорный warning на legacy doctors static page).
- `npx vitest run` — 18/18 passed.

### Ключевые файлы для последующих фаз

- **Prisma client:** `src/lib/prisma.ts` — автоматически подставляет `clinicId` в TENANT-контексте.
- **API handler wrapper:** `src/lib/api-handler.ts` — использовать вместо ручного `auth()` + `runWithTenant`.
- **Tenant context helpers:** `src/lib/tenant-context.ts`.
- **Auth:** `src/lib/auth.ts` — credentials provider, JWT со `{userId, role, clinicId}`.
- **Layout shell:** `src/app/[locale]/crm/layout.tsx` + `src/components/layout/crm-*`.
- **CRM страницы:** `src/app/[locale]/crm/{reception,appointments,calendar,patients,doctors,call-center,telegram,notifications,analytics,settings}/page.tsx` (placeholders).
- **Формат money/date/phone:** `src/lib/format.ts` через `MoneyText`, `DateText`, `PhoneText`.
- **Витрина компонентов:** `/ru/crm/components` (dev-only).

### Known legacy (ожидает Phase 1 / api-builder)

- 22 старых API-роута помечены `// @ts-nocheck` + TODO(phase-1): src/app/api/{booking,leads,queue,medical-records,patients,payments,reviews,schedule,search,telegram,tv-queue,appointments,kiosk}/**, и `src/lib/{auth,booking-validation,doctors}.ts` (часть починена tenancy-агентом).
- Legacy route `/[locale]/doctors` (публичный) использует старые поля — останется до `public-site-revamp`.
- `prisma/migrations/` создан как `--create-only`, в БД не применён (применится в Phase 1 на dev-среде).

### Заметки для следующих фаз

- **api-builder (Phase 1):** всегда через `createApiHandler`. Никогда не добавлять `clinicId` в where вручную. Композитные unique с clinicId — middleware их видит и не дублирует. Cross-tenant — через `{ skipTenantScope: true }` (только для ExchangeRate/ProviderConnection) или `runWithTenant({kind:'SYSTEM'}, ...)`.
- **Воркеры:** оборачивать main() в `runWithTenant({kind:'SYSTEM'}, ...)`.
- **clinic-switcher:** UI уже в topbar, но реальные endpoints `/api/platform/*` создаст admin-platform-builder в Phase 4.
- **Применение миграции:** `npx prisma migrate deploy` на dev-БД перед началом Phase 1.

---

## Phase 1 — Данные + API — 🔄 планируется
