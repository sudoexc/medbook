# Communications / Conversations / Calls / Notifications

## Communications — `/api/crm/communications`
- `GET` (ADMIN, RECEPTIONIST, DOCTOR, NURSE, CALL_OPERATOR) — list across channels, filters `patientId`, `channel`, `direction`, `from`, `to`. Historical SMS rows are still readable; new SMS rows are no longer created.
- ~~`POST /sms`~~ — **REMOVED** per `docs/TZ-sms-removal.md` (Waves 1-3, Q2 2026). The endpoint returned 410 Gone in Wave 1, then was deleted in Wave 3. Outbound SMS is no longer supported; use Telegram (TG) or in-app for outgoing messages.

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
