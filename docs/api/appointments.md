# Appointments API

Base path: `/api/crm/appointments`

## Endpoints

### `GET /api/crm/appointments`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR, NURSE, CALL_OPERATOR (DOCTOR auto-scoped to their own rows).
- **Query:** `from`, `to`, `doctorId`, `patientId`, `cabinetId`, `status`, `channel`, `unpaid`, `cursor`, `limit`, `sort` (date|createdAt), `dir`.
- **200:** `{ rows, nextCursor, total }` with patient/doctor/cabinet/services/payments included.

### `POST /api/crm/appointments`
- **Roles:** ADMIN, RECEPTIONIST.
- **Body:** `CreateAppointmentSchema` — patientId, doctorId, date, durationMin required; optional cabinetId/services/time/channel/prices/notes.
- **Conflict (409):** `{ error: "conflict", reason: "doctor_busy"|"cabinet_busy"|"doctor_time_off"|"outside_schedule", until?: "HH:mm" }`.
- **201:** Appointment row.

### `GET /api/crm/appointments/[id]`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR (self), NURSE, CALL_OPERATOR.

### `PATCH /api/crm/appointments/[id]`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR (self).
- Re-runs conflict detection if time/doctor/cabinet changes. Replaces AppointmentService rows if `services` provided. Sets `cancelledAt` / `completedAt` / `startedAt` on matching status transitions.

### `DELETE /api/crm/appointments/[id]`
- **Roles:** ADMIN, RECEPTIONIST. Soft-cancel (status = CANCELLED).

### `PATCH /api/crm/appointments/[id]/queue-status`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR, NURSE. Body: `{ queueStatus: "WAITING"|"IN_PROGRESS"|"COMPLETED"|"SKIPPED" }`. Mirrors into `status` + timestamps.

### `GET /api/crm/appointments/slots/available`
- **Query:** `doctorId` (required), `date` (required), `serviceIds` (optional repeatable). Returns `{ doctorId, date, slotMin, slots: "HH:mm"[] }`. Slot size = sum of service durations or 30 min default.

### `POST /api/crm/appointments/bulk-status`
- **Roles:** ADMIN, RECEPTIONIST. Body: `{ ids: string[], status, cancelReason? }`. Returns `{ count }`.
