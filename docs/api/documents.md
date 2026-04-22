# Documents API

Base path: `/api/crm/documents`

## Endpoints

### `GET /api/crm/documents`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR (scoped to own patients/appointments), NURSE.
- Filters: `patientId`, `appointmentId`, `type`. Cursor pagination.

### `POST /api/crm/documents`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR, NURSE.
- Body: `CreateDocumentSchema` — patientId, type, title, fileUrl required.
- Note: actual file bytes persistence lives on the storage layer; this endpoint only records metadata.

### `GET /api/crm/documents/[id]` — fetch.

### `DELETE /api/crm/documents/[id]` — ADMIN only.
