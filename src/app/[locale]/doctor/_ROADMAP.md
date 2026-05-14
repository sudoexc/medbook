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
