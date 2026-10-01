# Documents API

Base path: `/api/crm/documents`

## Origin and legal records

- `Document.source` (audit CD-06): `STAFF` (CRM or cabinet upload), `PATIENT`
  (Mini App upload, unchecked by the clinic, badged «От пациента» in the
  library, the patient card, the doctor's documents and visit timeline),
  `SYSTEM` (conclusion and referral PDFs rendered by the workers). A patient
  may file only `RESULT` or `OTHER`; any other type sent from the Mini App is
  stored as `OTHER`.
- Legal records (audit CD-09, `src/lib/document-guards.ts`): a rendered
  document (conclusion, referral PDF) and a signed consent/contract are never
  deleted and never get a new file or type. The API answers 409
  (`rendered_document` / `signed_document`) for every role, ADMIN included,
  and the lists hide the buttons.
- A signed record filed by mistake (another patient's signature, «Отметить
  подписанным» pressed on the wrong paper) is voided by ADMIN with a reason
  instead (`voidedAt`, `voidedById`, `voidReason`). The row and its file stay
  and the audit log has a `document.void` row; the CRM lists it as
  «Аннулирован», the patient's Mini App no longer lists or serves it, «send
  to Telegram» skips it, and nothing on it can be edited any more
  (409 `voided_document`).
- Only a signature that signs a named consent is ever created signed. The
  patient card's signature pad files a signature with no consent picked as
  `OTHER`, unsigned and deletable.

## Endpoints

### `GET /api/crm/documents`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR (scoped to own patients/appointments), NURSE.
- Filters: `patientId`, `appointmentId`, `type`, `source`, `q`, `from`, `to`,
  `pendingSignature` (the clinic's unsigned consents/contracts only). Cursor pagination.

### `POST /api/crm/documents`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR, NURSE.
- Body: `CreateDocumentSchema` — patientId, type, title, fileUrl required.
  A stored file needs the `uploadToken` receipt from `POST /api/crm/documents/upload`
  (no `data:` URLs, the signature pad uploads its PNG too). `signsDocumentId`
  names the patient's unsigned clinic consent/contract this signature signs:
  the new document (a CONSENT/CONTRACT) and that consent are both stamped
  signed (400 `consent_not_signable` / `signed_only_for_consent` otherwise).

### `GET /api/crm/documents/[id]` — fetch.

### `PATCH /api/crm/documents/[id]` — ADMIN, DOCTOR (own uploads). Rename, retype, replace file.

### `DELETE /api/crm/documents/[id]` — ADMIN, DOCTOR (own uploads).

### `POST /api/crm/documents/[id]/sign` — mark the clinic's consent/contract signed (409 `not_signable` otherwise).

### `POST /api/crm/documents/[id]/void` — ADMIN. Body `{ reason }` (3 to 500 characters). Voids a signed consent/contract (409 `not_voidable` for anything else); voiding twice returns the row unchanged.

Edits and deletions publish `document.updated` / `document.deleted`, which
refresh the patient's Mini App documents list.
