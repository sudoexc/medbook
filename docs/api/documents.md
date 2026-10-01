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

## Endpoints

### `GET /api/crm/documents`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR (scoped to own patients/appointments), NURSE.
- Filters: `patientId`, `appointmentId`, `type`, `source`, `q`, `from`, `to`,
  `pendingSignature` (the clinic's unsigned consents/contracts only). Cursor pagination.

### `POST /api/crm/documents`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR, NURSE.
- Body: `CreateDocumentSchema` — patientId, type, title, fileUrl required.
  A stored file needs the `uploadToken` receipt from `POST /api/crm/documents/upload`
  (no `data:` URLs, the signature pad uploads its PNG too). `signed: true` files
  a consent/contract already signed; `signsDocumentId` stamps the unsigned
  consent the signature belongs to.

### `GET /api/crm/documents/[id]` — fetch.

### `PATCH /api/crm/documents/[id]` — ADMIN, DOCTOR (own uploads). Rename, retype, replace file.

### `DELETE /api/crm/documents/[id]` — ADMIN, DOCTOR (own uploads).

### `POST /api/crm/documents/[id]/sign` — mark the clinic's consent/contract signed (409 `not_signable` otherwise).

Edits and deletions publish `document.updated` / `document.deleted`, which
refresh the patient's Mini App documents list.
