# Misc CRM endpoints

## Dashboard — `GET /api/crm/dashboard`
- Roles: ADMIN, RECEPTIONIST, DOCTOR, CALL_OPERATOR.
- Returns `{ today, week, month, newPatientsThisMonth, queue }` where each period yields `{ booked, inProgress, completed, cancelled, revenue }`.

## Audit — `GET /api/crm/audit`
- ADMIN only. Filters `entityType`, `entityId`, `actorId`, `action`, `from`, `to`. Cursor pagination.

## Exchange rates — `/api/crm/exchange-rates`
- `GET` — list rates (ADMIN, RECEPTIONIST, DOCTOR, CALL_OPERATOR).
- `POST` — upsert by `(clinicId, date)`. ADMIN only.

## Search — `GET /api/crm/search?q=...`
- Cross-entity global search. Returns up to 5 of each: `patients`, `doctors`, `appointments`, `conversations`.

## Online requests — `/api/crm/online-requests`
- `GET` — list leads from web/tg/kiosk/call (ADMIN, RECEPTIONIST, CALL_OPERATOR).
- `GET /[id]`, `PATCH /[id]` — update status/assignment/comment/preferredAt.
