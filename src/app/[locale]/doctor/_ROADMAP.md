# Doctor account — roadmap (mockups → working)

> Last updated: 2026-05-13 · Mockups complete (reception, visits, patients, documents, conclusions, messages). This file captures the agreed plan for wiring them up to real data. Built without AI for first pass; AI rail comes as a separate layer on top.

## Decisions

- **Separate `VisitNote` model** (NOT extending `Document`). Structured fields matter more than "another file".
- **Phase 2 order:** patients → visits → documents → messages (SSE last, heaviest)
- **Phase 3 split:** reception works **without AI first** (CRUD + autosave + queue + finalize), then AI rail is layered on as Phase 3b
- All deploys via standard sshpass snippet, see `~/.claude/projects/-Users-joe/memory/reference_medbook_vps_access.md`

## Architecture map (what exists vs what's new)

| Need | Existing | Action |
|---|---|---|
| Doctor role | `Role.DOCTOR` in Prisma | Reuse |
| Multi-tenant clinicId scoping | `createApiHandler` + `runWithTenant()` | Reuse |
| Patient/Appointment/Document/Message models | All present | Reuse |
| **Visit note (structured)** | None | **New: `VisitNote` model** |
| AI LLM proxy | `src/server/ai/llm.ts` (Anthropic, cached) | Reuse in Phase 3b |
| Voice → SOAP | `src/server/workers/voice-soap.ts` | Reuse in Phase 3b |
| Patient summary | `Patient.summaryCache` + `/api/crm/patients/[id]/summary` | Reuse in Phase 3b |
| Realtime | Redis pub/sub `src/server/realtime/*` | Reuse for queue + messages SSE |
| Telegram/SMS channels | `src/server/telegram/*`, SMS adapter | Reuse for messages |

## Phase 1 — Foundation (1-2 days)

### 1.1 Prisma migration: `VisitNote`

```prisma
model VisitNote {
  id              String        @id @default(cuid())
  appointmentId   String        @unique
  appointment     Appointment   @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  patientId       String
  patient         Patient       @relation(fields: [patientId], references: [id])
  doctorId        String
  doctor          Doctor        @relation(fields: [doctorId], references: [id])
  clinicId        String
  clinic          Clinic        @relation(fields: [clinicId], references: [id])

  status          VisitNoteStatus @default(DRAFT)  // DRAFT | FINALIZED
  startedAt       DateTime?
  finalizedAt     DateTime?

  // Structured fields (Russian labels in UI)
  complaints      String[]      @default([])
  anamnesis       String[]      @default([])
  examination     String[]      @default([])
  diagnosisCode   String?       // ICD-10
  diagnosisName   String?
  prescriptions   String[]      @default([])
  advice          String[]      @default([])

  // Free-form rich body (markdown), used by editor
  bodyMarkdown    String?

  // AI provenance
  aiGenerated     Boolean       @default(false)
  aiModel         String?
  aiTokens        Int?

  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@index([patientId, finalizedAt])
  @@index([doctorId, status])
  @@index([clinicId])
}

enum VisitNoteStatus {
  DRAFT
  FINALIZED
}
```

Add back-relation `visitNote VisitNote?` to `Appointment`, `notes VisitNote[]` to `Patient` and `Doctor`.

### 1.2 Route guard

Add middleware-level check: any pathname starting with `/[locale]/doctor/` requires `session.user.role === "DOCTOR"`. Likely extend existing `middleware.ts` or `src/lib/auth.ts` helper.

### 1.3 Real session in doctor layout

Replace mock doctor info in `/doctor/layout.tsx` and `/doctor/_components/sidebar.tsx` (or wherever the avatar+name sit) with `auth()`-derived user.

**Acceptance:** Doctor logs in → sees their real name in sidebar; non-doctor hitting `/doctor/*` gets redirected to `/crm` or 403.

## Phase 2 — Working data screens (3-5 days)

Order: **patients → visits → documents → messages**.

### 2.1 `/doctor/patients` (list of patients)

- Replace mocks with `GET /api/crm/patients?doctorId=me`
- "Мои пациенты" filter = patients with ≥1 appointment where `appointment.doctorId === session.user.doctorId`
- Reuse existing search/filter UI; pagination via `?cursor=` (check what CRM uses)
- Sort: most recent appointment date desc by default
- Row click → `/doctor/patients/[id]` (Phase 4 detail)

**New API (if needed):** none — extend `/api/crm/patients` with `?forDoctorId=` param.

### 2.2 `/doctor/visits`

- Mounted dually at `/doctor/visits/[patientId]` AND `/doctor/reception/[patientId]/visits` — same component tree
- Adapter: timeline & table fed by `GET /api/crm/appointments?patientId=X&doctorId=me&status=COMPLETED`
- Each row joins to `VisitNote` (if exists) for the diagnosis + brief
- AI summary card on the right → `GET /api/crm/patients/[id]/summary` (existing endpoint, hits LLM cache)
- "Сравнение визитов" panel can stay as mock in Phase 2; turns on in Phase 3b

### 2.3 `/doctor/documents`

- `GET /api/crm/documents?patientId=X` for list (already exists)
- Upload via MinIO presigned PUT (check `src/app/api/crm/documents/upload-url` or similar)
- Delete with confirmation
- Filter by type (REFERRAL, PRESCRIPTION, RESULT, CONSENT, CONTRACT)

### 2.4 `/doctor/messages`

Heaviest of Phase 2.

- Thread list ← `GET /api/crm/conversations?doctorId=me`
- Conversation channels (TG/SMS/INAPP) already distinguished in `Conversation.channel`
- Open thread → `GET /api/crm/conversations/[id]/messages` (paginate cursor)
- Send: `POST /api/crm/conversations/[id]/messages` (routes through correct adapter by channel)
- **Real-time:** SSE endpoint `/api/crm/conversations/[id]/stream` listening to Redis channel `conversation:{id}:msg`
- Composer tabs (Сообщение/Шаблоны/Напоминание) — Шаблоны wired to `NotificationTemplate` table

**New API:**
- `GET /api/crm/conversations/[id]/stream` (SSE)
- maybe `GET /api/crm/notification-templates?scope=doctor`

## Phase 3a — Active reception (no AI) (4-6 days)

This is `/doctor/reception` when there's an `Appointment` with `status=IN_PROGRESS` assigned to this doctor.

### 3a.1 Get-or-create VisitNote

- When doctor opens `/doctor/reception` and has an active appointment → `POST /api/crm/visit-notes` (or `GET /api/crm/appointments/[id]/visit-note`) which upserts a `DRAFT` note.
- All edits patch this single note.

### 3a.2 Editor wiring

- `StructuredFieldsPanel` chips → `complaints[]`, `anamnesis[]`, `examination[]`, `prescriptions[]`, `advice[]` (arrays, add/remove chip = mutation)
- Diagnosis input → `diagnosisCode` + `diagnosisName` (autocomplete from ICD-10 seed table — check if exists, if not seed from public ICD-10 list)
- `NotesEditorPanel` textarea → `bodyMarkdown` with **debounced autosave** (1.5s debounce, PATCH `/api/crm/visit-notes/[id]`)
- Save indicator: optimistic "Сохранено" with timestamp from response

### 3a.3 Queue card → real data

- `GET /api/crm/appointments?doctorId=me&date=today&status=BOOKED,WAITING` ordered by scheduled time
- "Начать" button → PATCH appointment to `IN_PROGRESS` (closes current one first if any — confirm dialog)
- "Отложить" → PATCH status=`WAITING`, push back in order
- Subscribe to Redis channel `doctor:{id}:queue` for live updates (when receptionist adds a walk-in)

### 3a.4 Finalize ("Завершить приём")

Transaction:
1. `VisitNote.status = FINALIZED`, `finalizedAt = now`
2. `Appointment.status = COMPLETED`, `completedAt = now`
3. Create `Action` for receptionist (payment due) — reuse existing Action model
4. Trigger `post-visit-nps` worker (already exists)
5. Optional: redirect to next appointment in queue

### 3a.5 Side cards

- `HistoryDocsCard` → join recent `Appointment`+`VisitNote` and `Document` for this patient
- `RecentFilesCard` → last 3 `Document` rows for this patient
- `DraftConclusionsCard` → `VisitNote` where `doctorId=me AND status=DRAFT` (top 2)

**New API (Phase 3a):**
- `POST /api/crm/visit-notes` (upsert for appointmentId)
- `GET /api/crm/visit-notes/[id]`
- `PATCH /api/crm/visit-notes/[id]` (autosave)
- `POST /api/crm/visit-notes/[id]/finalize` (transaction)
- `GET /api/crm/icd10/search?q=...` (or import a static JSON if seed table missing)

## Phase 3b — AI rail (3-4 days, after 3a works)

Right rail wires to existing `src/server/ai/llm.ts`:

- **Автосводка** → `GET /api/crm/patients/[id]/summary` (exists)
- **Уточняющие вопросы** → new `POST /api/crm/ai/clarifying-questions` (input: current `VisitNote` draft + patient history → 3-5 questions)
- **Подсказки МКБ-10** → new `POST /api/crm/ai/icd10-suggest` (input: complaints+examination → ranked codes with confidence)
- **Предупреждения** → server-side rules (no LLM): missing allergy, drug interaction lookup against `Prescription` history, missing vitals — derive from `VisitNote` state
- **Умный конструктор** → new `POST /api/crm/ai/build-conclusion` (input: structured fields → fills `bodyMarkdown`)
- **Голосовой ввод** → existing `voice-soap` worker. Upload audio → enqueue job → SSE for partial transcript → fills relevant fields

## Phase 4 — Conclusions list & detail (2-3 days)

- `/doctor/conclusions` → list of `VisitNote` (FINALIZED) for `doctorId=me`, filters by date/patient/diagnosis
- Detail page (already a mockup in `/doctor/conclusions/[id]`) → load real `VisitNote`
- Edit (allowed within 24h of finalization, audit logged) → PATCH `/api/crm/visit-notes/[id]`
- Print → `pdfkit` worker, returns presigned URL
- Export → bulk via existing `data-export` worker

## Open questions to revisit

- Should `VisitNote` exist for `IN_PROGRESS` and `COMPLETED` only, or also for `BOOKED` (pre-visit draft from AI questionnaire)? Lean toward: NO, drafts only after consultation starts. AI pre-visit content goes into `Appointment.preVisitNotes` or similar.
- ICD-10 source: if no table exists, seed from minimum-russian-icd10.json (~14k entries, ~2MB) — acceptable.
- Print/PDF format: clinic letterhead from `Clinic.letterheadUrl`? Confirm with Javohir.
- Doctor's signature: digital? Use `Doctor.signatureUrl` (does this field exist?) or skip for v1.

## Definition of done (overall)

- Doctor logs in → can see their real patients
- Click patient → real visit history with AI summary
- Click appointment → if active, full reception screen with autosave editor
- Finalize → conclusion appears in `/doctor/conclusions`
- Messages tab → real Telegram/SMS/internal threads with live updates
- AI rail (Phase 3b) → summary, ICD-10 hints, clarifying questions all work
- All actions audited in `AuditLog`
- Mobile responsive (existing breakpoints hold)
- Deploy to staging on Vercel + production VPS via standard snippet

## Estimated bandwidth

- Phase 1: 1-2 days
- Phase 2: 3-5 days
- Phase 3a: 4-6 days
- Phase 3b: 3-4 days
- Phase 4: 2-3 days

**Total: ~2-3 weeks** of focused work for the full functional version (no perf tuning).

---

# Unpause readiness checklist (2026-05-30)

> Doctor cabinet was paused 2026-05-18 (priority pivot) and gated off behind
> `DOCTOR_CABINET_ENABLED=1` env in `src/app/[locale]/doctor/layout.tsx`.
> Default-off layout redirect bounces all `/doctor/*` traffic to `/crm`. Before
> flipping the gate back to enabled, every item below must be resolved or
> consciously waived. Audit run 2026-05-30 against current `main` (`f1e18a4 +
> 6d74082 deployed`). Findings labelled `[V]` were verified by reading the
> referenced file; `[A]` were reported by audit agents and not independently
> re-verified — re-verify before fixing.

## Blocker P0 — fake data exposure (must fix)

Active screens render `MOCK_*` constants. The moment the gate flips on, real
doctors see fake patient names, fake diagnoses, fake AI counts. These three
components are the hard blockers:

- [V] `/doctor/visits/[patientId]`
  - `_components/last-visit-card.tsx` → consumes `reception/_mocks.ts:MOCK_LAST_VISIT`
  - `_components/last-diagnosis-card.tsx` → consumes `reception/_mocks.ts:MOCK_LAST_DIAGNOSIS`
  - `_components/patient-meta-row.tsx` → consumes `reception/_mocks.ts:MOCK_META_CHIPS` (allergies, chronic, medications)
  - Fix: query last completed `Appointment` + linked `VisitNote` for diagnosis;
    query `PatientAllergy` / `PatientChronicCondition` for chips
- [V] `/doctor/patients`
  - `_components/ai-assistant-panel.tsx` → consumes `patients/_mocks.ts:MOCK_AI_RECOS` + `MOCK_AI_RECOS_TOTAL`
  - Fix: wire to `/api/crm/doctors/me/patient-segments` (already exists, role-gated)
    or to a real AI-recs endpoint when Phase 3b lands

Inactive but should be cleaned before unpause (cognitive load — anyone reading
the code will think they're live):

- [V] `reception/_components/patient-header.tsx` — consumes `MOCK_PATIENT`,
  not currently mounted but still imported
- [V] `reception/_components/visits-timeline.tsx` — consumes `MOCK_TIMELINE` +
  `MOCK_VISITS_TOTAL`, comment says kept for future; either wire or remove
- [V] All of `reception/_active-mocks.ts` — `MOCK_ACTIVE_PATIENT`,
  `MOCK_STRUCTURED_FIELDS`, `MOCK_EDITOR_BODY`, `MOCK_AI_QUESTIONS`,
  `MOCK_DIAGNOSIS_HINTS`, `MOCK_WARNINGS` etc. This was the Phase 3a/3b
  fixture set. Replace with real `VisitNote` reads + Phase 3b AI endpoints
  before unpause

## Blocker P0 — security: TOTP bypass via /api

- [V] `src/proxy.ts:268-272` — matcher excludes `/api`, so when the clinic
  enforces `Clinic.require2faForAll = true` and a doctor hasn't enrolled,
  page navigation to `/crm/me/security` is forced, but direct API calls to
  `/api/crm/doctors/me/**` succeed without enrolment
- [V] `src/lib/api-handler.ts` — `createApiHandler` / `createApiListHandler`
  have no `requiresTotpEnrollment` check anywhere in the chain
- Fix: insert TOTP-enrollment gate inside `createApiHandler` / `createApiListHandler`
  (after `buildContext`, before `runWithTenant`). Read `Clinic.require2faForAll`
  + `User.totpEnabledAt`, return `{ error: "MFA_REQUIRED" }` 403 when required
  and missing. Applies to all `/api/crm/**` routes, not just doctor — affects
  CRM users too, so coordinate with CRM team before flipping
- Risk if not fixed: doctor with TOTP-required policy can bypass MFA via
  curl, a mobile client, or any browser extension that fetches directly

## Blocker P1 — audit log coverage

- [V] `POST /api/crm/doctors/me/conversations/find-or-create` —
  `src/app/api/crm/doctors/me/conversations/find-or-create/route.ts:106-121`.
  Creates a new `Conversation` row (cold-start outbound TG/SMS thread to patient),
  fires SSE via `publishEventSafe`, but never calls `audit()`. Compliance-relevant
  — first message from a clinic to a patient should be logged
- Fix: add `audit({ action: AUDIT_ACTION.CONVERSATION_CREATED, entityType:
  "Conversation", entityId: created.id, ... })` after `prisma.conversation.create`
- Explicitly NOT a gap (verified): `/me/presets` POST/PATCH/DELETE — file
  header at `src/app/api/crm/doctors/me/presets/route.ts:12-13` documents
  "No audit/SSE: these are personal config, not patient data". Treat as
  intentional; revisit only if compliance later requires personal-config audit

## Blocker P1 — internationalisation (66+ components)

Every component listed below renders raw Cyrillic strings without
`useTranslations` and is therefore untranslatable to UZ. Counts per screen
(verified by audit pass against `/doctor/**` directory tree):

| Screen | components with hardcoded RU |
|---|---|
| `reception` | 15+ |
| `my-day` | 10 |
| `patients` (+ `[id]`) | 13 (7 + 6) |
| `visits` | 5 |
| `settings` | 5 |
| `documents` | 4 |
| `notifications` | 4 |
| `messages` | 3 |
| `conclusions` | 2 |
| `schedule` | 1 |
| `references` | 1 |
| `analytics` | 1 |
| layout (sidebar + topbar) | 2 |

Fix strategy: per-screen sweep + add entries to `src/messages/{ru,uz}.json`
under a `doctor.*` namespace. Mirror the existing `crm.*` namespace
structure to stay consistent. Track per-screen in a follow-up issue when
unpause becomes real — don't try to do all 66 in one pass.

## Non-blockers (intentional or out-of-scope)

These came up in the audit but are **not** blockers — keep listed so we
don't re-litigate during the next unpause review:

- [V] Cross-doctor labs visibility on `/api/crm/doctors/me/patients/[patientId]/labs`:
  any doctor in the clinic who has seen the patient sees every lab, regardless
  of who ordered it. Code comment at top of the route explicitly chose this.
  Anti-leak still in place via the appointment-relationship check. Acceptable
  by product spec; document if compliance asks.
- [V] Session-lifetime + idle-timeout not re-checked on API calls. The proxy
  page-layer gate prevents stale users from reaching the UI; API calls inherit
  the JWT TTL (24h, rotated hourly). Acceptable by JWT design.
- [A] SSE event payloads carry `clinicId` for fan-out; doctor-specific filtering
  is client-side. Sufficient because (a) JWT auth still required to subscribe,
  (b) the client UI filters by `event.doctorId`. Re-evaluate only if we add
  server-pushed PHI to event payloads later.
- [A] All 30+ doctor-facing API endpoints exist and enforce
  `{ roles: ["DOCTOR"] }` via `createApiHandler` (audit pass enumerated all
  21 routes under `/api/crm/doctors/me/**`). No route-coverage gap to fill.
- [V] Link from `settings/_components/security-tab.tsx:95` to
  `/${locale}/crm/me/security` — agent flagged as broken, FALSE ALARM:
  `src/app/[locale]/crm/me/security/page.tsx` exists. No action.
- [V] All Prisma fields referenced by doctor components exist in schema
  (`VisitNote`, `Patient`, `Appointment`, `Doctor`, `Document`, `DoctorPreset`,
  `LabResult` all match). No schema migrations needed for unpause itself.

## Sequence to actually unpause

When the pivot reverses and we re-enable the cabinet:

1. **Land P0 mock-removal** (blocker section above) on a feature branch.
   Acceptance: grep `MOCK_` in `src/app/[locale]/doctor/**` returns only
   commented-out or removed lines; live screens query real data.
2. **Land P0 TOTP gate in `createApiHandler`**. Acceptance: vitest +
   integration test where a doctor without `totpEnabledAt` in a clinic with
   `require2faForAll = true` gets 403 `MFA_REQUIRED` from a curl POST to
   `/api/crm/doctors/me/today`.
3. **Land P1 audit call** in conversations find-or-create. Acceptance:
   `AuditLog` row exists after first cold-start outbound to a patient.
4. **Start per-screen i18n sweep**. Reception + my-day first (highest doctor
   time-on-screen). Don't block unpause on full coverage — UZ doctor users
   are downstream of CRM rollout anyway.
5. **Flip `DOCTOR_CABINET_ENABLED=1`** in `.env` on staging, smoke-test for
   one week with one volunteer doctor before prod.
6. **Remove the `DOCTOR_CABINET_ENABLED` env gate** from `layout.tsx` once
   prod is green for two weeks.

## Closed by this checklist

Memory tasks `#523` (doctor cabinet mock removal) and `#525` (doctor cabinet
i18n sweep) are rolled into the P0 / P1 sections above. Don't re-create them
as standalone — work the checklist top-to-bottom when unpause comes.
