/**
 * Entry point for running BullMQ-style notification workers outside of the
 * Next.js HTTP server.
 *
 * Usage:
 *   npx tsx src/server/workers/start.ts
 *
 * Why a separate process?
 *   - Next.js dev (Turbopack) hot-reloads modules; setInterval timers
 *     leak across reloads which causes duplicate scheduler ticks.
 *   - Production workers belong in their own container so we can scale
 *     them independently (Phase 6 infra).
 *
 * What it does:
 *   1. Starts the in-memory queue adapter (swap to BullMQ when REDIS_URL
 *      is set — TODO for infrastructure-engineer).
 *   2. Registers the `notifications-send` worker.
 *   3. Starts the `notifications-scheduler` every minute.
 *   4. Logs + keeps the process alive.
 */
import { registerActionScheduler } from "@/server/actions/scheduler";
import { registerRevenueSchedulers } from "@/server/revenue/scheduler";
import { startTgPollingWorkers } from "@/server/telegram/poll";

import { startAnalyticsRefreshWorker } from "./analytics-refresh";
import { startAppointmentLifecycleSweepWorker } from "./appointment-lifecycle-sweep";
import { startDataExportWorker } from "./data-export";
import { startScheduledReportsWorker } from "./scheduled-reports";
import { registerDsarScheduler } from "./data-deletion";
import { startMedicationReminderWorker } from "./medication-reminder";
import { startNotificationsSendWorker } from "./notifications-send";
import { startNotificationsSchedulerWorker } from "./notifications-scheduler";
import { startOutboxPumperWorker } from "./outbox-pumper";
import { startPatientSummaryRefreshWorker } from "./patient-summary-refresh";
import { startPostVisitNpsWorker } from "./post-visit-nps";
import { startPreVisitQuestionnaireWorker } from "./pre-visit-questionnaire";
import { startTrialExpirySchedulerWorker } from "./trial-expiry-scheduler";
import { startVoiceSoapWorker } from "./voice-soap";

async function main() {
  console.info("[workers] starting…");
  startNotificationsSendWorker();
  const scheduler = startNotificationsSchedulerWorker(60_000);

  // Cross-surface sync Phase A.5 — drain EventOutbox to local bus + Redis.
  // 200ms poll keeps in-flight latency well under 1s; locks rows with
  // FOR UPDATE SKIP LOCKED so multiple worker replicas don't double-deliver.
  // See `docs/TZ-cross-surface-sync.md` §5.
  const outboxPumper = startOutboxPumperWorker(200);
  // Phase 9e — flip TRIAL→PAST_DUE for clinics whose 30-day trial elapsed.
  // Same 60s cadence as the notifications scheduler: cheap query, idempotent.
  const trialExpiry = startTrialExpirySchedulerWorker(60_000);

  // Appointment lifecycle sweep — auto-flip stale CONFIRMED/BOOKED/SKIPPED
  // rows to NO_SHOW once the scheduled end has passed by an hour. Definition
  // of "stale" is shared with the CRM table via `src/lib/appointments/overdue`.
  // 10-minute cadence: twice the UI grace, so a row is visibly "Просрочена"
  // for at least one tick before the worker can act.
  const lifecycleSweep = startAppointmentLifecycleSweepWorker(10 * 60_000);

  // Phase 13 Wave 2 — Action Center recompute every 15 minutes. Iterates
  // active clinics and fires the 10 detectors per clinic via runActionEngine.
  const actionEngine = registerActionScheduler();

  // Phase 15 Wave 2 — AI patient-summary refresh worker.
  // Single in-process worker that drains the in-memory `ai:patient-summary`
  // queue. Each job loads the patient + last 3 visits, calls `callLLM`, and
  // writes `Patient.summaryCache + summaryCacheUpdatedAt`, then publishes a
  // `patient.summary.refreshed` SSE event. Idempotent — a stale row that
  // gets multiple refresh requests within a few seconds settles on the last
  // write to land.
  startPatientSummaryRefreshWorker();

  // Phase 15 Wave 5 — Voice → SOAP worker.
  // Job pipeline: Whisper transcription → LLM SOAP structuring → write
  // `MedicalCase.soapDraft` + emit `case.soap-draft.refreshed`. Triggered
  // by the TG webhook when a doctor sends a voice/audio message.
  startVoiceSoapWorker();

  // Phase 16 Wave 2 — Patient Experience hourly engagement loops.
  //   pre-visit-questionnaire   24h-before push asking the patient to fill
  //                             the 4-field form (complaints/allergies/
  //                             medications/notes) in the Mini App. Stamps
  //                             Appointment.preVisitNotifiedAt to dedupe.
  //   post-visit-nps            +4h-after-COMPLETED push asking the patient
  //                             to leave a 1–10 NPS rating. Stamps
  //                             Appointment.npsRequestedAt to dedupe.
  const preVisit = startPreVisitQuestionnaireWorker();
  const postVisitNps = startPostVisitNpsWorker();

  // Phase 16 Wave 3 — Medication reminders.
  //   medication-reminder    hourly tick — for every ACTIVE Prescription
  //                          with remindersEnabled, fires when local-clock
  //                          hour matches an entry in `schedule.times[]`.
  //                          Inserts a `MedicationReminderSend` row + a
  //                          push (TG + parallel INAPP). Idempotent via
  //                          (prescriptionId, scheduledFor) unique key.
  const medicationReminder = startMedicationReminderWorker();

  // Phase 17 Wave 3 — DSAR (Data Subject Access Requests).
  //   dsar:export      drains export jobs (bundle PII → encrypt → MinIO →
  //                    deliver via TG bot). One worker per process; jobs
  //                    are enqueued from the Mini App / CRM API handlers.
  //   dsar:scheduler   hourly tick — execute APPROVED DataDeletionJobs
  //                    whose scheduledFor has passed (default 90 days
  //                    after request) and expire stale export bundles
  //                    (>30 days old).
  startDataExportWorker();
  const dsarScheduler = registerDsarScheduler();

  // Phase 18 Wave 1 — Analytics & Reporting foundation.
  //   analytics:refresh   hourly tick — REFRESH MATERIALIZED VIEW
  //                       CONCURRENTLY for the four analytics MVs
  //                       (mv_doctor_performance, mv_cohort_retention,
  //                       mv_financial_pace, mv_schedule_heatmap). Kicks
  //                       off an initial refresh on boot (async, doesn't
  //                       block other workers from registering). Manual
  //                       refresh available via /api/crm/analytics/refresh.
  const analyticsRefresh = startAnalyticsRefreshWorker();

  // Phase 18 Wave 4 — Scheduled-report delivery cron.
  //   analytics:scheduled-reports  every 5 minutes — pick due schedules,
  //                                run the saved report, render to PDF/CSV,
  //                                deliver via EMAIL or TELEGRAM. After 3
  //                                consecutive failures the row is auto-
  //                                disabled and the audit log records it.
  const scheduledReports = startScheduledReportsWorker();

  // Phase 14 Wave 2 — Revenue Engines.
  //   revenue-snapshot     ~02:00 local — snapshot yesterday's empty slots
  //                        per clinic into EmptySlotSnapshot.
  //   reactivation         ~07:00 local — enqueue reactivation sends for
  //                        dormant patients (>=90 days, once per quarter).
  const revenue = registerRevenueSchedulers();

  // Phase 3c — Telegram long-poll worker.
  // Webhook delivery from TG to RU VPS times out (Amsterdam→RU edge blocked),
  // so we pull updates ourselves and re-POST them to the local webhook route.
  // This also keeps the worker process alive (continuous network I/O), which
  // the unref'd schedulers above could not on their own.
  await startTgPollingWorkers();

  const shutdown = (signal: NodeJS.Signals) => {
    console.info(`[workers] received ${signal} — shutting down`);
    scheduler.stop();
    outboxPumper.stop();
    trialExpiry.stop();
    lifecycleSweep.stop();
    actionEngine.stop();
    revenue.stop();
    preVisit.stop();
    postVisitNps.stop();
    medicationReminder.stop();
    dsarScheduler.stop();
    analyticsRefresh.stop();
    scheduledReports.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.info("[workers] ready");
}

void main();
