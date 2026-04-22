# i18n coverage

Languages: **ru** (default, no URL prefix) and **uz** (under `/uz`). Library: `next-intl` v4.

## Dictionaries

Files: `src/messages/ru.json`, `src/messages/uz.json`. Every key exists in both files — check with the test hook noted at the bottom.

### Sections present (Phase 0 setup)

- `common` — save / cancel / delete / edit / create / search / loading / empty / yes / no / today / …
- `nav` — public site links (doctors, services, about, faq, bookAppointment) **plus** CRM links (reception, appointments, calendar, patients, callCenter, telegram, notifications, analytics, settings)
- `auth` — signIn / signOut / email / password / signInError / unauthorized
- `patient` — fullName / firstName / lastName / patronymic / phone / birthDate / gender (male/female) / address / notes / `segment.{new,active,dormant,vip,churn}`
- `appointment` — date / time / duration / doctor / service / cabinet / comment / `status.{booked,waiting,inProgress,completed,skipped,cancelled,noShow}`
- `payment` — amount / `method.{cash,card,transfer}` / `status.{paid,unpaid,partial}`
- `reception` — title / subtitle / `kpi.{todayAppointments,checkedIn,missed,revenue,waiting,inProgress}`

### Sections inherited from the public site (unchanged)

- `hero`, `doctors`, `services`, `about`, `faq`, `footer`, `leadForm`, `notFound`, `login`, `dashboard`, `reviews`, `doctorPage`

## TODO (to be filled in by page-agents as they ship screens)

- `patients.*` — list filters, detail tabs, segment tooltips
- `calendar.*` — week/day view labels, drag hints, timeslot states
- `callCenter.*` — call statuses, dialer hints, disposition codes
- `telegram.*` — inbox labels, quick-replies, unread badges
- `notifications.*` — template names, channel labels, preview
- `analytics.*` — metric labels, period picker, comparison strings
- `settings.*` — clinic / user / integrations tabs
- `kiosk.*`, `tv.*`, `receptionist.*` — if we decide to localize these (currently ru-only)
- `miniApp.*` — Telegram Mini App flow (language picker, booking)
- `legal.*` — privacy, terms, consent copy (needs user sign-off, per charter)

Each page-agent must add keys in both `ru.json` and `uz.json` in the same commit. Do not merge PRs that introduce a key in only one file.

## Formatters

All UI formatting goes through `src/lib/format.ts`:

- `formatMoney(amount, currency, locale)` — minor units in, formatted string out. UZS grouped with spaces, no kopecks, `сум` / `so'm` suffix. USD with cents, `$` prefix.
- `formatMoneyDual(uzs, usd, locale)` — returns `{ primary, secondary }` for the dual-currency pattern.
- `formatDate(date, locale, style)` — `short | long | time | relative`. Relative covers today/yesterday/tomorrow + within-a-week fallback via `Intl.RelativeTimeFormat`.
- `formatPhone(phone)` — `+998 (90) 123-45-67`, tolerant of input shape.
- `formatName(first, last, patronymic, style)` — `short` (Фамилия И. О.) or `full` (Фамилия Имя Отчество).
- `initials(fullName)` — legacy helper for pre-composed strings; prefer `formatName` for new code.

The `<MoneyText>` atom in `src/components/atoms/money-text.tsx` wraps `formatMoney` and the dual pattern.

## Routing

- `src/i18n/routing.ts` — `localePrefix: 'as-needed'`, ru default.
- `src/i18n/request.ts` — loads `src/messages/<locale>.json` per request.
- `src/proxy.ts` — Next 16 replacement for `middleware.ts`; delegates to `next-intl/middleware`.
- `next.config.ts` — wrapped in `createNextIntlPlugin('./src/i18n/request.ts')`.

## Language switcher

`src/components/layout/language-switcher.tsx` — dropdown ru/uz. Writes `NEXT_LOCALE` cookie (1 year, `Path=/`, `SameSite=Lax`) and navigates via `useRouter().replace(..., { locale })`. TODO: PATCH `/api/me` with `{ locale }` once that endpoint exists so staff `User.locale` persists server-side (for email/notification language).

## Tests to add (Phase 7)

- Unit: formatter edge cases — 0, huge numbers, invalid dates, unknown phone shapes, empty name parts.
- Dictionary parity: every leaf key in `ru.json` must exist in `uz.json` and vice versa.
- Playwright: toggle language on a CRM screen → every visible string changes; URL picks up `/uz`.
