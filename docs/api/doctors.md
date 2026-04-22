# Doctors API

Base path: `/api/crm/doctors`

## Endpoints

### `GET /api/crm/doctors`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR, NURSE, CALL_OPERATOR.
- Filter by `isActive`, `q` (name/specialty). Cursor pagination.

### `POST /api/crm/doctors`
- **Roles:** ADMIN. Body: `CreateDoctorSchema`.

### `GET /api/crm/doctors/[id]`
- Public profile + schedule/timeoff.

### `PATCH /api/crm/doctors/[id]`
- **Roles:** ADMIN, DOCTOR (self — `ctx.userId === doctor.userId`).

### `DELETE /api/crm/doctors/[id]`
- **Roles:** ADMIN. Soft delete (isActive=false).

### `PUT /api/crm/doctors/[id]/schedule`
- **Roles:** ADMIN, DOCTOR (self). Body: `ReplaceScheduleSchema { entries: DoctorSchedule[] }`. Atomic replace in a transaction.

### `POST /api/crm/doctors/[id]/time-off`
- Body: `CreateTimeOffSchema { startAt, endAt, reason? }`.

### `DELETE /api/crm/doctors/[id]/time-off?entryId=...`

### `GET /api/crm/doctors/[id]/finance`
- **Roles:** ADMIN, DOCTOR (self). Aggregates revenue + bonus = `revenue * salaryPercent / 100`.
