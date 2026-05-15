/**
 * Centralized audit action string constants.
 *
 * `AuditLog.action` is a free-form `String` column in the schema (intentionally
 * — see prisma/schema.prisma → model AuditLog), so any string is technically
 * valid. This map exists purely to give callers a single typed entry point for
 * the well-known actions, so the action string is grep-able and consistent
 * across emit sites.
 *
 * The historical convention is `entity.verb` lowercase (e.g. `appointment.update`,
 * `patient.delete`). Newer dedicated actions for high-signal events use
 * `SCREAMING_SNAKE_CASE` to make them stand out in audit-log filters; both
 * styles are supported by the schema.
 */
export const AUDIT_ACTION = {
  // Phase 11 — high-signal reschedule emit. Distinct from the generic
  // `appointment.update` so reports can filter "только переносы" without
  // sifting through every status flip.
  APPOINTMENT_RESCHEDULED: "APPOINTMENT_RESCHEDULED",

  // Phase 13 — Action Center lifecycle. `entityType: "Action"` for all of
  // these. `meta` carries `{ type, payload, oldStatus, newStatus, ... }` plus
  // any reason / preset / role-specific fields. `ACTION_CREATED` and
  // `ACTION_UPDATED` are emitted by the engine repository (`upsertAction`);
  // the rest fire from the REST handlers as the user transitions an action.
  ACTION_CREATED: "ACTION_CREATED",
  ACTION_UPDATED: "ACTION_UPDATED",
  ACTION_SNOOZED: "ACTION_SNOOZED",
  ACTION_DISMISSED: "ACTION_DISMISSED",
  ACTION_DONE: "ACTION_DONE",
  ACTION_REOPENED: "ACTION_REOPENED",
  ACTION_EXPIRED: "ACTION_EXPIRED",

  // Phase 15 Wave 1 — every LLM proxy call (success or error) lands one of
  // these. `meta` carries `{ useCase, provider, model, inputTokens,
  // outputTokens, cacheHit, costUzs, latencyMs, errorCode, promptHash }`.
  // The hash lets you slice cache patterns later without storing the
  // (already-redacted) prompt itself in the audit table.
  LLM_CALL: "LLM_CALL",

  // Phase 15 Wave 2 — manual "Refresh" click on a patient summary card.
  // Distinct from the auto-refresh enqueued on TTL expiry so the audit
  // trail can show who hit "Обновить". `entityType: "Patient"`,
  // `entityId: <patientId>`. `meta.locale` carries 'ru' | 'uz'.
  PATIENT_SUMMARY_REFRESHED: "PATIENT_SUMMARY_REFRESHED",

  // Phase 15 Wave 3 — NL Command Bar question. One row per `/ai/ask` POST,
  // success or failure. `entityType: "LLMUsage"`, `entityId: null`. `meta`
  // carries `{ question_preview: <first 100 chars>, locale, toolsUsed:
  // string[], costUzs }`. Distinct from `LLM_CALL` (proxy-level) so the
  // dashboard can slice "how many NL questions per day" without scanning
  // useCase strings on LLMUsage.
  AI_QUERY_ASKED: "AI_QUERY_ASKED",

  // Phase 15 Wave 4 — admin clicked "Сгенерировать варианты" inside the
  // notification template editor. `entityType: "LLMUsage"`, `entityId:
  // null`. `meta` carries `{ channel, audience, locale, variants_count,
  // costUzs }`. Generation only — the actual save back into
  // NotificationTemplate is captured by the regular `template.create` /
  // `template.update` audit rows.
  MARKETING_COPY_GENERATED: "MARKETING_COPY_GENERATED",

  // Phase 15 Wave 5 — Voice → SOAP pipeline finished and wrote
  // `MedicalCase.soapDraft`. `entityType: "MedicalCase"`, `entityId:
  // <caseId>`. `meta` carries `{ doctorId, durationSec, transcribeCostUzs,
  // structureCostUzs, totalCostUzs, language }`. One row per successful
  // worker run; failures are logged via the regular `LLM_CALL` audit
  // (errorCode populated on the LLMUsage row).
  VOICE_SOAP_DRAFTED: "VOICE_SOAP_DRAFTED",

  // Phase 15 Wave 5 — patient asked for booking suggestions in the Mini
  // App via the NL chat panel. `entityType: "LLMUsage"`, `entityId: null`.
  // `meta` carries `{ message_preview, locale, suggestions_count, costUzs }`.
  // Distinct from `LLM_CALL` so the dashboard can slice "how many NL booking
  // requests per day" without scanning useCase strings.
  MINIAPP_BOOKING_SUGGESTED: "MINIAPP_BOOKING_SUGGESTED",

  // Phase 16 Wave 1 — patient added a relative through the Mini App family
  // switcher. `entityType: "PatientFamily"`, `entityId: <PatientFamily.id>`.
  // `meta` carries `{ ownerPatientId, linkedPatientId, relationship,
  // createdNew: boolean }` — `createdNew` distinguishes the "claim existing
  // relative" path from the "fully new patient" path so support can spot
  // duplicates created by the Mini App later.
  PATIENT_FAMILY_LINKED: "PATIENT_FAMILY_LINKED",

  // Phase 16 Wave 1 — patient unlinked a relative. `entityType:
  // "PatientFamily"`, `entityId: <PatientFamily.id>` (the row about to be
  // deleted). `meta` carries `{ ownerPatientId, linkedPatientId,
  // relationship }`. The Patient row is preserved (we only drop the link
  // row) so the relative's appointment history remains intact.
  PATIENT_FAMILY_UNLINKED: "PATIENT_FAMILY_UNLINKED",

  // Phase 16 Wave 2 — patient submitted the pre-visit questionnaire from
  // the Mini App. `entityType: "Appointment"`, `entityId: <appointmentId>`.
  // `meta` carries `{ patientId, complaintsLen, allergiesCount,
  // medicationsCount, notesLen }`. Free-text fields are NOT in meta — only
  // their lengths — to keep audit storage manageable.
  PRE_VISIT_QUESTIONNAIRE_SUBMITTED: "PRE_VISIT_QUESTIONNAIRE_SUBMITTED",

  // Phase 16 Wave 2 — patient submitted post-visit NPS rating from the
  // Mini App. `entityType: "PatientReview"`, `entityId: <reviewId>`.
  // `meta` carries `{ patientId, appointmentId, doctorId, score,
  // commentLen, source: 'tg-miniapp' }`.
  NPS_RECEIVED: "NPS_RECEIVED",

  // Phase 16 Wave 2 — low-NPS rating triggered a `LOW_NPS_RECEIVED` Action
  // emit. Fired from the same NPS endpoint. `entityType: "Action"`,
  // `entityId: <actionId>`. `meta` carries `{ patientId, appointmentId,
  // score, threshold }`. Lets admins audit "how often does the alert fire"
  // without joining Action + PatientReview.
  LOW_NPS_RECEIVED: "LOW_NPS_RECEIVED",

  // Phase 16 Wave 3 — doctor wrote a prescription on a case detail page.
  // `entityType: "Prescription"`, `entityId: <prescriptionId>`. `meta`
  // carries `{ caseId, patientId, drugName, scheduleTimes, days,
  // remindersEnabled }` — drug+schedule snapshot for compliance, since the
  // row itself can be edited later.
  PRESCRIPTION_CREATED: "PRESCRIPTION_CREATED",

  // Phase 16 Wave 3 — doctor edited an existing prescription (status flip,
  // dosage tweak, schedule change). `entityType: "Prescription"`. `meta`
  // carries the full diff `{ before, after }` for forensic reconstruction.
  PRESCRIPTION_UPDATED: "PRESCRIPTION_UPDATED",

  // Phase 16 Wave 3 — doctor deleted (or hard-archived) a prescription.
  // `entityType: "Prescription"`. `meta` snapshots the row at deletion time
  // so the audit log is still meaningful after the row is gone.
  PRESCRIPTION_DELETED: "PRESCRIPTION_DELETED",

  // Phase 16 Wave 3 — patient hit "Принял" / "Пропустил" / "Отложить" on a
  // medication reminder card in the Mini App.
  // `entityType: "MedicationReminderSend"`, `entityId: <reminderSendId>`.
  // `meta` carries `{ prescriptionId, patientId, status, snoozeMinutes? }`.
  MEDICATION_REMINDER_RESPONDED: "MEDICATION_REMINDER_RESPONDED",

  // Phase 16 Wave 3 — first-time visit to the refer-a-friend page minted a
  // referral code for the patient. `entityType: "ReferralCode"`, `entityId:
  // <code.id>`. `meta` carries `{ patientId, code }`.
  REFERRAL_CODE_GENERATED: "REFERRAL_CODE_GENERATED",

  // Phase 16 Wave 3 — referred patient's first appointment hit COMPLETED,
  // minting a PENDING `ReferralReward`. `entityType: "ReferralReward"`,
  // `entityId: <reward.id>`. `meta` carries `{ referrerPatientId,
  // referredPatientId, rewardPercent, expiresAt }`.
  REFERRAL_REWARD_EARNED: "REFERRAL_REWARD_EARNED",

  // Phase 16 Wave 3 — pending referral reward consumed against a fresh
  // booking. `entityType: "ReferralReward"`, `entityId: <reward.id>`.
  // `meta` carries `{ appointmentId, referrerPatientId, rewardPercent,
  // discountTiins, priceBefore, priceAfter }`.
  REFERRAL_REWARD_APPLIED: "REFERRAL_REWARD_APPLIED",

  // Phase 17 Wave 1 — patient flipped their marketing opt-out flag.
  // `entityType: "Patient"`, `entityId: <patientId>`. `meta` carries
  // `{ source: 'mini-app' | 'sms-stop' | 'admin' | 'data-deletion',
  //    optedOut: boolean, before: { marketingOptOut, marketingOptOutAt,
  //    marketingOptOutSource } }`. The flag is honoured by every marketing
  // send-site via `isAllowedToReceive` (see
  // `src/server/notifications/consent-gate.ts`).
  MARKETING_OPT_OUT_CHANGED: "MARKETING_OPT_OUT_CHANGED",

  // Phase 17 Wave 1 — ADMIN opened the PHI-access audit
  // (/crm/settings/audit?type=patient-view). `entityType: "PatientView"`,
  // `entityId: null`. `meta` carries `{ filters: {...}, returned: number }`.
  // The audit-of-the-audit closes the recursive question "who looked at
  // who looked at the patient cards".
  PATIENT_VIEW_AUDIT_ACCESSED: "PATIENT_VIEW_AUDIT_ACCESSED",

  // Phase 17 Wave 3 reservation — patient row scrubbed via the DSAR flow.
  // Wave 1 only declared the constant so feature-flagged callers could
  // already reference it without breaking the build. The Wave 3 wiring
  // adds dedicated `PATIENT_HARD_DELETED` and `PATIENT_ANONYMIZED` rows
  // (see below) — `PATIENT_DELETED` itself is preserved for any legacy
  // callers but is no longer the preferred constant for the DSAR flow.
  // `entityType: "Patient"`, `entityId: <patientId>`. `meta` carries the
  // full pre-scrub snapshot needed for forensic reconstruction.
  PATIENT_DELETED: "PATIENT_DELETED",

  // Phase 17 Wave 3 — patient (or admin on their behalf) requested a data
  // export. `entityType: "DataExportJob"`, `entityId: <jobId>`. `meta`
  // carries `{ patientId, requestedBy: 'patient' | 'admin', adminUserId? }`.
  // Fired the moment the job row lands in PENDING — before the worker
  // touches it — so the audit trail captures the request even if the
  // worker later fails.
  PATIENT_DATA_EXPORT_REQUESTED: "PATIENT_DATA_EXPORT_REQUESTED",

  // Phase 17 Wave 3 — worker finished bundling the patient JSON, encrypted
  // it, and uploaded the ZIP to MinIO. `entityType: "DataExportJob"`,
  // `entityId: <jobId>`. `meta` carries `{ patientId, fileSizeBytes,
  // storageKey }`. Distinct from `_DELIVERED` so support can tell whether
  // the bundle was generated but Telegram delivery failed.
  PATIENT_DATA_EXPORT_GENERATED: "PATIENT_DATA_EXPORT_GENERATED",

  // Phase 17 Wave 3 — bundle was successfully sent to the requester via
  // Telegram (sendDocument). `entityType: "DataExportJob"`, `entityId:
  // <jobId>`. `meta` carries `{ patientId, telegramChatId,
  // telegramMessageId? }`.
  PATIENT_DATA_EXPORT_DELIVERED: "PATIENT_DATA_EXPORT_DELIVERED",

  // Phase 17 Wave 3 — admin or patient hit the signed download endpoint.
  // `entityType: "DataExportJob"`, `entityId: <jobId>`. `meta` carries
  // `{ patientId, actor: 'admin' | 'patient', adminUserId?,
  // downloadCount }`. Each download bumps `DataExportJob.downloadCount`
  // for forensic counting.
  PATIENT_DATA_EXPORT_DOWNLOADED: "PATIENT_DATA_EXPORT_DOWNLOADED",

  // Phase 17 Wave 3 — bundle generation or delivery failed. `entityType:
  // "DataExportJob"`, `entityId: <jobId>`. `meta` carries `{ patientId,
  // stage: 'generate' | 'upload' | 'deliver', errorCode?, errorMessage }`.
  PATIENT_DATA_EXPORT_FAILED: "PATIENT_DATA_EXPORT_FAILED",

  // Phase 17 Wave 3 — patient requested account deletion via the Mini App
  // (auto-creates a PENDING_REVIEW DataDeletionJob). `entityType:
  // "DataDeletionJob"`, `entityId: <jobId>`. `meta` carries `{ patientId,
  // mode, scheduledFor, reason? }`.
  PATIENT_DELETION_REQUESTED: "PATIENT_DELETION_REQUESTED",

  // Phase 17 Wave 3 — admin approved a pending deletion request in the
  // CRM DSAR queue (or Mini App auto-approval bumps a freshly-requested
  // job to APPROVED). `entityType: "DataDeletionJob"`, `entityId:
  // <jobId>`. `meta` carries `{ patientId, scheduledFor, mode,
  // approvedBy: 'admin' | 'auto', adminUserId? }`.
  PATIENT_DELETION_APPROVED: "PATIENT_DELETION_APPROVED",

  // Phase 17 Wave 3 — pending or approved deletion was cancelled (patient
  // changed their mind via Mini App, or admin clicked "Отменить").
  // `entityType: "DataDeletionJob"`, `entityId: <jobId>`. `meta` carries
  // `{ patientId, actor: 'patient' | 'admin', adminUserId?, fromStatus }`.
  PATIENT_DELETION_CANCELLED: "PATIENT_DELETION_CANCELLED",

  // Phase 17 Wave 3 — deletion job ran in HARD_DELETE mode and removed the
  // Patient row entirely. `entityType: "Patient"`, `entityId: <patientId>`.
  // `meta` snapshots the pre-delete row so the audit trail is meaningful
  // after the row is gone, plus `{ jobId }`. Rare in practice — the
  // default mode is ANONYMIZE.
  PATIENT_HARD_DELETED: "PATIENT_HARD_DELETED",

  // Phase 17 Wave 3 — deletion job ran in ANONYMIZE mode and scrubbed PII
  // off the Patient row while preserving aggregate analytics (visit
  // counts, revenue, etc.). `entityType: "Patient"`, `entityId:
  // <patientId>`. `meta` carries `{ jobId, before: { fullName,
  // phoneNormalized, telegramId, ... } }` so the pre-scrub identifiers
  // are still recoverable for legal/forensic requests.
  PATIENT_ANONYMIZED: "PATIENT_ANONYMIZED",

  // Phase 17 Wave 2 — TOTP enrolment finished. `entityType: "User"`,
  // `entityId: <userId>`. `meta` carries `{ recoveryCodeCount }`.
  // The TOTP secret itself is NEVER in audit (sensitive seed material).
  TOTP_ENROLLED: "TOTP_ENROLLED",

  // Phase 17 Wave 2 — user disabled TOTP after re-entering their password.
  // `entityType: "User"`, `entityId: <userId>`. `meta` is `{}`.
  TOTP_DISABLED: "TOTP_DISABLED",

  // Phase 17 Wave 2 — user clicked "Regenerate recovery codes". The new
  // 10 codes are shown ONCE; old hashes are dropped. `entityType: "User"`,
  // `entityId: <userId>`. `meta` is `{ recoveryCodeCount }`.
  RECOVERY_CODES_REGENERATED: "RECOVERY_CODES_REGENERATED",

  // Phase 17 Wave 2 — recovery code consumed during 2FA login. The matched
  // hash is removed from `recoveryCodesHash`. `entityType: "User"`,
  // `entityId: <userId>`. `meta` is `{ remaining: number }`. We never log
  // the plaintext code.
  RECOVERY_CODE_USED: "RECOVERY_CODE_USED",

  // Phase 17 Wave 2 — proxy invalidated a session because lastActivityAt
  // exceeded the clinic's idle timeout. `entityType: "UserSession"`,
  // `entityId: <userSessionId>`. `meta` carries `{ idleMinutes,
  // configuredMinutes }`.
  SESSION_TIMEOUT_LOGOUT: "SESSION_TIMEOUT_LOGOUT",

  // Phase 17 Wave 2 — proxy invalidated a session because it was older
  // than the 8h hard cap. `entityType: "UserSession"`, `entityId:
  // <userSessionId>`. `meta` carries `{ ageMinutes }`.
  SESSION_FORCED_REROTATE: "SESSION_FORCED_REROTATE",

  // Phase 17 Wave 2 — a fresh login deleted a prior UserSession for the
  // same user. `entityType: "UserSession"`, `entityId: <kicked.id>`.
  // `meta` carries `{ kickedSessionId, newSessionId }`.
  CONCURRENT_SESSION_KICKED: "CONCURRENT_SESSION_KICKED",

  // Phase 17 Wave 2 — admin flipped the per-clinic "require 2FA for all
  // staff" switch. `entityType: "Clinic"`, `entityId: <clinicId>`. `meta`
  // carries `{ before, after, planSlug }`.
  CLINIC_2FA_REQUIREMENT_CHANGED: "CLINIC_2FA_REQUIREMENT_CHANGED",

  // Phase 17 Wave 2 — admin changed the clinic's session idle timeout.
  // `entityType: "Clinic"`, `entityId: <clinicId>`. `meta` carries
  // `{ before, after }`. (Bound is enforced by the API at [5, 240].)
  CLINIC_SESSION_IDLE_CHANGED: "CLINIC_SESSION_IDLE_CHANGED",

  // Phase 17 Wave 4 — SUPER_ADMIN opened /admin/encryption-health (or hit
  // the JSON endpoint). `entityType: "EncryptionHealth"`, `entityId: null`.
  // `meta` carries `{ activeKeyVersion, knownVersions, counts: {...},
  // probeOk: boolean }`. The audit-of-the-audit is intentional — peeking at
  // encryption posture is privileged enough to record.
  ENCRYPTION_HEALTH_CHECKED: "ENCRYPTION_HEALTH_CHECKED",

  // Phase 17 Wave 4 — `decryptField` threw on a real DB row. Surfaces
  // tampering, key mismatch, or a row encrypted under a key we no longer
  // have. `entityType` matches the source table (`Patient`, `MedicalCase`,
  // `Prescription`), `entityId` is the row id. `meta` carries
  // `{ field, versionPrefix?, errorMessage }`. Plaintext is NEVER in meta.
  ENCRYPTION_DECRYPT_FAILED: "ENCRYPTION_DECRYPT_FAILED",

  // Phase 18 Wave 1 — ADMIN clicked "Refresh now" on the analytics page,
  // triggering a manual `REFRESH MATERIALIZED VIEW CONCURRENTLY` of all four
  // Phase 18 MVs. `entityType: "AnalyticsView"`, `entityId: null`. `meta`
  // carries `{ totalMs, perView: { name, ms }[], failures: { name, error }[] }`.
  // The hourly auto-refresh cron deliberately does NOT audit — that would
  // spam the table with 24 rows/day per clinic for zero forensic value.
  ANALYTICS_VIEWS_REFRESHED: "ANALYTICS_VIEWS_REFRESHED",

  // Phase 18 Wave 1 — saved-report lifecycle (W3 builder owns the UI; W1
  // declares the constants so the foundation is in place). `entityType:
  // "SavedReport"`, `entityId: <reportId>`. `meta` carries the report `name`
  // plus a small fingerprint of `config` (dimension/measure counts) so we
  // can audit "what shape of report was saved" without persisting the full
  // builder JSON in the audit log.
  SAVED_REPORT_CREATED: "SAVED_REPORT_CREATED",
  SAVED_REPORT_UPDATED: "SAVED_REPORT_UPDATED",
  SAVED_REPORT_DELETED: "SAVED_REPORT_DELETED",

  // Phase 18 Wave 1 — scheduled-report lifecycle. `entityType:
  // "ScheduledReport"`, `entityId: <scheduleId>`. `meta` carries
  // `{ savedReportId, cadence, deliveryChannel, deliveryTarget, enabled }`.
  // The W4 cron uses `_DELIVERED` / `_FAILED` once delivery lands.
  SCHEDULED_REPORT_CREATED: "SCHEDULED_REPORT_CREATED",
  SCHEDULED_REPORT_UPDATED: "SCHEDULED_REPORT_UPDATED",
  SCHEDULED_REPORT_DELETED: "SCHEDULED_REPORT_DELETED",
  SCHEDULED_REPORT_DELIVERED: "SCHEDULED_REPORT_DELIVERED",
  SCHEDULED_REPORT_FAILED: "SCHEDULED_REPORT_FAILED",

  // Phase 18 Wave 4 — schedule auto-disabled by the worker after 3
  // consecutive delivery failures. Distinct from `_FAILED` so support can
  // alert/dashboard on "schedule went silent" without scanning the
  // (potentially large) failure log. `entityType: "ScheduledReport"`,
  // `entityId: <scheduleId>`. `meta` carries `{ savedReportId,
  // consecutiveFailures, lastFailureReason }`.
  SCHEDULED_REPORT_DISABLED_AFTER_FAILURES: "SCHEDULED_REPORT_DISABLED_AFTER_FAILURES",

  // Phase 18 Wave 1 — saved report executed via the W3 "Run report" path.
  // `entityType: "SavedReport"`, `entityId: <reportId>`. `meta` carries
  // `{ runMs, rowCount, dimensions, measures }`. Distinct from a manual
  // refresh — this is "user ran their stored query".
  ANALYTICS_REPORT_RUN: "ANALYTICS_REPORT_RUN",

  // Phase 19 — SaaS Self-Service.
  //
  // Wave 1 — plan-limit foundation.
  //   PLAN_LIMIT_WARNED  — usage crossed 80% of a quota (still ok). One row
  //   per API entry that gets `warn`. `entityType: "Clinic"`,
  //   `entityId: <clinicId>`. `meta` carries `{ quota, current, max,
  //   pctUsed }`.
  //   PLAN_LIMIT_BLOCKED — usage hit 100% on a Free-plan tenant. Same shape
  //   as `_WARNED`. Pro/Enterprise never emit this row (warn-only).
  PLAN_LIMIT_WARNED: "PLAN_LIMIT_WARNED",
  PLAN_LIMIT_BLOCKED: "PLAN_LIMIT_BLOCKED",
  // Wave 4 (preview) — invoice lifecycle. Wave 1 declares the constants so
  // the foundation is in place; the actual emit sites land in Wave 4 with
  // the Click/Payme webhook + admin self-service downgrade flow.
  // `entityType: "Invoice"`, `entityId: <invoiceId>`. `meta` carries the
  // shape relevant to each transition (number, amountTiins, paymentRef…).
  INVOICE_CREATED: "INVOICE_CREATED",
  INVOICE_PAID: "INVOICE_PAID",
  INVOICE_VOIDED: "INVOICE_VOIDED",

  // Wave 2 — self-service signup + onboarding playbook lifecycle.
  //
  //   CLINIC_SELF_SIGNUP_REQUESTED — POST /api/public/signup landed.
  //   `entityType: "ClinicSignupToken"`, `entityId: <token.id>`. `meta`
  //   carries `{ email, clinicName, planSlug, playbookSlug, preferredLocale }`.
  //   `clinicId` is null because the clinic does not exist yet.
  //
  //   CLINIC_SELF_SIGNUP_COMPLETED — confirm-link consumed; clinic, admin
  //   user, TRIAL subscription, optional playbook all materialised.
  //   `entityType: "Clinic"`, `entityId: <clinic.id>`. `meta` carries
  //   `{ tokenId, email, planSlug, playbookSlug, preferredLocale }`.
  //
  //   CLINIC_SELF_SIGNUP_TOKEN_EXPIRED — visitor clicked an expired or
  //   already-consumed link. `entityType: "ClinicSignupToken"`,
  //   `entityId: <token.id>`. `meta` carries `{ email, reason }`.
  //
  //   PLAYBOOK_APPLIED — the seed-content applier finished. `entityType:
  //   "Clinic"`, `entityId: <clinicId>`. `meta` carries `{ slug,
  //   servicesCreated, templatesCreated, scheduleSet }`.
  CLINIC_SELF_SIGNUP_REQUESTED: "CLINIC_SELF_SIGNUP_REQUESTED",
  CLINIC_SELF_SIGNUP_COMPLETED: "CLINIC_SELF_SIGNUP_COMPLETED",
  CLINIC_SELF_SIGNUP_TOKEN_EXPIRED: "CLINIC_SELF_SIGNUP_TOKEN_EXPIRED",
  PLAYBOOK_APPLIED: "PLAYBOOK_APPLIED",

  // Wave 4 — white-label + impersonation hardening + bulk admin ops.
  //
  //   BRANDING_CHANGED — admin saved /crm/settings/branding. `entityType:
  //   "Clinic"`, `entityId: <clinicId>`. `meta` carries `{ changed: ("logoUrl"
  //   | "brandColor" | "brandSecondaryColor" | "customSubdomain")[] }`. No
  //   row when nothing changed (the PATCH no-ops).
  BRANDING_CHANGED: "BRANDING_CHANGED",
  //
  //   SUPER_ADMIN_IMPERSONATE_STARTED — clinic-switcher cookie set with a
  //   reason + mode. `entityType: "ImpersonationGrant"`, `entityId:
  //   <grantId>`. `meta` carries `{ clinicId, mode, expiresAt, reason }`.
  //
  //   SUPER_ADMIN_IMPERSONATE_ENDED — admin clicked Exit. `entityType:
  //   "ImpersonationGrant"`. `meta` carries `{ clinicId, durationMs }`.
  //
  //   SUPER_ADMIN_IMPERSONATE_EXPIRED — middleware-side: a request landed
  //   under an expired cookie; we clear it. `entityType:
  //   "ImpersonationGrant"`. `meta` carries `{ clinicId, expiredAtMs }`.
  //
  //   SUPER_ADMIN_VIEW_AS_BLOCKED — write attempted under VIEW_ONLY. One
  //   row per blocked request (sampled by the API wrapper). `entityType:
  //   "ImpersonationGrant"`, `entityId: <grantId>`. `meta` carries
  //   `{ method, path, clinicId }`.
  SUPER_ADMIN_IMPERSONATE_STARTED: "SUPER_ADMIN_IMPERSONATE_STARTED",
  SUPER_ADMIN_IMPERSONATE_ENDED: "SUPER_ADMIN_IMPERSONATE_ENDED",
  SUPER_ADMIN_IMPERSONATE_EXPIRED: "SUPER_ADMIN_IMPERSONATE_EXPIRED",
  SUPER_ADMIN_VIEW_AS_BLOCKED: "SUPER_ADMIN_VIEW_AS_BLOCKED",
  //
  //   CLINIC_SUSPENDED / CLINIC_RESUMED / CLINIC_TRIAL_EXTENDED — bulk
  //   admin ops surfaced from /admin/clinics row context-menu. `entityType:
  //   "Subscription"`, `entityId: <subscriptionId>`. `meta` carries the
  //   relevant transition shape (oldStatus / newStatus / newTrialEndsAt).
  CLINIC_SUSPENDED: "CLINIC_SUSPENDED",
  CLINIC_RESUMED: "CLINIC_RESUMED",
  CLINIC_TRIAL_EXTENDED: "CLINIC_TRIAL_EXTENDED",

  // Patient duplicate merge. `entityType: "Patient"`, `entityId: <winnerId>`.
  // `meta` carries `{ loserId, loserSnapshot, reassigned: { table: count, … },
  // mergedFields: string[] }` — full forensic trail so the merge can be
  // reasoned about after the loser row is gone.
  PATIENT_MERGED: "PATIENT_MERGED",

  // Phase 20 Wave 5a — doctor surface reminders. `entityType: "Reminder"`,
  // `entityId: <reminderId>`. `meta` carries `{ doctorId, patientId,
  // appointmentId, remindAt }` (creates) or `{ oldStatus, newStatus }`
  // (transitions). Three explicit transitions because they each carry a
  // different intent: DONE = completed work, DISMISSED = won't do,
  // SNOOZED = postponed.
  REMINDER_CREATED: "REMINDER_CREATED",
  REMINDER_COMPLETED: "REMINDER_COMPLETED",
  REMINDER_DISMISSED: "REMINDER_DISMISSED",
  REMINDER_SNOOZED: "REMINDER_SNOOZED",

  // Phase 20 Wave 5a — incoming lab results. `entityType: "LabResult"`,
  // `entityId: <labResultId>`. CREATED is emitted on both manual entry
  // (POST /api/crm/doctors/me/labs) and future lab-system webhooks; meta
  // carries `{ doctorId, patientId, testName, flag }`. REVIEWED meta:
  // `{ doctorId, reviewedAt }`.
  LAB_RESULT_CREATED: "LAB_RESULT_CREATED",
  LAB_RESULT_REVIEWED: "LAB_RESULT_REVIEWED",

  // Phase 20 Wave 5b — doctor self-service settings. `entityType: "User"`
  // for profile/security mutations, `entityType: "Doctor"` for signature.
  // meta carries the patched fields (PROFILE_UPDATED, NOTIFICATION_PREFS)
  // or the new URL (SIGNATURE_SET).
  DOCTOR_PROFILE_UPDATED: "DOCTOR_PROFILE_UPDATED",
  DOCTOR_SIGNATURE_SET: "DOCTOR_SIGNATURE_SET",
  DOCTOR_SIGNATURE_REMOVED: "DOCTOR_SIGNATURE_REMOVED",
  DOCTOR_NOTIFICATION_PREFS_UPDATED: "DOCTOR_NOTIFICATION_PREFS_UPDATED",
} as const;

export type AuditActionKey = keyof typeof AUDIT_ACTION;
export type AuditActionValue = (typeof AUDIT_ACTION)[AuditActionKey];
