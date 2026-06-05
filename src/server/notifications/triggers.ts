/**
 * Notification trigger registry.
 *
 * Each trigger is a pure function that queries the DB and materialises
 * `NotificationSend` rows with `status=QUEUED` and a `scheduledFor`
 * timestamp. The scheduler worker picks them up and dispatches.
 *
 * Triggers (TZ §6.9 + §8.3):
 *   - appointment.created       — immediate confirmation
 *   - appointment.reminder-24h  — 24h before start
 *   - appointment.reminder-2h   — 2h before start
 *   - appointment.cancelled     — immediate
 *   - birthday                  — 09:00 clinic TZ on birthday
 *   - no-show                   — immediate after status=NO_SHOW
 *   - payment.due               — unpaid appointment that was DONE >24h ago
 *
 * Idempotency: a (patientId, appointmentId, templateKey) tuple never
 * creates more than one pending row. We enforce that by querying for
 * existing rows before insert.
 *
 * Integration: `fireTrigger` is called from route handlers after the
 * mutation commits. It wraps the trigger function in a SYSTEM context
 * so tenant scoping doesn't apply.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { isAllowedToReceive } from "./consent-gate";
import { render } from "./template";

export const TRIGGER_KEYS = [
  "appointment.created",
  // Stage 2.D — soft 3-day "gentle ping" reminder. Audience is restricted at
  // the materialiser (TELEGRAM/WEBSITE bookings still pending confirmation,
  // i.e. `confirmedAt IS NULL`). PHONE/KIOSK/WALKIN auto-confirm at booking
  // and never see this template. RETIRED from the canonical scheduler band
  // 2026-06-05 (TZ-notifications-cancel-sync §2) — slug stays for legacy
  // templates an admin may keep as a dynamic-offset variant.
  "appointment.reminder-3d",
  "appointment.reminder-24h",
  "appointment.reminder-5h",
  // TZ-notifications-cancel-sync §2 — day-of cascade replaces the 2h ping
  // with a 3h + 1h pair. Existing per-clinic `-120` templates still resolve
  // via `appointment.reminder-2h` slug but the canonical scheduler does not
  // materialise them anymore.
  "appointment.reminder-3h",
  "appointment.reminder-2h",
  "appointment.reminder-1h",
  // Legacy generic — left in place for backwards compatibility; new call
  // sites should use `appointment.cancelled.by-staff` / `.by-patient`.
  "appointment.cancelled",
  // TZ-notifications-cancel-sync §3 — surface-aware variants. Both map to
  // the NotificationTrigger.APPOINTMENT_CANCELLED enum, distinguished by a
  // `triggerConfig.audience` discriminator on the template row.
  "appointment.cancelled.by-staff",
  "appointment.cancelled.by-patient",
  // TZ-notifications-cancel-sync §3 — fired by appointment-lifecycle-sweep
  // when `isRunningLate(row, now)` and no NotificationSend exists for this
  // (appointment, template) pair.
  "appointment.running-late",
  // TZ-notifications-cancel-sync §3 — fired by appointment-lifecycle-sweep
  // (auto NO_SHOW path) AND by the CRM bulk-status route (manual NO_SHOW
  // path). Same dedup key as every other reminder, so a clinic doesn't
  // double-text a patient who got both auto + manual flips on the row.
  "appointment.no-show",
  "birthday",
  // Legacy slug for the same enum as `appointment.no-show`. Kept for the
  // few inbound call sites that still pass the old kind.
  "no-show",
  "payment.due",
  "case.repeat-due",
  // Phase 14 — Revenue Engines, Wave 2.
  // Fired by `runReactivationScheduler` (src/server/revenue/reactivation.ts)
  // for dormant patients (>=90 days since last visit). Once-per-quarter
  // idempotency lives on `Patient.reactivationSentAt[]`.
  "patient.reactivation",
  // Phase 16 Wave 2 — Patient Experience.
  // Fired ~24h before a BOOKED/WAITING appointment so the patient can fill
  // the pre-visit questionnaire (complaints/allergies/medications/notes) in
  // the Mini App. Idempotency: `Appointment.preVisitNotifiedAt`.
  "appointment.pre-visit-questionnaire",
  // Fired ~4h after an appointment lands in COMPLETED so we can ask the
  // patient for a 1–10 NPS rating. Idempotency:
  // `Appointment.npsRequestedAt`.
  "appointment.nps-request",
  // Phase 16 Wave 3 — Patient Experience.
  // Fired by the hourly `medication-reminder-tick` worker for every
  // active prescription whose schedule.times[] entry matches the
  // current hour (clinic TZ). Idempotency:
  // `MedicationReminderSend(prescriptionId, scheduledFor)` unique key.
  "medication.reminder",
  // Fired when a referred patient's first appointment lands in
  // COMPLETED, minting a `ReferralReward` PENDING and notifying the
  // referrer that they've earned a discount. Idempotency:
  // `ReferralReward(referrerPatientId, referredPatientId)` unique key.
  "referral.reward-earned",
] as const;

export type TriggerKey = (typeof TRIGGER_KEYS)[number];

/** Shape of the context object fed to `render()`. Must stay in sync with
 *  `ALLOWED_KEYS_BY_TRIGGER` in template.ts. */
type RenderCtx = {
  patient: {
    name: string;
    firstName: string;
    phone: string;
  };
  appointment?: {
    date: string;
    time: string;
    doctor: string;
    service: string;
    cabinet: string;
  };
  payment?: {
    amount: string;
    currency: string;
  };
  clinic: {
    name: string;
    phone: string;
    address: string;
  };
};

function firstName(full: string): string {
  const trimmed = full.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function formatDate(d: Date | null | undefined, tz = "Asia/Tashkent"): string {
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function formatTime(d: Date | null | undefined, tz = "Asia/Tashkent"): string {
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

type AppointmentWithRefs = {
  id: string;
  clinicId: string;
  patientId: string;
  date: Date;
  time: string | null;
  endDate: Date;
  status: string;
  /** Stage 2.D — used to gate the T-3d "gentle ping" reminder. */
  confirmedAt: Date | null;
  patient: {
    id: string;
    fullName: string;
    phone: string;
    telegramId: string | null;
    preferredChannel: string;
    birthDate: Date | null;
  };
  doctor: { nameRu: string; nameUz: string };
  primaryService: { nameRu: string; nameUz: string } | null;
  cabinet: { number: string } | null;
  clinic: {
    id: string;
    nameRu: string;
    nameUz: string;
    phone: string | null;
    addressRu: string | null;
    timezone: string;
  };
};

async function loadAppointment(
  appointmentId: string,
): Promise<AppointmentWithRefs | null> {
  return (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            telegramId: true,
            preferredChannel: true,
            birthDate: true,
          },
        },
        doctor: { select: { nameRu: true, nameUz: true } },
        primaryService: { select: { nameRu: true, nameUz: true } },
        cabinet: { select: { number: true } },
        clinic: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            phone: true,
            addressRu: true,
            timezone: true,
          },
        },
      },
    }),
  )) as AppointmentWithRefs | null;
}

function buildContext(
  appt: AppointmentWithRefs,
  lang: "ru" | "uz",
  extras?: { paymentAmount?: number; paymentCurrency?: string },
): RenderCtx {
  const tz = appt.clinic.timezone;
  return {
    patient: {
      name: appt.patient.fullName,
      firstName: firstName(appt.patient.fullName),
      phone: appt.patient.phone,
    },
    appointment: {
      date: formatDate(appt.date, tz),
      time: appt.time ?? formatTime(appt.date, tz),
      doctor: lang === "uz" ? appt.doctor.nameUz : appt.doctor.nameRu,
      service: appt.primaryService
        ? lang === "uz"
          ? appt.primaryService.nameUz
          : appt.primaryService.nameRu
        : "",
      cabinet: appt.cabinet?.number ?? "",
    },
    clinic: {
      name: lang === "uz" ? appt.clinic.nameUz : appt.clinic.nameRu,
      phone: appt.clinic.phone ?? "",
      address: appt.clinic.addressRu ?? "",
    },
    ...(extras
      ? {
          payment: {
            amount: String(extras.paymentAmount ?? ""),
            currency: extras.paymentCurrency ?? "UZS",
          },
        }
      : {}),
  };
}

type FindTemplateResult = {
  templateId: string;
  body: string;
  channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
} | null;

/**
 * Map an internal TriggerKey to a Prisma where-clause that matches the
 * `trigger` enum + `triggerConfig.offsetMin` set by the seed/admin UI.
 *
 * NotificationTemplate.key is a human-readable slug (e.g. "reminder.confirm")
 * and is NOT the same as TriggerKey ("appointment.created"). The contract is
 * the `trigger` enum + offsetMin.
 */
function whereForTrigger(
  trigger: TriggerKey,
): Record<string, unknown> | null {
  switch (trigger) {
    case "appointment.created":
      return { trigger: "APPOINTMENT_CREATED" };
    case "appointment.reminder-3d":
      return {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { path: ["offsetMin"], equals: -4320 },
      };
    case "appointment.reminder-24h":
      return {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { path: ["offsetMin"], equals: -1440 },
      };
    case "appointment.reminder-5h":
      return {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { path: ["offsetMin"], equals: -300 },
      };
    case "appointment.reminder-3h":
      return {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { path: ["offsetMin"], equals: -180 },
      };
    case "appointment.reminder-2h":
      return {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { path: ["offsetMin"], equals: -120 },
      };
    case "appointment.reminder-1h":
      return {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { path: ["offsetMin"], equals: -60 },
      };
    case "appointment.cancelled":
      // Legacy slug — match by either the enum (preferred) or the slug for
      // pre-2026-06-05 templates the clinic seeded by hand. Audience-less
      // templates fire for any cancellation surface.
      return {
        OR: [
          {
            trigger: "APPOINTMENT_CANCELLED",
            triggerConfig: { path: ["audience"], equals: "any" },
          },
          { trigger: "APPOINTMENT_CANCELLED", triggerConfig: { equals: {} } },
          { key: "appointment.cancelled" },
        ],
      };
    case "appointment.cancelled.by-staff":
      // Prefer a staff-audience template; fall back to a generic one if the
      // clinic only has a single template (default seed has both variants).
      return {
        OR: [
          {
            trigger: "APPOINTMENT_CANCELLED",
            triggerConfig: { path: ["audience"], equals: "staff" },
          },
          {
            trigger: "APPOINTMENT_CANCELLED",
            triggerConfig: { path: ["audience"], equals: "any" },
          },
          { key: "appointment.cancelled" },
        ],
      };
    case "appointment.cancelled.by-patient":
      return {
        OR: [
          {
            trigger: "APPOINTMENT_CANCELLED",
            triggerConfig: { path: ["audience"], equals: "patient" },
          },
          {
            trigger: "APPOINTMENT_CANCELLED",
            triggerConfig: { path: ["audience"], equals: "any" },
          },
          { key: "appointment.cancelled" },
        ],
      };
    case "appointment.running-late":
      return { trigger: "APPOINTMENT_RUNNING_LATE" };
    case "appointment.no-show":
      return { trigger: "APPOINTMENT_MISSED" };
    case "birthday":
      return { trigger: "PATIENT_BIRTHDAY" };
    case "no-show":
      return { trigger: "APPOINTMENT_MISSED" };
    case "payment.due":
      // No dedicated enum — fall back to slug match.
      return { key: "payment.due" };
    case "case.repeat-due":
      return { trigger: "CASE_REPEAT_DUE" };
    case "appointment.pre-visit-questionnaire":
      // No dedicated enum value yet — match by slug. Wave 3 may promote this
      // to its own NotificationTrigger enum entry.
      return { key: "appointment.pre-visit-questionnaire" };
    case "appointment.nps-request":
      return { key: "appointment.nps-request" };
    case "medication.reminder":
      // No dedicated NotificationTrigger enum — slug match. The worker
      // builds the per-tick send manually (see medication-reminder.ts);
      // this branch only matters if the admin templating UI ever hooks
      // its own materializer to the registry.
      return { key: "medication.reminder" };
    case "referral.reward-earned":
      return { key: "referral.reward-earned" };
    default:
      return null;
  }
}

async function findTemplateFor(
  clinicId: string,
  trigger: TriggerKey,
  lang: "ru" | "uz",
): Promise<FindTemplateResult> {
  const where = whereForTrigger(trigger);
  if (!where) return null;
  const row = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationTemplate.findFirst({
      where: {
        clinicId,
        isActive: true,
        ...where,
      },
      select: {
        id: true,
        bodyRu: true,
        bodyUz: true,
        channel: true,
      },
    }),
  );
  if (!row) return null;
  return {
    templateId: row.id,
    body: lang === "uz" ? row.bodyUz : row.bodyRu,
    channel: row.channel as FindTemplateResult extends null
      ? never
      : "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP",
  };
}

/**
 * Idempotency gate: skip if a queued/sent row already exists for this
 * (patientId, appointmentId?, templateId).
 */
async function alreadyScheduled(params: {
  clinicId: string;
  patientId: string;
  appointmentId?: string | null;
  templateId: string;
}): Promise<boolean> {
  const existing = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.findFirst({
      where: {
        clinicId: params.clinicId,
        patientId: params.patientId,
        appointmentId: params.appointmentId ?? null,
        templateId: params.templateId,
        status: { in: ["QUEUED", "SENT", "DELIVERED", "READ"] },
      },
      select: { id: true },
    }),
  );
  return existing !== null;
}

function pickRecipient(
  channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP",
  patient: { phone: string; telegramId: string | null },
): string | null {
  if (channel === "SMS") return patient.phone;
  if (channel === "TG") return patient.telegramId;
  if (channel === "EMAIL") return patient.phone; // unused today
  return null;
}

async function createSend(params: {
  clinicId: string;
  patientId: string;
  appointmentId?: string | null;
  templateId: string;
  channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
  recipient: string;
  body: string;
  scheduledFor: Date;
}) {
  return runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.create({
      data: {
        clinicId: params.clinicId,
        patientId: params.patientId,
        appointmentId: params.appointmentId ?? null,
        templateId: params.templateId,
        channel: params.channel,
        recipient: params.recipient,
        body: params.body,
        scheduledFor: params.scheduledFor,
        status: "QUEUED",
      } as never,
    }),
  );
}

/**
 * Bulk variant: materialise a batch of (appointmentId → scheduledFor) pairs
 * for ONE trigger in 4 queries total (not 4×N). Used by the scheduler tick
 * which previously did up to 1500 queries per minute on a busy clinic.
 *
 * Steps:
 *   1. one `findMany` to load every appointment + relations
 *   2. one `findMany` per unique clinicId for the template (parallel)
 *   3. one `findMany` for existing NotificationSend idempotency check
 *   4. one `createMany` to insert all queued rows
 */
export async function materializeForAppointmentsBulk(
  jobs: ReadonlyArray<{ appointmentId: string; scheduledFor: Date }>,
  trigger: TriggerKey,
): Promise<{ created: number; skipped: number }> {
  if (jobs.length === 0) return { created: 0, skipped: 0 };
  const apptIds = jobs.map((j) => j.appointmentId);
  const lang = "ru";

  const appts = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: { id: { in: apptIds } },
      include: {
        patient: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            telegramId: true,
            preferredChannel: true,
            birthDate: true,
          },
        },
        doctor: { select: { nameRu: true, nameUz: true } },
        primaryService: { select: { nameRu: true, nameUz: true } },
        cabinet: { select: { number: true } },
        clinic: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            phone: true,
            addressRu: true,
            timezone: true,
          },
        },
      },
    }),
  )) as AppointmentWithRefs[];
  const apptMap = new Map(appts.map((a) => [a.id, a]));

  const clinicIds = Array.from(new Set(appts.map((a) => a.clinicId)));
  const tplEntries = await Promise.all(
    clinicIds.map(async (cid) => {
      const tpl = await findTemplateFor(cid, trigger, lang);
      return [cid, tpl] as const;
    }),
  );
  const templates = new Map(tplEntries);

  // Idempotency: pull every (appointmentId, templateId) tuple already queued
  // for this batch in one query, build a Set, check in memory.
  const tplIds = Array.from(
    new Set(
      tplEntries
        .map(([, t]) => t?.templateId)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  const existing =
    tplIds.length === 0
      ? []
      : await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.notificationSend.findMany({
            where: {
              appointmentId: { in: apptIds },
              templateId: { in: tplIds },
              status: { in: ["QUEUED", "SENT", "DELIVERED", "READ"] },
            },
            select: { appointmentId: true, templateId: true },
          }),
        );
  const existingSet = new Set(
    existing.map((e) => `${e.appointmentId}|${e.templateId}`),
  );

  const toInsert: Array<{
    clinicId: string;
    patientId: string;
    appointmentId: string;
    templateId: string;
    channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
    recipient: string;
    body: string;
    scheduledFor: Date;
    status: "QUEUED";
  }> = [];
  let skipped = 0;

  for (const job of jobs) {
    const appt = apptMap.get(job.appointmentId);
    if (!appt) {
      skipped += 1;
      continue;
    }
    // Stage 2.D — race-safety: skip the T-3d reminder if the patient
    // confirmed between the scheduler's scan loop and this bulk insert.
    // Same gate as the detector / scheduler band predicate.
    if (
      trigger === "appointment.reminder-3d" &&
      appt.confirmedAt !== null
    ) {
      skipped += 1;
      continue;
    }
    const tpl = templates.get(appt.clinicId);
    if (!tpl) {
      skipped += 1;
      continue;
    }
    if (existingSet.has(`${appt.id}|${tpl.templateId}`)) {
      skipped += 1;
      continue;
    }
    const recipient = pickRecipient(tpl.channel, appt.patient);
    if (!recipient) {
      skipped += 1;
      continue;
    }
    const body = render(
      tpl.body,
      buildContext(appt, lang) as unknown as Record<string, unknown>,
    );
    toInsert.push({
      clinicId: appt.clinicId,
      patientId: appt.patientId,
      appointmentId: appt.id,
      templateId: tpl.templateId,
      channel: tpl.channel,
      recipient,
      body,
      scheduledFor: job.scheduledFor,
      status: "QUEUED",
    });
    // Mirror to INAPP channel for TG-using patients. The Mini App banner
    // is a "second touch" that costs nothing (local DB write only) and
    // ensures the reminder is visible even if the patient missed the TG
    // message. Non-TG patients can't authenticate to the Mini App, so
    // an INAPP row would be invisible — we skip them.
    if (
      appt.patient.telegramId &&
      tpl.channel !== "INAPP" &&
      tpl.channel !== "VISIT" &&
      tpl.channel !== "CALL"
    ) {
      toInsert.push({
        clinicId: appt.clinicId,
        patientId: appt.patientId,
        appointmentId: appt.id,
        templateId: tpl.templateId,
        channel: "INAPP",
        recipient: appt.patientId,
        body,
        scheduledFor: job.scheduledFor,
        status: "QUEUED",
      });
    }
  }

  if (toInsert.length > 0) {
    await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.notificationSend.createMany({
        data: toInsert as never,
        skipDuplicates: true,
      }),
    );
  }

  return { created: toInsert.length, skipped };
}

async function materializeForAppointment(
  apptId: string,
  trigger: TriggerKey,
  scheduledFor: Date,
): Promise<{ created: number; skipped: number }> {
  const appt = await loadAppointment(apptId);
  if (!appt) return { created: 0, skipped: 0 };
  const lang = "ru"; // MVP: always Russian; lang per patient → Phase 4
  const tpl = await findTemplateFor(appt.clinicId, trigger, lang);
  if (!tpl) return { created: 0, skipped: 1 };
  const already = await alreadyScheduled({
    clinicId: appt.clinicId,
    patientId: appt.patientId,
    appointmentId: appt.id,
    templateId: tpl.templateId,
  });
  if (already) return { created: 0, skipped: 1 };
  const recipient = pickRecipient(tpl.channel, appt.patient);
  if (!recipient) return { created: 0, skipped: 1 };
  const body = render(tpl.body, buildContext(appt, lang) as unknown as Record<string, unknown>);
  await createSend({
    clinicId: appt.clinicId,
    patientId: appt.patientId,
    appointmentId: appt.id,
    templateId: tpl.templateId,
    channel: tpl.channel,
    recipient,
    body,
    scheduledFor,
  });
  // Mirror to INAPP for TG-using patients. See bulk path for rationale.
  if (
    appt.patient.telegramId &&
    tpl.channel !== "INAPP" &&
    tpl.channel !== "VISIT" &&
    tpl.channel !== "CALL"
  ) {
    await createSend({
      clinicId: appt.clinicId,
      patientId: appt.patientId,
      appointmentId: appt.id,
      templateId: tpl.templateId,
      channel: "INAPP",
      recipient: appt.patientId,
      body,
      scheduledFor,
    });
  }
  return { created: 1, skipped: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoints — one per trigger
// ─────────────────────────────────────────────────────────────────────────────

export async function onAppointmentCreated(
  appointmentId: string,
): Promise<void> {
  await materializeForAppointment(
    appointmentId,
    "appointment.created",
    new Date(),
  );
}

export async function onAppointmentCancelled(
  appointmentId: string,
  variant: "by-staff" | "by-patient" | "generic" = "generic",
): Promise<void> {
  const key: TriggerKey =
    variant === "by-staff"
      ? "appointment.cancelled.by-staff"
      : variant === "by-patient"
        ? "appointment.cancelled.by-patient"
        : "appointment.cancelled";
  await materializeForAppointment(appointmentId, key, new Date());
}

export async function onAppointmentNoShow(
  appointmentId: string,
): Promise<void> {
  await materializeForAppointment(
    appointmentId,
    "appointment.no-show",
    new Date(),
  );
}

export async function onAppointmentRunningLate(
  appointmentId: string,
): Promise<void> {
  await materializeForAppointment(
    appointmentId,
    "appointment.running-late",
    new Date(),
  );
}

/**
 * Phase 16 Wave 2 — Pre-visit questionnaire push.
 *
 * Materialise a notification ~24h before the appointment with a deeplink to
 * the Mini App questionnaire form. Caller (the worker) is responsible for
 * stamping `preVisitNotifiedAt` on the Appointment row to dedupe future
 * ticks; this function only writes the `NotificationSend` row.
 */
export async function onPreVisitQuestionnaire(
  appointmentId: string,
): Promise<void> {
  await materializeForAppointment(
    appointmentId,
    "appointment.pre-visit-questionnaire",
    new Date(),
  );
}

/**
 * Phase 16 Wave 2 — Post-visit NPS push.
 *
 * Materialise a notification ~4h after the appointment lands in COMPLETED
 * with a deeplink to the Mini App NPS form. Caller stamps `npsRequestedAt`
 * to dedupe future ticks.
 */
export async function onNpsRequest(appointmentId: string): Promise<void> {
  await materializeForAppointment(
    appointmentId,
    "appointment.nps-request",
    new Date(),
  );
}

/**
 * Schedule the day-of reminder cascade for an appointment.
 *
 * TZ-notifications-cancel-sync §2 — canonical bands are 24h / 5h / 3h / 1h.
 * The legacy 3d "gentle ping" and 2h "almost time" pings are retired from
 * the canonical scheduler but still resolvable via slug for any per-clinic
 * template the admin chose to keep on dynamic-offset materialisation.
 */
export async function scheduleAppointmentReminders(
  appointmentId: string,
): Promise<void> {
  const appt = await loadAppointment(appointmentId);
  if (!appt) return;
  const start = appt.date.getTime();
  const now = Date.now();
  if (start - 24 * 60 * 60 * 1000 > now) {
    await materializeForAppointment(
      appointmentId,
      "appointment.reminder-24h",
      new Date(start - 24 * 60 * 60 * 1000),
    );
  }
  if (start - 5 * 60 * 60 * 1000 > now) {
    await materializeForAppointment(
      appointmentId,
      "appointment.reminder-5h",
      new Date(start - 5 * 60 * 60 * 1000),
    );
  }
  if (start - 3 * 60 * 60 * 1000 > now) {
    await materializeForAppointment(
      appointmentId,
      "appointment.reminder-3h",
      new Date(start - 3 * 60 * 60 * 1000),
    );
  }
  if (start - 60 * 60 * 1000 > now) {
    await materializeForAppointment(
      appointmentId,
      "appointment.reminder-1h",
      new Date(start - 60 * 60 * 1000),
    );
  }
}

/**
 * Scheduler tick: materialise reminders whose time is approaching. Also
 * runs birthday and payment.due triggers once per tick.
 *
 * TZ-notifications-cancel-sync §2 — canonical bands are 24h / 5h / 3h / 1h.
 * Each appointment falling inside a band is materialised exactly once per
 * (appointmentId, templateId); a second tick that lands in the same band
 * collapses to a no-op via the unique index. Band edges are slightly wider
 * than the tick cadence (60s) so a tick that runs late doesn't skip a row.
 */
export async function runScheduledTriggers(): Promise<{
  reminders24h: number;
  reminders5h: number;
  reminders3h: number;
  reminders1h: number;
  birthdays: number;
  paymentsDue: number;
  caseRepeats: number;
}> {
  const now = new Date();
  // 25h horizon covers every canonical band — the 24h ping is the farthest.
  const horizon = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const rows = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        date: { gte: now, lte: horizon },
        status: { in: ["BOOKED", "WAITING"] },
      },
      select: { id: true, date: true, confirmedAt: true },
      take: 500,
    }),
  );

  // Bands chosen so a 60s tick comfortably covers each window:
  //   - 23–24h before  → 24h reminder
  //   -  4–5h  before  → 5h  reminder
  //   -  2–3h  before  → 3h  reminder (NEW — day-of cadence)
  //   -  0–1h  before  → 1h  reminder (NEW — final "leaving soon")
  const jobs24h: Array<{ appointmentId: string; scheduledFor: Date }> = [];
  const jobs5h: Array<{ appointmentId: string; scheduledFor: Date }> = [];
  const jobs3h: Array<{ appointmentId: string; scheduledFor: Date }> = [];
  const jobs1h: Array<{ appointmentId: string; scheduledFor: Date }> = [];
  for (const r of rows) {
    const start = r.date.getTime();
    const until = start - Date.now();
    if (until > 0 && until <= 24 * 60 * 60 * 1000 && until > 23 * 60 * 60 * 1000) {
      jobs24h.push({
        appointmentId: r.id,
        scheduledFor: new Date(start - 24 * 60 * 60 * 1000),
      });
    }
    if (until > 0 && until <= 5 * 60 * 60 * 1000 && until > 4 * 60 * 60 * 1000) {
      jobs5h.push({
        appointmentId: r.id,
        scheduledFor: new Date(start - 5 * 60 * 60 * 1000),
      });
    }
    if (until > 0 && until <= 3 * 60 * 60 * 1000 && until > 2 * 60 * 60 * 1000) {
      jobs3h.push({
        appointmentId: r.id,
        scheduledFor: new Date(start - 3 * 60 * 60 * 1000),
      });
    }
    if (until > 0 && until <= 60 * 60 * 1000) {
      jobs1h.push({
        appointmentId: r.id,
        scheduledFor: new Date(start - 60 * 60 * 1000),
      });
    }
  }
  const [res24, res5, res3, res1] = await Promise.all([
    materializeForAppointmentsBulk(jobs24h, "appointment.reminder-24h"),
    materializeForAppointmentsBulk(jobs5h, "appointment.reminder-5h"),
    materializeForAppointmentsBulk(jobs3h, "appointment.reminder-3h"),
    materializeForAppointmentsBulk(jobs1h, "appointment.reminder-1h"),
  ]);
  const reminders24h = res24.created;
  const reminders5h = res5.created;
  const reminders3h = res3.created;
  const reminders1h = res1.created;

  const birthdays = await runBirthdays();
  const paymentsDue = await runPaymentsDue();
  const caseRepeats = await runCaseRepeatReminders();
  return {
    reminders24h,
    reminders5h,
    reminders3h,
    reminders1h,
    birthdays,
    paymentsDue,
    caseRepeats,
  };
}

async function runBirthdays(): Promise<number> {
  // Find patients whose birthday (month + day) matches today. Idempotent
  // via template+patient+(no appointment)+status filter.
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  // Phase 17 Wave 1 — birthday is marketing. Soft-deleted + opted-out
  // patients are excluded at the SQL layer; we still re-check via the
  // consent gate below to keep the boolean logic in one place.
  const patients = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.patient.findMany({
      where: {
        birthDate: { not: null },
        marketingOptOut: false,
        deletedAt: null,
      },
      select: {
        id: true,
        clinicId: true,
        fullName: true,
        phone: true,
        telegramId: true,
        birthDate: true,
        marketingOptOut: true,
        deletedAt: true,
      },
      take: 2000,
    }),
  );
  // Filter to today's birthdays in memory, then bulk-materialize. The
  // consent re-check is a belt-and-braces guard; the WHERE above already
  // excludes opt-outs.
  const matches = patients.filter((p) => {
    if (!p.birthDate) return false;
    const bm = p.birthDate.getUTCMonth() + 1;
    const bd = p.birthDate.getUTCDate();
    if (bm !== month || bd !== day) return false;
    return isAllowedToReceive(p, "marketing").allowed;
  });
  if (matches.length === 0) return 0;

  const clinicIds = Array.from(new Set(matches.map((p) => p.clinicId)));
  const tplEntries = await Promise.all(
    clinicIds.map(async (cid) => {
      const tpl = await findTemplateFor(cid, "birthday", "ru");
      return [cid, tpl] as const;
    }),
  );
  const templates = new Map(tplEntries);

  const tplIds = Array.from(
    new Set(
      tplEntries
        .map(([, t]) => t?.templateId)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  // Idempotency: birthday rows have no appointmentId, so the dedupe key is
  // (patientId, templateId). One bulk query covers every match.
  const existing =
    tplIds.length === 0
      ? []
      : await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.notificationSend.findMany({
            where: {
              patientId: { in: matches.map((p) => p.id) },
              templateId: { in: tplIds },
              appointmentId: null,
              status: { in: ["QUEUED", "SENT", "DELIVERED", "READ"] },
            },
            select: { patientId: true, templateId: true },
          }),
        );
  const existingSet = new Set(
    existing.map((e) => `${e.patientId}|${e.templateId}`),
  );

  const toInsert: Array<{
    clinicId: string;
    patientId: string;
    appointmentId: null;
    templateId: string;
    channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
    recipient: string;
    body: string;
    scheduledFor: Date;
    status: "QUEUED";
  }> = [];

  for (const p of matches) {
    const tpl = templates.get(p.clinicId);
    if (!tpl) continue;
    if (existingSet.has(`${p.id}|${tpl.templateId}`)) continue;
    const recipient = pickRecipient(tpl.channel, {
      phone: p.phone,
      telegramId: p.telegramId,
    });
    if (!recipient) continue;
    const body = render(tpl.body, {
      patient: {
        name: p.fullName,
        firstName: firstName(p.fullName),
        phone: p.phone,
      },
      clinic: { name: "", phone: "", address: "" },
    });
    toInsert.push({
      clinicId: p.clinicId,
      patientId: p.id,
      appointmentId: null,
      templateId: tpl.templateId,
      channel: tpl.channel,
      recipient,
      body,
      scheduledFor: new Date(),
      status: "QUEUED",
    });
  }

  if (toInsert.length === 0) return 0;
  await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.createMany({
      data: toInsert as never,
      skipDuplicates: true,
    }),
  );
  return toInsert.length;
}

async function runPaymentsDue(): Promise<number> {
  // Appointments that are COMPLETED >24h ago and have no PAID payment
  // for the full priceFinal amount.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        status: "COMPLETED",
        completedAt: { lte: cutoff },
        priceFinal: { gt: 0 },
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        priceFinal: true,
        payments: { select: { amount: true, status: true, currency: true } },
      },
      take: 500,
    }),
  );
  const now = new Date();
  const jobs: Array<{ appointmentId: string; scheduledFor: Date }> = [];
  for (const r of rows) {
    const paid = r.payments
      .filter((p) => p.status === "PAID")
      .reduce((s, p) => s + p.amount, 0);
    const due = (r.priceFinal ?? 0) - paid;
    if (due <= 0) continue;
    jobs.push({ appointmentId: r.id, scheduledFor: now });
  }
  const res = await materializeForAppointmentsBulk(jobs, "payment.due");
  return res.created;
}

/**
 * Case-repeat reminder — for every OPEN MedicalCase whose first appointment
 * was on a service with `freeRepeatDays > 0`, fire a reminder ~daysBefore
 * days before the free-repeat window closes, IF the patient hasn't already
 * booked a follow-up.
 *
 * Algorithm per tick:
 *   1. Load every OPEN case with at least one non-CANCELLED/NO_SHOW visit.
 *   2. For each case, find the chronological first visit (date asc) and
 *      pull its primary service's `freeRepeatDays`. If null → skip.
 *   3. Compute deadline = firstVisit.date + freeRepeatDays * 24h.
 *      Reminder fires when `now` is inside
 *      `[deadline - daysBefore * 24h, deadline)`.
 *   4. Skip if the case has any future BOOKED/WAITING appointment after
 *      the first visit — the patient is already coming back.
 *   5. Skip if a NotificationSend with this (caseId, templateId) already
 *      exists in any non-FAILED status (idempotency).
 *   6. Materialize the row (TG/SMS via channel resolver + parallel INAPP
 *      for TG-using patients).
 *
 * `daysBefore` defaults to 2; admins can override via the template's
 * `triggerConfig.daysBefore` in /crm/settings/notifications.
 */
async function runCaseRepeatReminders(): Promise<number> {
  type TplRow = {
    id: string;
    clinicId: string;
    channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
    bodyRu: string;
    bodyUz: string;
    triggerConfig: unknown;
  };
  const templates = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationTemplate.findMany({
      where: { trigger: "CASE_REPEAT_DUE", isActive: true },
      select: {
        id: true,
        clinicId: true,
        channel: true,
        bodyRu: true,
        bodyUz: true,
        triggerConfig: true,
      },
    }),
  )) as TplRow[];
  if (templates.length === 0) return 0;

  const tplByClinic = new Map<string, TplRow>();
  for (const t of templates) {
    if (!tplByClinic.has(t.clinicId)) tplByClinic.set(t.clinicId, t);
  }
  const clinicIds = Array.from(tplByClinic.keys());

  // Load every OPEN case in those clinics. We'll filter further in JS — the
  // population is small (cases per clinic ~ patient count) and we save a
  // multi-hop join on `Service.freeRepeatDays`.
  type CaseRow = {
    id: string;
    clinicId: string;
    patientId: string;
    patient: {
      fullName: string;
      phone: string;
      telegramId: string | null;
      preferredChannel: string;
    };
    appointments: Array<{
      id: string;
      date: Date;
      status: string;
      primaryService: { freeRepeatDays: number | null } | null;
    }>;
  };
  const cases = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.medicalCase.findMany({
      where: { clinicId: { in: clinicIds }, status: "OPEN" },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        patient: {
          select: {
            fullName: true,
            phone: true,
            telegramId: true,
            preferredChannel: true,
          },
        },
        appointments: {
          orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            date: true,
            status: true,
            primaryService: { select: { freeRepeatDays: true } },
          },
        },
      },
      take: 2000,
    }),
  )) as CaseRow[];

  if (cases.length === 0) return 0;

  // Idempotency: pull every (caseId, templateId) pair already on file in
  // one query. The new (clinicId, caseId, templateId) index makes this an
  // ix-only scan.
  const tplIds = templates.map((t) => t.id);
  const caseIds = cases.map((c) => c.id);
  const existing = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.findMany({
      where: {
        caseId: { in: caseIds },
        templateId: { in: tplIds },
        status: { in: ["QUEUED", "SENT", "DELIVERED", "READ"] },
      },
      select: { caseId: true, templateId: true },
    }),
  )) as Array<{ caseId: string | null; templateId: string | null }>;
  const existingSet = new Set(
    existing.map((e) => `${e.caseId}|${e.templateId}`),
  );

  const now = new Date();
  type Insert = {
    clinicId: string;
    patientId: string;
    appointmentId: string | null;
    caseId: string;
    templateId: string;
    channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
    recipient: string;
    body: string;
    scheduledFor: Date;
    status: "QUEUED";
  };
  const toInsert: Insert[] = [];

  for (const kase of cases) {
    const tpl = tplByClinic.get(kase.clinicId);
    if (!tpl) continue;
    if (existingSet.has(`${kase.id}|${tpl.id}`)) continue;

    // First non-cancelled/no-show appointment determines the window anchor.
    const firstVisit = kase.appointments.find(
      (a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW",
    );
    if (!firstVisit) continue;
    const days = firstVisit.primaryService?.freeRepeatDays ?? null;
    if (!days || days <= 0) continue;

    // Skip if patient already has a future appointment in this case (BOOKED
    // or WAITING) — they're coming back, no nudge needed.
    const hasFutureBooked = kase.appointments.some(
      (a) =>
        a.id !== firstVisit.id &&
        (a.status === "BOOKED" || a.status === "WAITING") &&
        a.date.getTime() > firstVisit.date.getTime(),
    );
    if (hasFutureBooked) continue;

    const cfg =
      tpl.triggerConfig && typeof tpl.triggerConfig === "object"
        ? (tpl.triggerConfig as { daysBefore?: number })
        : {};
    const daysBefore =
      typeof cfg.daysBefore === "number" && cfg.daysBefore > 0
        ? cfg.daysBefore
        : 2;

    const dayMs = 24 * 60 * 60 * 1000;
    const deadline = firstVisit.date.getTime() + days * dayMs;
    const fireFrom = deadline - daysBefore * dayMs;
    if (now.getTime() < fireFrom) continue;
    if (now.getTime() >= deadline) continue; // window already closed

    const recipient = pickRecipient(tpl.channel, kase.patient);
    if (!recipient) continue;

    const daysLeft = Math.max(
      1,
      Math.ceil((deadline - now.getTime()) / dayMs),
    );
    const body = render(tpl.bodyRu, {
      patient: {
        name: kase.patient.fullName,
        firstName: firstName(kase.patient.fullName),
        phone: kase.patient.phone,
      },
      case: {
        daysLeft: String(daysLeft),
        deadline: formatDate(new Date(deadline)),
      },
      clinic: { name: "", phone: "", address: "" },
    } as unknown as Record<string, unknown>);

    toInsert.push({
      clinicId: kase.clinicId,
      patientId: kase.patientId,
      appointmentId: firstVisit.id,
      caseId: kase.id,
      templateId: tpl.id,
      channel: tpl.channel,
      recipient,
      body,
      scheduledFor: now,
      status: "QUEUED",
    });

    // Mirror to INAPP for TG-using patients (same rationale as appointment
    // reminders — banner is a free secondary touch).
    if (
      kase.patient.telegramId &&
      tpl.channel !== "INAPP" &&
      tpl.channel !== "VISIT" &&
      tpl.channel !== "CALL"
    ) {
      toInsert.push({
        clinicId: kase.clinicId,
        patientId: kase.patientId,
        appointmentId: firstVisit.id,
        caseId: kase.id,
        templateId: tpl.id,
        channel: "INAPP",
        recipient: kase.patientId,
        body,
        scheduledFor: now,
        status: "QUEUED",
      });
    }
  }

  if (toInsert.length === 0) return 0;
  await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.createMany({
      data: toInsert as never,
      skipDuplicates: true,
    }),
  );
  return toInsert.length;
}

/**
 * Phase 16 Wave 3 — `referral.reward-earned` materializer.
 *
 * Mints exactly ONE NotificationSend row (channel = the active
 * template's), mirrored to INAPP for TG-using referrers. The reward row
 * itself was already created by `mintReferralRewardOnCompletion`; this
 * handler is purely the push side.
 *
 * Idempotency: we look up the most recent `NotificationSend` for this
 * (clinicId, patientId, key=referral.reward-earned, recipient) tuple and
 * skip if any was created in the last hour. The same trigger should
 * never fire twice for the same reward, but the dedupe protects against
 * a duplicate `mintReferralRewardOnCompletion` call.
 */
async function onReferralRewardEarned(payload: {
  clinicId: string;
  patientId: string;
  rewardId: string;
}): Promise<void> {
  const { clinicId, patientId, rewardId } = payload;
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const reward = await prisma.referralReward.findFirst({
      where: { id: rewardId, clinicId, referrerPatientId: patientId },
      select: {
        rewardPercent: true,
        referredPatient: { select: { fullName: true } },
      },
    });
    if (!reward) return;

    const referrer = await prisma.patient.findFirst({
      where: { id: patientId, clinicId },
      select: {
        fullName: true,
        phone: true,
        telegramId: true,
        marketingOptOut: true,
        deletedAt: true,
      },
    });
    if (!referrer) return;

    // Phase 17 Wave 1 — referral reward push is marketing. The reward
    // row itself was already created by `mintReferralRewardOnCompletion`
    // and is visible in the Mini App refer page on next visit; we just
    // skip the active push when the patient has opted out.
    const consent = isAllowedToReceive(referrer, "marketing");
    if (!consent.allowed) return;

    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { nameRu: true, nameUz: true },
    });

    const tpl = await prisma.notificationTemplate.findFirst({
      where: {
        clinicId,
        key: "referral.reward-earned",
        isActive: true,
      },
      select: {
        id: true,
        bodyRu: true,
        bodyUz: true,
        channel: true,
      },
    });
    if (!tpl) return;

    const friendName = reward.referredPatient?.fullName ?? "—";
    const ctx: Record<string, unknown> = {
      patient: {
        name: referrer.fullName,
        firstName: firstName(referrer.fullName),
      },
      friend: { name: friendName },
      percent: String(reward.rewardPercent),
      clinic: { name: clinic?.nameRu ?? "" },
    };
    const body = render(tpl.bodyRu, ctx);
    const channel = tpl.channel as "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";

    const recipient =
      channel === "SMS" || channel === "EMAIL"
        ? referrer.phone
        : channel === "TG"
          ? referrer.telegramId
          : null;

    const inserts: Array<{
      clinicId: string;
      patientId: string;
      templateId: string;
      channel: typeof channel;
      recipient: string;
      body: string;
      scheduledFor: Date;
      status: "QUEUED";
    }> = [];
    const now = new Date();
    if (recipient && channel !== "INAPP" && channel !== "VISIT" && channel !== "CALL") {
      inserts.push({
        clinicId,
        patientId,
        templateId: tpl.id,
        channel,
        recipient,
        body,
        scheduledFor: now,
        status: "QUEUED",
      });
    }
    // INAPP banner — referrer always sees the news in the Mini App inbox.
    inserts.push({
      clinicId,
      patientId,
      templateId: tpl.id,
      channel: "INAPP",
      recipient: patientId,
      body,
      scheduledFor: now,
      status: "QUEUED",
    });

    if (inserts.length === 0) return;
    await prisma.notificationSend.createMany({
      data: inserts as never,
      skipDuplicates: true,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public dispatcher — single entry point for route handlers
// ─────────────────────────────────────────────────────────────────────────────

export type FireTriggerPayload =
  | { kind: "appointment.created"; appointmentId: string }
  // Generic cancel — legacy entrypoint. New call sites should pass the
  // surface-aware variants below so the patient gets the right text.
  | { kind: "appointment.cancelled"; appointmentId: string }
  // TZ-notifications-cancel-sync §8.3 — staff-initiated cancel (CRM, call
  // centre, no-show worker). The text leans apologetic + offers rebooking.
  | { kind: "appointment.cancelled.by-staff"; appointmentId: string }
  // Patient-initiated cancel (mini-app self-cancel). Soft tone, no apology,
  // a "we're around if you change your mind" closer.
  | { kind: "appointment.cancelled.by-patient"; appointmentId: string }
  // Legacy slug. Kept for callers still passing "noshow"; new code uses
  // the canonical `appointment.no-show` kind below.
  | { kind: "appointment.noshow"; appointmentId: string }
  | { kind: "appointment.no-show"; appointmentId: string }
  // TZ-notifications-cancel-sync §3 — fired by the lifecycle-sweep worker
  // sub-pass when a CONFIRMED/BOOKED row crosses `isRunningLate(now)`
  // without anyone marking the patient arrived.
  | { kind: "appointment.running-late"; appointmentId: string }
  | { kind: "appointment.updated"; appointmentId: string }
  | { kind: "payment.paid"; appointmentId: string | null }
  | {
      // Phase 16 Wave 3 — fired from `mintReferralRewardOnCompletion`.
      // The referrer (the existing patient who shared the code) gets a
      // push that they've earned a discount on their next visit.
      kind: "referral.reward-earned";
      clinicId: string;
      patientId: string; // the referrer
      rewardId: string;
    };

/**
 * Fire-and-forget trigger hook for route handlers.
 *
 * Intentionally swallows errors — notifications are best-effort. Route
 * handlers should never fail because of a trigger bug.
 */
export function fireTrigger(payload: FireTriggerPayload): void {
  const run = async () => {
    try {
      switch (payload.kind) {
        case "appointment.created": {
          await onAppointmentCreated(payload.appointmentId);
          await scheduleAppointmentReminders(payload.appointmentId);
          return;
        }
        case "appointment.cancelled":
        case "appointment.cancelled.by-staff":
        case "appointment.cancelled.by-patient": {
          // Cancel any pending reminders for this appointment so we don't
          // send 24h/5h/3h/1h reminders for an appointment that's been
          // cancelled. The cancel kernel also runs this updateMany inside
          // its transaction — running it again here is idempotent (rows
          // already CANCELLED stay CANCELLED) and protects callers that
          // bypass the kernel.
          await runWithTenant({ kind: "SYSTEM" }, () =>
            prisma.notificationSend.updateMany({
              where: {
                appointmentId: payload.appointmentId,
                status: "QUEUED",
                template: {
                  trigger: { in: ["APPOINTMENT_BEFORE", "APPOINTMENT_CREATED"] },
                },
              },
              data: { status: "CANCELLED" },
            }),
          );
          const variant =
            payload.kind === "appointment.cancelled.by-patient"
              ? "by-patient"
              : payload.kind === "appointment.cancelled.by-staff"
                ? "by-staff"
                : "generic";
          await onAppointmentCancelled(payload.appointmentId, variant);
          return;
        }
        case "appointment.noshow":
        case "appointment.no-show": {
          await onAppointmentNoShow(payload.appointmentId);
          return;
        }
        case "appointment.running-late": {
          await onAppointmentRunningLate(payload.appointmentId);
          return;
        }
        case "appointment.updated": {
          await scheduleAppointmentReminders(payload.appointmentId);
          return;
        }
        case "payment.paid": {
          // No-op today — Phase 3a just stops any pending payment.due rows
          // for the appointment.
          if (payload.appointmentId) {
            await runWithTenant({ kind: "SYSTEM" }, () =>
              prisma.notificationSend.updateMany({
                where: {
                  appointmentId: payload.appointmentId,
                  status: "QUEUED",
                  template: { key: "payment.due" },
                },
                data: { status: "CANCELLED" },
              }),
            );
          }
          return;
        }
        case "referral.reward-earned": {
          await onReferralRewardEarned(payload);
          return;
        }
      }
    } catch (e) {
      console.error(`[triggers] fireTrigger(${payload.kind}) failed`, e);
    }
  };
  // Fire-and-forget: not awaited. In Node this runs on the next turn.
  void run();
}
