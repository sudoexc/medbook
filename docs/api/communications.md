# Communications / Conversations / Calls / Notifications

## Communications — `/api/crm/communications`
- `GET` (ADMIN, RECEPTIONIST, DOCTOR, NURSE, CALL_OPERATOR) — list across channels, filters `patientId`, `channel`, `direction`, `from`, `to`.
- `POST /sms` (ADMIN, RECEPTIONIST, CALL_OPERATOR) — queue outbound SMS stub. Body: `{ patientId?, phone, body }`. Records a Communication row; real dispatcher plugs in Phase 3a.

## Conversations — `/api/crm/conversations`
- `GET` — list inbox threads. Filters `channel`, `status`, `assignedToId`, `unread`, `q`.
- `GET /[id]`, `PATCH /[id]` — update status/mode/assignee/tags/snooze.
- `GET /[id]/messages`, `POST /[id]/messages` — list + send. POST creates an OUT Message, updates `lastMessageAt/lastMessageText`.

## Calls — `/api/crm/calls`
- `GET`, `POST` — roles ADMIN, RECEPTIONIST, CALL_OPERATOR. CreateCallSchema supports inbound/outbound/missed with SIP-Call-ID upsert.
- `GET /[id]`, `PATCH /[id]` — update operator/patient/appointment/summary/tags.

## Notifications templates — `/api/crm/notifications/templates`
- `GET`, `POST` (ADMIN-only create). `GET /[id]`, `PATCH /[id]`, `DELETE /[id]` (soft delete via isActive=false).

## Notifications sends — `/api/crm/notifications/sends`
- `GET`, `POST` — queue a send. Actual dispatch in Phase 3a worker.
- `POST /[id]/retry` — reset status to QUEUED, bump `retryCount`.
