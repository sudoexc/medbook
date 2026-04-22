# Database Changelog

## Phase 1 — Initial schema (2026-04-22)

**Migration:** `20260422080121_phase-1-initial`

First production-shaped schema for the MedBook / NeuroFax CRM. Legacy
pre-production schema (`Doctor`, `User`, `Patient`, `Appointment`, `Lead`,
`Payment`, `MedicalRecord`, `DoctorSchedule`, `DoctorDayOff`, `AuditLog`,
`Review`) fully replaced. No data carry-over — the old DB is wiped on first
apply.

### Multi-tenancy

- Every operational model carries `clinicId String` + FK to `Clinic`.
- All within-clinic uniqueness is composite: `@@unique([clinicId, ...])`.
- All hot-filter indexes lead with `clinicId`: `@@index([clinicId, ...])`.
- `AuditLog` has `clinicId` but is intentionally excluded from the Prisma
  middleware allowlist so system / cross-tenant actions can always be
  recorded.
- `User` can have `clinicId = null` for the `SUPER_ADMIN` role; all other
  roles must have a clinic.
- `Account`, `Session`, `VerificationToken` (NextAuth) are not tenant-scoped.

### Money

- Monetary fields (`Payment.amount`, `Payment.refundedAmount`,
  `Service.priceBase`, `Appointment.priceFinal`, `Patient.ltv`, `Patient.balance`,
  `AppointmentService.priceSnap`) are `Int` in the minor unit of the row's
  currency (tiyin for UZS, cents for USD).
- `Payment.currency` stores the actual currency used; `Payment.amountUsdSnap`
  + `Payment.fxRate` capture the conversion at pay time.
- `ExchangeRate { clinicId, date, rateUsd }` stores the daily UZS→USD rate
  per clinic.

### Models (28)

Tenancy: `Clinic`, `ExchangeRate`, `ProviderConnection`.
Auth: `User`, `Account`, `Session`, `VerificationToken`.
Staff / catalog: `Doctor`, `DoctorSchedule`, `DoctorTimeOff`, `Service`,
`ServiceOnDoctor`, `Cabinet`.
Patients & flow: `Patient`, `Appointment`, `AppointmentService`, `Payment`,
`Document`, `Lead`, `OnlineRequest`.
Communications: `Communication`, `Conversation`, `Message`.
Notifications: `NotificationTemplate`, `NotificationSend`, `Campaign`.
Call center: `Call`.
Misc: `Review`, `AuditLog`.

### Enums (20)

`Role`, `Currency`, `PaymentMethod`, `PaymentStatus`, `AppointmentStatus`,
`PatientSegment`, `ChannelType`, `CommunicationChannel`,
`CommunicationDirection`, `ConversationMode`, `TemplateCategory`, `Gender`,
`Lang`, `ConversationStatus`, `MessageDirection`, `MessageStatus`,
`NotificationStatus`, `NotificationTrigger`, `CallDirection`, `DocumentType`,
`LeadStatus`, `LeadSource`, `ProviderKind`.

### Seed

Two clinics (`neurofax`, `demo-clinic`), one global `SUPER_ADMIN`, per-clinic
`ADMIN` + `RECEPTIONIST` + 2 `DOCTOR` accounts (Mon–Fri 09:00–18:00
schedule), 10 patients, 5 services, 2 cabinets, 20 appointments over the
next 7 days, 10 notification templates (5 reminder / 3 marketing / 2
transactional), daily exchange rate (1 USD = 12 700 UZS).

Passwords: `super` / `admin` / `doctor` / `recept` (bcrypt @ cost 10).
