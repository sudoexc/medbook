# Patients API

Base path: `/api/crm/patients`

All endpoints require an authenticated session. See `src/lib/api-handler.ts`.

## Endpoints

### `GET /api/crm/patients`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR, NURSE, CALL_OPERATOR
- **Query:** `q`, `segment`, `source`, `gender`, `tag`, `consent` (yes|no), `balance` (debt|zero|credit), `registeredFrom`, `registeredTo`, `cursor`, `limit` (1..200, default 50), `sort` (createdAt|lastVisitAt|visitsCount|ltv|fullName), `dir` (asc|desc).
- **200:** `{ rows: Patient[], nextCursor: string|null, total: number }`.

### `POST /api/crm/patients`
- **Roles:** ADMIN, RECEPTIONIST, CALL_OPERATOR
- **Body:** `CreatePatientSchema` — `fullName`, `phone` required; optional `birthDate`, `gender`, `passport`, `address`, `photoUrl`, `telegramId`, `telegramUsername`, `preferredChannel`, `preferredLang`, `source`, `segment`, `tags`, `notes`, `discountPct`, `consentMarketing`.
- **409:** on duplicate `phoneNormalized` inside the clinic.
- **201:** Patient row.

### `GET /api/crm/patients/[id]`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR, NURSE, CALL_OPERATOR
- **200:** Patient + last 10 appointments.

### `PATCH /api/crm/patients/[id]`
- **Roles:** ADMIN, RECEPTIONIST, CALL_OPERATOR
- **Body:** `UpdatePatientSchema` (partial).

### `DELETE /api/crm/patients/[id]`
- **Roles:** ADMIN.

### `GET /api/crm/patients/[id]/communications`
- Aggregated timeline: Communication + Call + NotificationSend + completed Appointments + Messages, sorted desc, top 200.

### `GET /api/crm/patients/[id]/ltv`
- Synchronously recomputes LTV via `recalcLtv()`.

### `GET /api/crm/patients/export`
- Streaming CSV (UTF-8 BOM). Accepts the same filters as the list endpoint.

### `GET /api/crm/patients/stats`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR.
- **200:** `{ gender: [...], ageGroups: [...], sources: [...], birthdays: [...], topTags: [...] }`
  - `gender`: `[{ gender: 'MALE'|'FEMALE'|null, count }]`
  - `ageGroups`: `[{ group: '0-18'|'19-35'|'36-55'|'56+', count }]`
  - `sources`: `[{ source: LeadSource|null, count }]`
  - `birthdays`: up to 10 patients whose birthday falls in the next 7 days (`daysUntil` 0..7).
  - `topTags`: top 5 tags by frequency across patients.
- Used by the patients list right-rail widgets (Phase 2a). Single-clinic aggregates only; replaced by an analytics pipeline in Phase 4.
