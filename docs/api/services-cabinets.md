# Services & Cabinets API

## Services — `/api/crm/services`
- `GET` (ADMIN, RECEPTIONIST, DOCTOR, NURSE, CALL_OPERATOR) — list with filters `q`, `isActive`, `category`.
- `POST` (ADMIN) — create. Body: `CreateServiceSchema` (nameRu/nameUz/code/priceBase/durationMin/category/isActive).
- `GET /[id]`, `PATCH /[id]`, `DELETE /[id]` — ADMIN only for mutations; DELETE soft-deletes (isActive=false).

## Cabinets — `/api/crm/cabinets`
- `GET` (ADMIN, RECEPTIONIST, DOCTOR, NURSE) — list with `isActive`, `floor` filters.
- `POST` (ADMIN) — create. Unique `(clinicId, number)`.
- `GET /[id]`, `PATCH /[id]`, `DELETE /[id]` — ADMIN for mutations; DELETE soft-deletes.
