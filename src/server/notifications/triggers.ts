/**
 * Notification trigger registry.
 *
 * Each trigger is a pure function that queries the DB and materialises
 * `NotificationSend` rows with `status=QUEUED` and a `scheduledFor`
 * timestamp. The scheduler worker picks them up and dispatches.
 *
 * Triggers (TZ §6.9 + §8.3; cascade per TZ-risk-outcomes §7):
 *   - appointment.created       — immediate confirmation
 *   - appointment.reminder-5d   — 5 days before start
 *   - appointment.reminder-3d   — 3 days before start
 *   - appointment.reminder-24h  — 1 day before start
 *   - appointment.reminder-3h   — 3h before start
 *   - appointment.cancelled     — immediate
 *   - birthday                  — 09:00 clinic TZ on birthday
 *   - no-show                   — immediate after status=NO_SHOW
 *   - payment.due               — unpaid appointment that was DONE >24h ago
 *
 * Idempotency: a (patientId, appointmentId, templateKey) tuple never
 * creates more than one pending row. We enforce that by querying for
 * existing rows before insert. For messages about one appointment start
 * (the bands, «перенесён», cancel, no-show, running late) the start is part
 * of the key (`isStartKeyed`, audit TG-21).
 *
 * Integration: `fireTrigger` is called from route handlers after the
 * mutation commits. It wraps the trigger function in a SYSTEM context
 * so tenant scoping doesn't apply.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { formatMoney } from "@/lib/format";
import { loadPatientFinance } from "@/server/patient/finance";
import { paidNetTiyin } from "@/server/services/ltv-compute";

import { isAllowedToReceive } from "./consent-gate";
import { LIVE_SEND_STATUSES, coversStart } from "./delivery-state";
import {
  MANUAL_APPOINTMENT_REMINDER_KEY,
  MANUAL_APPOINTMENT_REMINDER_TEMPLATE,
  NPS_REQUEST_TEMPLATE,
  PRE_VISIT_QUESTIONNAIRE_TEMPLATE,
  type DefaultTemplate,
} from "./default-templates";
import { ensureClinicTemplate } from "./ensure-template";
import {
  familyRelayHeader,
  familyRelaysFor,
  type FamilyRelay,
} from "./family-relay";
import { recordPatientNoChannel } from "./no-channel-action";
import { skipsWhenConfirmed } from "./rules";
import { render } from "./template";
import { TEMPLATE_PICK_ORDER } from "./template-events";

export const TRIGGER_KEYS = [
  "appointment.created",
  // Auto-messages widget — "Спасибо за визит". Fired when a visit lands in
  // COMPLETED (appointment PATCH / visit-note finalize). Idempotency is the
  // standard (patientId, appointmentId, templateId) NotificationSend gate.
  "appointment.thank-you",
  // TZ-risk-outcomes §7 — first touch of the 5d/3d/1d/3h cascade. Fires
  // 5 days before start so the clinic has a full working week of runway
  // to re-fill the slot if the patient bails.
  "appointment.reminder-5d",
  // Stage 2.D — soft 3-day "gentle ping" reminder. Audience is restricted at
  // the materialiser (TELEGRAM/WEBSITE bookings still pending confirmation,
  // i.e. `confirmedAt IS NULL`). PHONE/KIOSK/WALKIN auto-confirm at booking
  // and never see this template. Retired 2026-06-05, RESTORED to the
  // canonical scheduler band by TZ-risk-outcomes §7 (5d/3d/1d/3h cascade).
  "appointment.reminder-3d",
  "appointment.reminder-24h",
  // TZ-risk-outcomes §7 — the -5h / -2h / -1h pings fall out of the canon
  // (cascade is now 5d/3d/1d/3h). Slugs stay for legacy per-clinic
  // templates an admin may keep as a dynamic-offset variant.
  "appointment.reminder-5h",
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
  // Fired whenever an appointment's start moves (single PATCH or bulk
  // reschedule). Without it a move was completely silent: the cascade rows
  // materialised at booking time carry the OLD time baked into their body,
  // so the patient was reminded of a slot that no longer exists and got
  // nothing at all for the new one.
  "appointment.rescheduled",
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

export type AppointmentWithRefs = {
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
    /** The language reminders are written in; absent reads as Russian. */
    preferredLang?: "RU" | "UZ";
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

/**
 * Everything a reminder body can name: the patient (and the language they
 * read), the doctor, the service, the cabinet, the clinic. Shared by every
 * materialiser, the scheduler's custom-offset pass included (audit TG-02:
 * that pass used to render with an empty clinic and no time or doctor).
 */
export const APPOINTMENT_REFS_INCLUDE = {
  patient: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      telegramId: true,
      preferredChannel: true,
      preferredLang: true,
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
} as const;

async function loadAppointment(
  appointmentId: string,
): Promise<AppointmentWithRefs | null> {
  return (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: APPOINTMENT_REFS_INCLUDE,
    }),
  )) as AppointmentWithRefs | null;
}

/** The language a patient reads: their card's choice, Russian by default. */
export function patientLang(patient: { preferredLang?: string | null }): "ru" | "uz" {
  return patient.preferredLang === "UZ" ? "uz" : "ru";
}

/**
 * A template rendered for one appointment, in the patient's language. A blank
 * Uzbek text (a template only ever edited in Russian) falls back to Russian
 * rather than sending an empty message.
 */
export function renderAppointmentBody(
  tpl: { bodyRu: string; bodyUz: string },
  appt: AppointmentWithRefs,
  extras?: PaymentExtras,
  /** The reader's language when it is not the patient's (a family relay). */
  readerLang?: "ru" | "uz",
): string {
  const wanted = readerLang ?? patientLang(appt.patient);
  const lang = wanted === "uz" && tpl.bodyUz.trim() !== "" ? "uz" : "ru";
  return render(
    lang === "uz" ? tpl.bodyUz : tpl.bodyRu,
    buildContext(appt, lang, extras) as unknown as Record<string, unknown>,
  );
}

/**
 * The body a family owner gets for their relative's visit (audit P1D-01):
 * a line naming the relative, then the template in the owner's language.
 */
export function renderRelayedAppointmentBody(
  tpl: { bodyRu: string; bodyUz: string },
  appt: AppointmentWithRefs,
  relay: FamilyRelay,
  extras?: PaymentExtras,
): string {
  return `${familyRelayHeader(relay.lang, appt.patient.fullName)}\n\n${renderAppointmentBody(
    tpl,
    appt,
    extras,
    relay.lang,
  )}`;
}

/** What `payment.due` knows about the debt, тийин. */
type PaymentExtras = { paymentAmount?: number; paymentCurrency?: string };

/**
 * `{{clinic.*}}` in the patient's language. Shared by every materialiser
 * that has no appointment to hang the clinic on (birthdays, free repeat
 * visits): those used to render with an empty clinic, so the patient read
 * «повторный приём в . Тел: .» (audit TG-14).
 */
export function clinicContext(
  clinic: {
    nameRu: string;
    nameUz: string;
    phone: string | null;
    addressRu: string | null;
    addressUz?: string | null;
  },
  lang: "ru" | "uz",
): RenderCtx["clinic"] {
  return {
    name: lang === "uz" ? clinic.nameUz || clinic.nameRu : clinic.nameRu,
    phone: clinic.phone ?? "",
    address:
      (lang === "uz" ? clinic.addressUz || clinic.addressRu : clinic.addressRu) ??
      "",
  };
}

/**
 * A calendar day as «25 сентября» / «25-sentabr», in the clinic's zone. No
 * year and no «г.»: the deadlines it names are days away, and the Russian
 * long form's trailing «г.» met the template's own full stop as «г..»
 * (audit TG-14).
 */
export function formatDayMonth(
  d: Date,
  lang: "ru" | "uz",
  tz = "Asia/Tashkent",
): string {
  try {
    return new Intl.DateTimeFormat(lang === "uz" ? "uz-Latn-UZ" : "ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function buildContext(
  appt: AppointmentWithRefs,
  lang: "ru" | "uz",
  extras?: PaymentExtras,
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
            // Money is stored in тийин; the patient reads «150 000 сум»
            // (audit TG-13: the amount used to be blank, or raw тийин).
            amount:
              extras.paymentAmount === undefined
                ? ""
                : formatMoney(extras.paymentAmount, "UZS", lang),
            currency: extras.paymentCurrency ?? "UZS",
          },
        }
      : {}),
  };
}

type FindTemplateResult = {
  templateId: string;
  key?: string;
  nameRu?: string;
  nameUz?: string;
  bodyRu: string;
  bodyUz: string;
  channel: "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
  triggerConfig: unknown;
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
    case "appointment.thank-you":
      // Match by the enum (preferred) or the slug for hand-seeded rows.
      return {
        OR: [
          { trigger: "APPOINTMENT_COMPLETED" },
          { key: "appointment.thank-you" },
        ],
      };
    case "appointment.reminder-5d":
      return {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { path: ["offsetMin"], equals: -7200 },
      };
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
    // `appointment.cancelled.by-staff` / `.by-patient`: an audience template
    // first, then a generic one if the clinic only has that (default seed
    // has both variants). Two tiers, see `whereTiersForTrigger`.
    case "appointment.rescheduled":
      // Enum first; slug fallback for clinics that hand-seeded a row before
      // the enum existed.
      return {
        OR: [
          { trigger: "APPOINTMENT_RESCHEDULED" },
          { key: "appointment.rescheduled" },
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

/**
 * The where-clauses of a trigger, most specific first (audit TG-22). A
 * cancellation by staff takes a staff-audience template before a generic
 * one; one `OR` used to let the database pick either.
 */
function whereTiersForTrigger(
  trigger: TriggerKey,
): Array<Record<string, unknown>> | null {
  const anyAudience = whereForTrigger("appointment.cancelled");
  switch (trigger) {
    case "appointment.cancelled.by-staff":
    case "appointment.cancelled.by-patient":
      return [
        {
          trigger: "APPOINTMENT_CANCELLED",
          triggerConfig: {
            path: ["audience"],
            equals: trigger === "appointment.cancelled.by-staff" ? "staff" : "patient",
          },
        },
        anyAudience!,
      ];
    default: {
      const where = whereForTrigger(trigger);
      return where ? [where] : null;
    }
  }
}

/**
 * The active template the dispatcher sends for a trigger, or null. Within a
 * tier the order is fixed (`TEMPLATE_PICK_ORDER`): `findFirst` without one
 * returned whichever duplicate the database met first, so a switch or a text
 * edited in «Авто-сообщения» could be ignored (audit TG-22). Saving a
 * template now also switches its slot rivals off (`retireSlotRivals`).
 */
async function findTemplateFor(
  clinicId: string,
  trigger: TriggerKey,
): Promise<FindTemplateResult> {
  const tiers = whereTiersForTrigger(trigger);
  if (!tiers) return null;
  for (const where of tiers) {
    const row = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.notificationTemplate.findFirst({
        where: {
          clinicId,
          isActive: true,
          ...where,
        },
        select: {
          id: true,
          key: true,
          nameRu: true,
          nameUz: true,
          bodyRu: true,
          bodyUz: true,
          channel: true,
          triggerConfig: true,
        },
        orderBy: TEMPLATE_PICK_ORDER,
      }),
    );
    if (!row) continue;
    return {
      templateId: row.id,
      key: row.key,
      nameRu: row.nameRu,
      nameUz: row.nameUz,
      bodyRu: row.bodyRu,
      bodyUz: row.bodyUz,
      channel: row.channel as FindTemplateResult extends null
        ? never
        : "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP",
      triggerConfig: row.triggerConfig,
    };
  }
  return null;
}

/** The template a trigger really sends now (the «Триггеры» panel, the widget). */
export { findTemplateFor as findActiveTemplateFor };

/** A reminder band that asks to confirm, for a visit already confirmed. */
function isPointlessForConfirmed(
  trigger: TriggerKey,
  tpl: NonNullable<FindTemplateResult>,
  appt: { confirmedAt: Date | null },
): boolean {
  return (
    trigger.startsWith("appointment.reminder-") &&
    appt.confirmedAt !== null &&
    skipsWhenConfirmed(tpl.triggerConfig)
  );
}

/**
 * Triggers whose message is about one appointment START (audit TG-21): the
 * cascade bands, «перенесён», the cancellation, the no-show, «опаздываете».
 * Their idempotency is per start, not per appointment for ever: after a
 * second reschedule the SENT «перенесён на вторник» used to block «перенесён
 * на среду», and a 24h band already sent for the old day blocked the band of
 * the new day, so the patient came at the old time.
 */
function isStartKeyed(trigger: TriggerKey): boolean {
  return (
    trigger.startsWith("appointment.reminder-") ||
    trigger.startsWith("appointment.cancelled") ||
    trigger === "appointment.rescheduled" ||
    trigger === "appointment.no-show" ||
    trigger === "no-show" ||
    trigger === "appointment.running-late"
  );
}

/**
 * Whether a row written before `appointmentAt` existed, whose start cannot
 * be derived, still counts as «already sent for this start». It does, so a
 * row a deploy straddles is never doubled; except «перенесён», which is
 * about a move: an old one is always about an earlier start (the single
 * path gates it by `rescheduleNoticeIsCurrent` instead).
 */
function unknownStartCovers(trigger: TriggerKey): boolean {
  return trigger !== "appointment.rescheduled";
}

/**
 * `where` of the live rows that cover appointment start `start`: rows
 * stamped with it, and legacy rows of a cascade band whose start is
 * `scheduledFor - offsetMin` (see `reminderAnchorMs`).
 */
function sameStartWhere(
  start: Date,
  offsetMin: unknown,
  unknownCovers: boolean,
): Record<string, unknown> {
  const legacy: Array<Record<string, unknown>> = [];
  if (typeof offsetMin === "number" && Number.isFinite(offsetMin)) {
    legacy.push({
      appointmentAt: null,
      scheduledFor: new Date(start.getTime() + offsetMin * 60_000),
    });
  } else if (unknownCovers) {
    legacy.push({ appointmentAt: null });
  }
  return { OR: [{ appointmentAt: start }, ...legacy] };
}

function offsetOf(triggerConfig: unknown): unknown {
  return (triggerConfig as { offsetMin?: unknown } | null)?.offsetMin;
}

/**
 * Idempotency gate: skip if a queued, in-flight or sent row already exists
 * for this (patientId, appointmentId?, templateId), and for a start-keyed
 * trigger, for this appointment start.
 */
async function alreadyScheduled(params: {
  clinicId: string;
  patientId: string;
  appointmentId?: string | null;
  templateId: string;
  sameStart?: Record<string, unknown>;
}): Promise<boolean> {
  const existing = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.findFirst({
      where: {
        clinicId: params.clinicId,
        patientId: params.patientId,
        appointmentId: params.appointmentId ?? null,
        templateId: params.templateId,
        status: { in: [...LIVE_SEND_STATUSES] },
        ...(params.sameStart ?? {}),
      },
      select: { id: true },
    }),
  );
  return existing !== null;
}

/**
 * Idempotency gate of «перенесён» (audit TG-21): whether the visit's newest
 * live notice already names its current start. Keyed by start like the
 * bands, a move back to a start an earlier notice named (Tue → Wed → Tue)
 * found that old SENT «вторник» and stayed silent, so the patient's last
 * message said Wednesday. Only the newest notice counts: a repeat fire of
 * the same move still collapses, a return to an earlier start notifies
 * again. Every «перенесён» template counts, so switching the active template
 * between two fires of one move does not double it. A legacy row without a
 * stamped start never matches (`unknownStartCovers`).
 */
async function rescheduleNoticeIsCurrent(appt: {
  id: string;
  clinicId: string;
  patientId: string;
  date: Date;
}): Promise<boolean> {
  const latest = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.findFirst({
      where: {
        clinicId: appt.clinicId,
        patientId: appt.patientId,
        appointmentId: appt.id,
        status: { in: [...LIVE_SEND_STATUSES] },
        template: whereForTrigger("appointment.rescheduled")!,
      },
      // `id` only breaks a tie between the Telegram row and its INAPP mirror,
      // which carry the same start.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { appointmentAt: true },
    }),
  );
  return latest?.appointmentAt?.getTime() === appt.date.getTime();
}

/**
 * The patient's own address on a channel. Only Telegram is dispatchable:
 * EMAIL has no adapter and the card no e-mail field, and the phone it used
 * to return made a row the worker could only fail (audit INF-11).
 */
function pickRecipient(
  channel: "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP",
  patient: { phone: string; telegramId: string | null },
): string | null {
  if (channel === "TG") return patient.telegramId;
  return null;
}

/**
 * Who an appointment message goes to: the patient's own chat, or, for a
 * relative without Telegram, the family owner's (audit P1D-01). Null when
 * neither can be reached; the caller raises the call task.
 */
async function reachAppointmentPatient(
  channel: "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP",
  appt: AppointmentWithRefs,
  relay: boolean,
): Promise<{ recipient: string; relay: FamilyRelay | null } | null> {
  const own = pickRecipient(channel, appt.patient);
  if (own) return { recipient: own, relay: null };
  if (!relay || channel !== "TG") return null;
  const owner = (await familyRelaysFor([{ id: appt.patientId, clinicId: appt.clinicId }])).get(
    appt.patientId,
  );
  return owner ? { recipient: owner.telegramId, relay: owner } : null;
}

async function createSend(params: {
  clinicId: string;
  patientId: string;
  appointmentId?: string | null;
  /** The appointment start the row is written for (audit TG-08). */
  appointmentAt?: Date | null;
  templateId: string;
  channel: "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
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
        appointmentAt: params.appointmentAt ?? null,
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
  jobs: ReadonlyArray<{
    appointmentId: string;
    scheduledFor: Date;
    /** `payment.due` only: the debt the body names, тийин. */
    paymentAmount?: number;
  }>,
  trigger: TriggerKey,
): Promise<{ created: number; skipped: number }> {
  if (jobs.length === 0) return { created: 0, skipped: 0 };
  const apptIds = jobs.map((j) => j.appointmentId);

  const appts = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: { id: { in: apptIds } },
      include: APPOINTMENT_REFS_INCLUDE,
    }),
  )) as AppointmentWithRefs[];
  const apptMap = new Map(appts.map((a) => [a.id, a]));

  const clinicIds = Array.from(new Set(appts.map((a) => a.clinicId)));
  const tplEntries = await Promise.all(
    clinicIds.map(async (cid) => {
      const tpl = await findTemplateFor(cid, trigger);
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
              // SENDING too: a row interrupted mid-send is not a reason to
              // build a second one (the sweep re-sends the first).
              status: { in: [...LIVE_SEND_STATUSES] },
            },
            select: {
              appointmentId: true,
              templateId: true,
              appointmentAt: true,
              scheduledFor: true,
            },
          }),
        );
  const existingByPair = new Map<string, typeof existing>();
  for (const e of existing) {
    const k = `${e.appointmentId}|${e.templateId}`;
    existingByPair.set(k, [...(existingByPair.get(k) ?? []), e]);
  }
  // A band already sent for the visit's OLD start does not cover the new
  // one (audit TG-21).
  const startKeyed = isStartKeyed(trigger);
  const alreadyCovered = (appt: AppointmentWithRefs, tpl: NonNullable<FindTemplateResult>) =>
    (existingByPair.get(`${appt.id}|${tpl.templateId}`) ?? []).some(
      (row) =>
        !startKeyed ||
        coversStart(
          row,
          offsetOf(tpl.triggerConfig),
          appt.date.getTime(),
          unknownStartCovers(trigger),
        ),
    );
  // Relatives without Telegram reach the family owner (audit P1D-01).
  const relays = await familyRelaysFor(
    appts
      .filter((a) => {
        const tpl = templates.get(a.clinicId);
        return tpl?.channel === "TG" && !pickRecipient(tpl.channel, a.patient);
      })
      .map((a) => ({ id: a.patientId, clinicId: a.clinicId })),
  );

  const toInsert: Array<{
    clinicId: string;
    patientId: string;
    appointmentId: string;
    appointmentAt: Date;
    templateId: string;
    channel: "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
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
    const tpl = templates.get(appt.clinicId);
    if (!tpl) {
      skipped += 1;
      continue;
    }
    // Stage 2.D — the band that asks to confirm (T-3d) is not built for a
    // visit already confirmed; the other bands are (audit TG-03).
    if (isPointlessForConfirmed(trigger, tpl, appt)) {
      skipped += 1;
      continue;
    }
    if (alreadyCovered(appt, tpl)) {
      skipped += 1;
      continue;
    }
    const relay = relays.get(appt.patientId) ?? null;
    const recipient = pickRecipient(tpl.channel, appt.patient) ?? relay?.telegramId ?? null;
    if (!recipient) {
      // Wave 4 of `docs/TZ-sms-removal.md` — surface the dropped signal so
      // the operator can call the patient via the Call Center instead of
      // losing it. Dedup is per (patient, trigger, UTC-day) so a busy
      // patient produces one row per missed trigger per day.
      await recordPatientNoChannel({
        clinicId: appt.clinicId,
        patientId: appt.patientId,
        patientName: appt.patient.fullName,
        triggerKey: trigger,
        appointmentId: appt.id,
        appointmentAt: appt.date,
      });
      skipped += 1;
      continue;
    }
    const extras =
      job.paymentAmount === undefined
        ? undefined
        : { paymentAmount: job.paymentAmount, paymentCurrency: "UZS" };
    const body =
      relay && !appt.patient.telegramId
        ? renderRelayedAppointmentBody(tpl, appt, relay, extras)
        : renderAppointmentBody(tpl, appt, extras);
    toInsert.push({
      clinicId: appt.clinicId,
      patientId: appt.patientId,
      appointmentId: appt.id,
      // The start this row is written for: the send worker cancels it if
      // the appointment moves (audit TG-08).
      appointmentAt: appt.date,
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
        appointmentAt: appt.date,
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

/**
 * The clinic's manual-reminder template, created from the default on first
 * use. Clinics are not seeded automatically, and a button that silently found
 * no template is exactly how «Напомнить всем» came to send nothing (AP-02).
 */
function ensureManualReminderTemplate(clinicId: string) {
  return ensureClinicTemplate(clinicId, MANUAL_APPOINTMENT_REMINDER_TEMPLATE);
}

export type ManualReminderResult = {
  /** Rows created by THIS call (TG + in-app mirror), the only ones to dispatch. */
  sendIds: string[];
  /** Appointments that got a reminder. */
  reminded: number;
  /** Not reminded: already reminded, patient already here, visit passed. */
  skipped: number;
  /** No Telegram: a call task went to the action center instead. */
  noChannel: number;
  /** The clinic switched the template off in /crm/notifications. */
  templateDisabled: boolean;
};

/**
 * «Напомнить всем» on the Appointments page (audit AP-02): one staff-sent
 * reminder per upcoming, not-yet-arrived appointment, due now.
 *
 * It has its own MANUAL template and creates its own rows, returning their
 * ids so the caller dispatches exactly those. The cascade rows (5d/3d/1d/3h)
 * are never touched: they stay QUEUED for their own time. At most one manual
 * reminder per appointment, so a second click reminds nobody twice.
 */
export async function materializeManualReminders(params: {
  clinicId: string;
  appointmentIds: ReadonlyArray<string>;
  now: Date;
}): Promise<ManualReminderResult> {
  const ids = Array.from(new Set(params.appointmentIds));
  const empty: ManualReminderResult = {
    sendIds: [],
    reminded: 0,
    skipped: ids.length,
    noChannel: 0,
    templateDisabled: false,
  };
  if (ids.length === 0) return empty;

  const tpl = await ensureManualReminderTemplate(params.clinicId);
  if (!tpl.isActive) return { ...empty, templateDisabled: true };

  const appts = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        id: { in: ids },
        clinicId: params.clinicId,
        // Only a visit still ahead whose patient has not arrived yet: «ждём
        // вас» to someone sitting in the hall, or about a slot that already
        // passed, is wrong.
        status: { in: ["BOOKED", "CONFIRMED"] },
        date: { gt: params.now },
      },
      include: APPOINTMENT_REFS_INCLUDE,
    }),
  )) as AppointmentWithRefs[];

  const already = new Set(
    (
      await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.notificationSend.findMany({
          where: {
            appointmentId: { in: appts.map((a) => a.id) },
            templateId: tpl.id,
            status: { in: [...LIVE_SEND_STATUSES] },
          },
          select: { appointmentId: true },
        }),
      )
    ).map((r) => r.appointmentId),
  );

  const rows: Array<{
    clinicId: string;
    patientId: string;
    appointmentId: string;
    appointmentAt: Date;
    templateId: string;
    channel: "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
    recipient: string;
    body: string;
    scheduledFor: Date;
    status: "QUEUED";
  }> = [];
  let reminded = 0;
  let noChannel = 0;
  // Relatives without Telegram reach the family owner (audit P1D-01).
  const relays = await familyRelaysFor(
    tpl.channel === "TG"
      ? appts
          .filter((a) => !already.has(a.id) && !a.patient.telegramId)
          .map((a) => ({ id: a.patientId, clinicId: a.clinicId }))
      : [],
  );
  for (const appt of appts) {
    if (already.has(appt.id)) continue;
    const relay = appt.patient.telegramId ? null : (relays.get(appt.patientId) ?? null);
    const recipient = pickRecipient(tpl.channel, appt.patient) ?? relay?.telegramId ?? null;
    if (!recipient) {
      await recordPatientNoChannel({
        clinicId: appt.clinicId,
        patientId: appt.patientId,
        patientName: appt.patient.fullName,
        triggerKey: MANUAL_APPOINTMENT_REMINDER_KEY,
        appointmentId: appt.id,
        appointmentAt: appt.date,
      });
      noChannel += 1;
      continue;
    }
    const body = relay
      ? renderRelayedAppointmentBody(tpl, appt, relay)
      : renderAppointmentBody(tpl, appt);
    const base = {
      clinicId: appt.clinicId,
      patientId: appt.patientId,
      appointmentId: appt.id,
      appointmentAt: appt.date,
      templateId: tpl.id,
      body,
      scheduledFor: params.now,
      status: "QUEUED" as const,
    };
    rows.push({ ...base, channel: tpl.channel, recipient });
    // Same in-app mirror as the cascade (see materializeForAppointmentsBulk).
    if (
      appt.patient.telegramId &&
      tpl.channel !== "INAPP" &&
      tpl.channel !== "VISIT" &&
      tpl.channel !== "CALL"
    ) {
      rows.push({ ...base, channel: "INAPP", recipient: appt.patientId });
    }
    reminded += 1;
  }

  const created =
    rows.length === 0
      ? []
      : await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.notificationSend.createManyAndReturn({
            data: rows as never,
            select: { id: true },
          }),
        );

  return {
    sendIds: created.map((r) => r.id),
    reminded,
    skipped: ids.length - reminded - noChannel,
    noChannel,
    templateDisabled: false,
  };
}

/**
 * Why a single materialisation made no row. The patient-experience workers
 * stamp «уведомлено» only when a row exists (audit TG-09) and log the rest.
 */
export type MaterializeOutcome = {
  created: number;
  skipped: number;
  reason?:
    | "no_appointment"
    | "no_template"
    | "confirmed"
    | "already_scheduled"
    | "no_recipient";
};

/**
 * Triggers whose worker finds its template by slug and whose template no
 * seed creates: the default is created for the clinic on first use. A row an
 * admin switched off stays off (`ensureClinicTemplate` never updates).
 */
const PROVISIONED_TEMPLATES: Partial<Record<TriggerKey, DefaultTemplate>> = {
  "appointment.pre-visit-questionnaire": PRE_VISIT_QUESTIONNAIRE_TEMPLATE,
  "appointment.nps-request": NPS_REQUEST_TEMPLATE,
};

async function materializeForAppointment(
  apptId: string,
  trigger: TriggerKey,
  scheduledFor: Date,
  options: {
    /**
     * Raise a PATIENT_NO_CHANNEL call task when the patient has no Telegram.
     * Off for Mini App flows (questionnaire, rating): a call cannot fill a
     * Mini App form, and reception would get a task per visit.
     */
    noChannelAction?: boolean;
    /**
     * Send a relative's message to their family owner when the relative has
     * no Telegram (audit P1D-01). Off for the same Mini App flows: the form
     * link opens for the patient's own account only.
     */
    relay?: boolean;
  } = {},
): Promise<MaterializeOutcome> {
  const appt = await loadAppointment(apptId);
  if (!appt) return { created: 0, skipped: 0, reason: "no_appointment" };
  let tpl = await findTemplateFor(appt.clinicId, trigger);
  const provisioned = PROVISIONED_TEMPLATES[trigger];
  if (!tpl && provisioned) {
    await ensureClinicTemplate(appt.clinicId, provisioned);
    tpl = await findTemplateFor(appt.clinicId, trigger);
  }
  if (!tpl) return { created: 0, skipped: 1, reason: "no_template" };
  // A PHONE / KIOSK booking is confirmed at creation: its T-3d «подтвердите»
  // row would only be cancelled by the worker, so it is not built.
  if (isPointlessForConfirmed(trigger, tpl, appt)) {
    return { created: 0, skipped: 1, reason: "confirmed" };
  }
  const already =
    trigger === "appointment.rescheduled"
      ? await rescheduleNoticeIsCurrent(appt)
      : await alreadyScheduled({
          clinicId: appt.clinicId,
          patientId: appt.patientId,
          appointmentId: appt.id,
          templateId: tpl.templateId,
          sameStart: isStartKeyed(trigger)
            ? sameStartWhere(appt.date, offsetOf(tpl.triggerConfig), unknownStartCovers(trigger))
            : undefined,
        });
  if (already) return { created: 0, skipped: 1, reason: "already_scheduled" };
  const reach = await reachAppointmentPatient(
    tpl.channel,
    appt,
    options.relay ?? options.noChannelAction !== false,
  );
  const recipient = reach?.recipient ?? null;
  if (!recipient) {
    // Wave 4 of `docs/TZ-sms-removal.md` — compensator for TG-less patients.
    if (options.noChannelAction !== false) {
      await recordPatientNoChannel({
        clinicId: appt.clinicId,
        patientId: appt.patientId,
        patientName: appt.patient.fullName,
        triggerKey: trigger,
        appointmentId: appt.id,
        appointmentAt: appt.date,
      });
    }
    return { created: 0, skipped: 1, reason: "no_recipient" };
  }
  const body = reach?.relay
    ? renderRelayedAppointmentBody(tpl, appt, reach.relay)
    : renderAppointmentBody(tpl, appt);
  await createSend({
    clinicId: appt.clinicId,
    patientId: appt.patientId,
    appointmentId: appt.id,
    appointmentAt: appt.date,
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
      appointmentAt: appt.date,
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
 * Materialise a notification ~24h before the appointment; the send worker
 * attaches the Mini App button that opens the questionnaire form. The
 * template is created for the clinic on first use (audit TG-09). Caller (the
 * worker) stamps `preVisitNotifiedAt` once a row exists, never before: the
 * outcome says whether it does.
 */
export async function onPreVisitQuestionnaire(
  appointmentId: string,
): Promise<MaterializeOutcome> {
  return materializeForAppointment(
    appointmentId,
    "appointment.pre-visit-questionnaire",
    new Date(),
    { noChannelAction: false },
  );
}

/**
 * Phase 16 Wave 2 — Post-visit NPS push.
 *
 * Materialise a notification ~4h after the appointment lands in COMPLETED;
 * the send worker attaches the Mini App button of the rating form. Caller
 * stamps `npsRequestedAt` once a row exists (audit TG-09).
 */
export async function onNpsRequest(
  appointmentId: string,
): Promise<MaterializeOutcome> {
  return materializeForAppointment(
    appointmentId,
    "appointment.nps-request",
    new Date(),
    { noChannelAction: false },
  );
}

/**
 * Auto-messages widget — "Спасибо за визит".
 *
 * Materialise a thank-you the moment a visit lands in COMPLETED. Idempotency
 * is the standard (patientId, appointmentId, templateId) gate in
 * `materializeForAppointment`, so the appointment PATCH and the visit-note
 * finalize path can both fire it without double-texting. No-op when the
 * clinic has the template toggled off (`isActive=false` → no row resolves).
 */
export async function onAppointmentThankYou(
  appointmentId: string,
): Promise<void> {
  await materializeForAppointment(
    appointmentId,
    "appointment.thank-you",
    new Date(),
  );
}

/**
 * Schedule the reminder cascade for an appointment.
 *
 * TZ-risk-outcomes §7 — canonical bands are 5d / 3d / 1d / 3h (replaces the
 * 24h / 5h / 3h / 1h day-of cadence from TZ-notifications-cancel-sync §2).
 * The legacy -5h / -2h / -1h pings are retired from the canonical scheduler
 * but still resolvable via slug for any per-clinic template the admin chose
 * to keep on dynamic-offset materialisation.
 */
export async function scheduleAppointmentReminders(
  appointmentId: string,
): Promise<void> {
  const appt = await loadAppointment(appointmentId);
  if (!appt) return;
  // A reminder still queued for another start is a lie about the time. The
  // reschedule path cancels them up front; any other caller of this top-up
  // (`appointment.updated`) used to leave them for the send worker's drift
  // guard to catch (audit TG-18).
  await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.updateMany({
      where: {
        appointmentId,
        status: "QUEUED",
        template: { trigger: { in: ["APPOINTMENT_BEFORE"] } },
        AND: [{ appointmentAt: { not: null } }, { appointmentAt: { not: appt.date } }],
      },
      data: {
        status: "CANCELLED",
        failedReason: "appointment time changed after reminder was queued",
      },
    }),
  );
  const start = appt.date.getTime();
  const now = Date.now();
  if (start - 5 * 24 * 60 * 60 * 1000 > now) {
    await materializeForAppointment(
      appointmentId,
      "appointment.reminder-5d",
      new Date(start - 5 * 24 * 60 * 60 * 1000),
    );
  }
  if (start - 3 * 24 * 60 * 60 * 1000 > now) {
    await materializeForAppointment(
      appointmentId,
      "appointment.reminder-3d",
      new Date(start - 3 * 24 * 60 * 60 * 1000),
    );
  }
  if (start - 24 * 60 * 60 * 1000 > now) {
    await materializeForAppointment(
      appointmentId,
      "appointment.reminder-24h",
      new Date(start - 24 * 60 * 60 * 1000),
    );
  }
  if (start - 3 * 60 * 60 * 1000 > now) {
    await materializeForAppointment(
      appointmentId,
      "appointment.reminder-3h",
      new Date(start - 3 * 60 * 60 * 1000),
    );
  }
}

/**
 * Void every still-pending reminder for an appointment.
 *
 * Reminders are materialised eagerly at booking time with the wall-clock time
 * ALREADY rendered into `body` and `scheduledFor` derived from the old start.
 * Once the appointment moves, those rows are lies twice over — wrong text and
 * wrong delivery moment — so they must die before the cascade is rebuilt.
 *
 * Only QUEUED rows are touched: SENT/DELIVERED/READ are historical fact and a
 * CANCELLED row must stay CANCELLED. Restricting to the reminder-ish
 * triggers keeps transactional rows (the cancel/no-show notices) out of the
 * blast radius. A «перенесён на …» notice not sent yet (a rate-limit
 * deferral, a second move a minute later) names a start that is gone too,
 * so it is voided with them (audit TG-21).
 *
 * Cancelling is also what re-opens the idempotency gate: `alreadyScheduled`
 * only counts QUEUED/SENT/DELIVERED/READ, so flipping the stale rows to
 * CANCELLED lets the same (patient, appointment, template) tuple be
 * materialised again against the new time.
 */
export async function cancelPendingAppointmentReminders(
  appointmentId: string,
): Promise<{ cancelled: number }> {
  const res = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.updateMany({
      where: {
        appointmentId,
        status: "QUEUED",
        template: {
          trigger: {
            in: ["APPOINTMENT_BEFORE", "APPOINTMENT_CREATED", "APPOINTMENT_RESCHEDULED"],
          },
        },
      },
      data: {
        status: "CANCELLED",
        failedReason: "appointment rescheduled",
      },
    }),
  );
  return { cancelled: res.count };
}

/** Statuses that never tell the patient «приём перенесён». */
const RESCHEDULE_SILENT_STATUSES: ReadonlySet<string> = new Set([
  "CANCELLED",
  "NO_SHOW",
  "COMPLETED",
]);

/**
 * Full reschedule fan-out: tell the patient the new time, then rebuild the
 * reminder cascade around it.
 *
 * Order matters. The stale rows are cancelled FIRST so the idempotency gate
 * sees a clean slate when `scheduleAppointmentReminders` re-materialises; if
 * we rebuilt first, every band would be skipped as "already scheduled" and the
 * patient would be left with only the old-time reminders.
 */
export async function onAppointmentRescheduled(
  appointmentId: string,
): Promise<void> {
  // AP-10 — a visit that is over, cancelled or missed has no time to move to.
  // A cancelled block dragged on the calendar used to send «Ваш приём
  // перенесён на 15:00» for a visit the patient had cancelled. The PATCH now
  // refuses such moves; this keeps every other caller honest too.
  const current = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { status: true },
    }),
  );
  if (!current || RESCHEDULE_SILENT_STATUSES.has(current.status)) return;
  await cancelPendingAppointmentReminders(appointmentId);
  // Immediate "your appointment moved" notice, rendered against the already
  // persisted (new) row — so the body names the new date/time.
  await materializeForAppointment(
    appointmentId,
    "appointment.rescheduled",
    new Date(),
  );
  await scheduleAppointmentReminders(appointmentId);
}

/**
 * Scheduler tick: materialise reminders whose time is approaching. Also
 * runs birthday and payment.due triggers once per tick.
 *
 * TZ-risk-outcomes §7 — canonical bands are 5d / 3d / 1d / 3h.
 * Each appointment falling inside a band is materialised exactly once per
 * (appointmentId, templateId); a second tick that lands in the same band
 * collapses to a no-op via the unique index. Band edges are slightly wider
 * than the tick cadence (60s) so a tick that runs late doesn't skip a row.
 */
export async function runScheduledTriggers(): Promise<{
  reminders5d: number;
  reminders3d: number;
  reminders1d: number;
  reminders3h: number;
  birthdays: number;
  paymentsDue: number;
  caseRepeats: number;
}> {
  const now = new Date();
  const HOUR_MS = 60 * 60 * 1000;
  // Only the four one-hour band windows are read (audit TG-13). The query
  // used to pull every visit of the next 121 hours with `take: 500` and no
  // order, so on a busy week the rows of a band could fall outside the
  // arbitrary 500 and the reminder was never built.
  const bandWindow = (hours: number) => ({
    date: {
      gt: new Date(now.getTime() + (hours - 1) * HOUR_MS),
      lte: new Date(now.getTime() + hours * HOUR_MS),
    },
  });

  const rows = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        OR: [bandWindow(120), bandWindow(72), bandWindow(24), bandWindow(3)],
        // CONFIRMED too (audit TG-03): every PHONE / KIOSK booking is
        // confirmed at creation and still needs its 5d / 1d / 3h reminders.
        // The T-3d band drops confirmed visits in the materialiser.
        status: { in: ["BOOKED", "CONFIRMED", "WAITING"] },
      },
      select: { id: true, date: true, confirmedAt: true },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      // Four hours of visits across every clinic: far above any real load.
      take: 5000,
    }),
  );

  // Bands chosen so a 60s tick comfortably covers each window:
  //   - 119–120h before → 5d reminder (NEW — TZ-risk-outcomes §7)
  //   -  71–72h  before → 3d reminder (restored to canon)
  //   -  23–24h  before → 1d reminder
  //   -   2–3h   before → 3h reminder (final "leaving soon")
  const jobs5d: Array<{ appointmentId: string; scheduledFor: Date }> = [];
  const jobs3d: Array<{ appointmentId: string; scheduledFor: Date }> = [];
  const jobs1d: Array<{ appointmentId: string; scheduledFor: Date }> = [];
  const jobs3h: Array<{ appointmentId: string; scheduledFor: Date }> = [];
  for (const r of rows) {
    const start = r.date.getTime();
    const until = start - now.getTime();
    if (until > 0 && until <= 120 * 60 * 60 * 1000 && until > 119 * 60 * 60 * 1000) {
      jobs5d.push({
        appointmentId: r.id,
        scheduledFor: new Date(start - 120 * 60 * 60 * 1000),
      });
    }
    if (until > 0 && until <= 72 * 60 * 60 * 1000 && until > 71 * 60 * 60 * 1000) {
      jobs3d.push({
        appointmentId: r.id,
        scheduledFor: new Date(start - 72 * 60 * 60 * 1000),
      });
    }
    if (until > 0 && until <= 24 * 60 * 60 * 1000 && until > 23 * 60 * 60 * 1000) {
      jobs1d.push({
        appointmentId: r.id,
        scheduledFor: new Date(start - 24 * 60 * 60 * 1000),
      });
    }
    if (until > 0 && until <= 3 * 60 * 60 * 1000 && until > 2 * 60 * 60 * 1000) {
      jobs3h.push({
        appointmentId: r.id,
        scheduledFor: new Date(start - 3 * 60 * 60 * 1000),
      });
    }
  }
  const [res5d, res3d, res1d, res3h] = await Promise.all([
    materializeForAppointmentsBulk(jobs5d, "appointment.reminder-5d"),
    materializeForAppointmentsBulk(jobs3d, "appointment.reminder-3d"),
    materializeForAppointmentsBulk(jobs1d, "appointment.reminder-24h"),
    materializeForAppointmentsBulk(jobs3h, "appointment.reminder-3h"),
  ]);
  const reminders5d = res5d.created;
  const reminders3d = res3d.created;
  const reminders1d = res1d.created;
  const reminders3h = res3h.created;

  const birthdays = await runBirthdays(now);
  const paymentsDue = await runPaymentsDue(now);
  const caseRepeats = await runCaseRepeatReminders(now);
  return {
    reminders5d,
    reminders3d,
    reminders1d,
    reminders3h,
    birthdays,
    paymentsDue,
    caseRepeats,
  };
}

/** Birthday greetings go out from this clinic-local hour on (09:00). */
const BIRTHDAY_LOCAL_HOUR = 9;

/**
 * Clinic id → the local day its birthday pass already ran for. The pass is
 * daily work: it used to scan up to 2 000 patient cards of every clinic every
 * minute and filter the birthdays in memory, so in a clinic with more cards
 * the greeting reached only whoever sat in the first 2 000 rows (audit
 * TG-13). Process memory is enough: a restart re-runs the day, and the
 * per-patient dedupe below makes that a no-op.
 */
const birthdayPassDone = new Map<string, string>();

/** Test hook: forget which clinics already ran today. */
export function __resetBirthdayPassForTests(): void {
  birthdayPassDone.clear();
}

/** Calendar parts of `now` on the wall clock of `tz`. */
export function localDayParts(
  now: Date,
  tz: string,
): { ymd: string; year: number; month: number; day: number; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: tz,
    }).formatToParts(now);
  } catch {
    return localDayParts(now, "Asia/Tashkent");
  }
  const pick = (t: string) =>
    Number.parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  return {
    ymd: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    year,
    month,
    day,
    hour: pick("hour"),
  };
}

/**
 * Birth days (UTC month/day, as birth dates are stored) greeted on a local
 * calendar day. 29 February birthdays are greeted on 28 February when the
 * year has no 29th, rather than never.
 */
export function birthdayDaysFor(
  year: number,
  month: number,
  day: number,
): { month: number; days: number[] } {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (month === 2 && day === 28 && !leap) return { month: 2, days: [28, 29] };
  return { month, days: [day] };
}

async function runBirthdays(now: Date = new Date()): Promise<number> {
  // Templates first: without an active birthday template the pass costs one
  // query instead of a scan of the patient table.
  const tpls = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationTemplate.findMany({
      where: { trigger: "PATIENT_BIRTHDAY", isActive: true },
      select: {
        id: true,
        clinicId: true,
        bodyRu: true,
        bodyUz: true,
        channel: true,
      },
      // The same pick as the dispatcher's (audit TG-22).
      orderBy: TEMPLATE_PICK_ORDER,
    }),
  );
  if (tpls.length === 0) return 0;
  const tplByClinic = new Map<string, (typeof tpls)[number]>();
  for (const t of tpls) if (!tplByClinic.has(t.clinicId)) tplByClinic.set(t.clinicId, t);

  const clinics = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.clinic.findMany({
      where: { id: { in: Array.from(tplByClinic.keys()) } },
      select: {
        id: true,
        nameRu: true,
        nameUz: true,
        phone: true,
        addressRu: true,
        addressUz: true,
        timezone: true,
      },
    }),
  );

  let created = 0;
  for (const clinic of clinics) {
    const tpl = tplByClinic.get(clinic.id);
    if (!tpl) continue;
    const local = localDayParts(now, clinic.timezone || "Asia/Tashkent");
    // The clinic's own day and hour: on UTC the day turned at 05:00 in
    // Tashkent and greetings went out at five in the morning.
    if (local.hour < BIRTHDAY_LOCAL_HOUR) continue;
    if (birthdayPassDone.get(clinic.id) === local.ymd) continue;

    const { month, days } = birthdayDaysFor(local.year, local.month, local.day);
    const d1 = days[0]!;
    const d2 = days[days.length - 1]!;
    // Month and day in SQL. Marketing consent and soft delete as well (the
    // consent gate is re-checked below). A year-only birth date is stored as
    // 1 January 00:00 UTC (`birthDateFromYear`): the doctor gave a year, so
    // nobody is congratulated on a date we made up.
    const ids = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Patient"
        WHERE "clinicId" = ${clinic.id}
          AND "deletedAt" IS NULL
          AND "marketingOptOut" = false
          AND "birthDate" IS NOT NULL
          AND EXTRACT(MONTH FROM "birthDate")::int = ${month}::int
          AND EXTRACT(DAY FROM "birthDate")::int IN (${d1}::int, ${d2}::int)
          AND NOT (
            EXTRACT(MONTH FROM "birthDate")::int = 1
            AND EXTRACT(DAY FROM "birthDate")::int = 1
            AND "birthDate"::time = TIME '00:00:00'
          )`,
    );

    if (ids.length > 0) {
      const patients = await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.patient.findMany({
          where: { clinicId: clinic.id, id: { in: ids.map((r) => r.id) } },
          select: {
            id: true,
            fullName: true,
            phone: true,
            telegramId: true,
            preferredLang: true,
            marketingOptOut: true,
            deletedAt: true,
          },
        }),
      );
      // One greeting per birthday: a row from the last ~10 months is this
      // year's. Without the window the first greeting blocked every later
      // birthday for good.
      const since = new Date(now.getTime() - 300 * 24 * 60 * 60 * 1000);
      const existing = await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.notificationSend.findMany({
          where: {
            clinicId: clinic.id,
            patientId: { in: patients.map((p) => p.id) },
            templateId: tpl.id,
            appointmentId: null,
            status: { in: [...LIVE_SEND_STATUSES] },
            createdAt: { gte: since },
          },
          select: { patientId: true },
        }),
      );
      const greeted = new Set(existing.map((e) => e.patientId));

      const toInsert: Array<Record<string, unknown>> = [];
      for (const p of patients) {
        if (greeted.has(p.id)) continue;
        if (!isAllowedToReceive(p, "marketing").allowed) continue;
        const channel = tpl.channel as "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
        const recipient = pickRecipient(channel, p);
        if (!recipient) continue;
        const lang = patientLang(p) === "uz" && tpl.bodyUz.trim() !== "" ? "uz" : "ru";
        const body = render(lang === "uz" ? tpl.bodyUz : tpl.bodyRu, {
          patient: {
            name: p.fullName,
            firstName: firstName(p.fullName),
            phone: p.phone,
          },
          clinic: clinicContext(clinic, lang),
        });
        toInsert.push({
          clinicId: clinic.id,
          patientId: p.id,
          appointmentId: null,
          templateId: tpl.id,
          channel,
          recipient,
          body,
          scheduledFor: now,
          status: "QUEUED",
        });
      }
      if (toInsert.length > 0) {
        await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.notificationSend.createMany({
            data: toInsert as never,
            skipDuplicates: true,
          }),
        );
        created += toInsert.length;
      }
    }
    birthdayPassDone.set(clinic.id, local.ymd);
  }
  return created;
}

/** How far back an unpaid visit still gets its one payment.due reminder. */
const PAYMENT_DUE_LOOKBACK_DAYS = 7;

/**
 * The debt a payment.due message may name, тийин, or null for «no message».
 * The visit must be short of its price by the payments filed under it, and
 * the patient must owe money overall: a deposit taken on the «Оплаты» tab
 * belongs to no visit but settles it all the same. Never more than either.
 */
export function paymentDueAmount(input: {
  priceFinal: number;
  paidOnVisit: number;
  patientDebt: number | null;
}): number | null {
  const visitDue = input.priceFinal - input.paidOnVisit;
  if (visitDue <= 0) return null;
  if (input.patientDebt === null || input.patientDebt <= 0) return null;
  return Math.min(visitDue, input.patientDebt);
}

/**
 * payment.due — one reminder per visit that is still unpaid a day after it
 * was completed (audit TG-13).
 *
 * Only in clinics that record payments in the CRM (`paymentsTrackedSince`)
 * and only for visits completed since then: elsewhere every visit looks
 * unpaid and the patient would be told they owe the full price. The pass
 * used to load 500 arbitrary COMPLETED visits a minute with no unpaid filter
 * and no order, and rendered «сумма к оплате: » with an empty amount.
 */
async function runPaymentsDue(now: Date = new Date()): Promise<number> {
  const tpls = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationTemplate.findMany({
      where: { key: "payment.due", isActive: true },
      select: { id: true, clinicId: true },
    }),
  );
  if (tpls.length === 0) return 0;
  const tplIdsByClinic = new Map<string, string[]>();
  for (const t of tpls) {
    tplIdsByClinic.set(t.clinicId, [...(tplIdsByClinic.get(t.clinicId) ?? []), t.id]);
  }

  const clinics = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.clinic.findMany({
      where: {
        id: { in: Array.from(tplIdsByClinic.keys()) },
        paymentsTrackedSince: { not: null },
      },
      select: { id: true, paymentsTrackedSince: true },
    }),
  );

  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lookback = new Date(
    now.getTime() - PAYMENT_DUE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  const jobs: Array<{ appointmentId: string; scheduledFor: Date; paymentAmount: number }> = [];

  for (const clinic of clinics) {
    const since = clinic.paymentsTrackedSince!;
    const from = since.getTime() > lookback.getTime() ? since : lookback;
    if (from.getTime() >= cutoff.getTime()) continue;
    const visits = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.appointment.findMany({
        where: {
          clinicId: clinic.id,
          status: "COMPLETED",
          completedAt: { gte: from, lte: cutoff },
          priceFinal: { gt: 0 },
        },
        select: {
          id: true,
          patientId: true,
          priceFinal: true,
          payments: {
            where: { status: "PAID" },
            select: { amount: true, refundedAmount: true, currency: true, fxRate: true },
          },
        },
        orderBy: [{ completedAt: "asc" }, { id: "asc" }],
        take: 2000,
      }),
    );
    if (visits.length === 0) continue;

    // Visits already reminded drop out before any per-patient work.
    const reminded = new Set(
      (
        await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.notificationSend.findMany({
            where: {
              appointmentId: { in: visits.map((v) => v.id) },
              templateId: { in: tplIdsByClinic.get(clinic.id) ?? [] },
              status: { in: [...LIVE_SEND_STATUSES] },
            },
            select: { appointmentId: true },
          }),
        )
      ).map((r) => r.appointmentId),
    );
    const fresh = visits.filter((v) => !reminded.has(v.id));
    if (fresh.length === 0) continue;

    const rate = (
      await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.exchangeRate.findFirst({
          where: { clinicId: clinic.id },
          orderBy: { date: "desc" },
          select: { rateUsd: true },
        }),
      )
    )?.rateUsd ?? null;
    const debtByPatient = new Map<string, number | null>();
    for (const v of fresh) {
      const paidOnVisit = paidNetTiyin(v.payments, rate);
      if ((v.priceFinal ?? 0) - paidOnVisit <= 0) continue;
      if (!debtByPatient.has(v.patientId)) {
        const finance = await runWithTenant({ kind: "SYSTEM" }, () =>
          loadPatientFinance(clinic.id, v.patientId),
        );
        debtByPatient.set(v.patientId, finance.debt);
      }
      const amount = paymentDueAmount({
        priceFinal: v.priceFinal ?? 0,
        paidOnVisit,
        patientDebt: debtByPatient.get(v.patientId) ?? null,
      });
      if (amount === null) continue;
      jobs.push({ appointmentId: v.id, scheduledFor: now, paymentAmount: amount });
    }
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
 *   1. Load, page by page, the OPEN cases that can still be in a window: a
 *      live visit on a free-repeat service within the longest window, and
 *      no reminder on file yet (both in SQL, audit TG-13: the pass used to
 *      load 2 000 arbitrary open cases with every visit and filter in JS).
 *   2. For each case, find the chronological first visit (date asc) and
 *      pull its primary service's `freeRepeatDays`. If null → skip.
 *   3. Compute deadline = firstVisit.date + freeRepeatDays * 24h.
 *      Reminder fires when `now` is inside
 *      `[deadline - daysBefore * 24h, deadline)`.
 *   4. Skip if the case has any future BOOKED/CONFIRMED/WAITING appointment
 *      after the first visit — the patient is already coming back.
 *   5. Materialize the row (TG via channel resolver + parallel INAPP
 *      for TG-using patients), in the patient's language with the clinic's
 *      real name and phone (audit TG-14: they used to render empty).
 *
 * `daysBefore` defaults to 2; admins can override via the template's
 * `triggerConfig.daysBefore` in /crm/settings/notifications.
 */
type CaseRepeatTpl = {
  id: string;
  clinicId: string;
  channel: "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
  bodyRu: string;
  bodyUz: string;
  triggerConfig: unknown;
};

type CaseRepeatClinic = {
  id: string;
  nameRu: string;
  nameUz: string;
  phone: string | null;
  addressRu: string | null;
  addressUz: string | null;
  timezone: string;
};

type CaseRepeatCase = {
  id: string;
  clinicId: string;
  patientId: string;
  patient: {
    fullName: string;
    phone: string;
    telegramId: string | null;
    preferredChannel: string;
    preferredLang: "RU" | "UZ";
  };
  appointments: Array<{
    id: string;
    date: Date;
    status: string;
    primaryService: { freeRepeatDays: number | null } | null;
  }>;
};

async function runCaseRepeatReminders(now: Date = new Date()): Promise<number> {
  type TplRow = CaseRepeatTpl;
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
      orderBy: TEMPLATE_PICK_ORDER,
    }),
  )) as TplRow[];
  if (templates.length === 0) return 0;

  const tplByClinic = new Map<string, TplRow>();
  for (const t of templates) {
    if (!tplByClinic.has(t.clinicId)) tplByClinic.set(t.clinicId, t);
  }
  const clinicIds = Array.from(tplByClinic.keys());
  const tplIds = templates.map((t) => t.id);

  // The longest free-repeat window bounds how old a first visit can be.
  const longest = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.service.aggregate({
      where: { clinicId: { in: clinicIds }, freeRepeatDays: { gt: 0 } },
      _max: { freeRepeatDays: true },
    }),
  );
  const maxDays = longest._max.freeRepeatDays ?? 0;
  if (maxDays <= 0) return 0;

  const clinics = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.clinic.findMany({
      where: { id: { in: clinicIds } },
      select: {
        id: true,
        nameRu: true,
        nameUz: true,
        phone: true,
        addressRu: true,
        addressUz: true,
        timezone: true,
      },
    }),
  );
  const clinicById = new Map<string, CaseRepeatClinic>(clinics.map((c) => [c.id, c]));

  type CaseRow = CaseRepeatCase;

  const dayMs = 24 * 60 * 60 * 1000;
  const windowStart = new Date(now.getTime() - maxDays * dayMs);
  const PAGE = 500;
  let cursor: string | null = null;
  let created = 0;

  for (;;) {
    const page = (await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.medicalCase.findMany({
        where: {
          clinicId: { in: clinicIds },
          status: "OPEN",
          appointments: {
            some: {
              status: { notIn: ["CANCELLED", "NO_SHOW"] },
              date: { gte: windowStart },
              primaryService: { freeRepeatDays: { gt: 0 } },
            },
          },
          notificationSends: {
            none: {
              templateId: { in: tplIds },
              status: { in: [...LIVE_SEND_STATUSES] },
            },
          },
        },
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
              preferredLang: true,
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
        orderBy: { id: "asc" },
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    )) as CaseRow[];
    if (page.length === 0) break;
    created += await materializeCaseRepeats(page, tplByClinic, clinicById, now);
    if (page.length < PAGE) break;
    cursor = page[page.length - 1]!.id;
  }
  return created;
}

/** Build and insert the case-repeat rows of one page of cases. */
async function materializeCaseRepeats(
  cases: CaseRepeatCase[],
  tpls: Map<string, CaseRepeatTpl>,
  clinicsById: Map<string, CaseRepeatClinic>,
  at: Date,
): Promise<number> {
  const dayMs = 24 * 60 * 60 * 1000;
  type Insert = {
    clinicId: string;
    patientId: string;
    appointmentId: string | null;
    caseId: string;
    templateId: string;
    channel: "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
    recipient: string;
    body: string;
    scheduledFor: Date;
    status: "QUEUED";
  };
  const toInsert: Insert[] = [];

  for (const kase of cases) {
    const tpl = tpls.get(kase.clinicId);
    const clinic = clinicsById.get(kase.clinicId);
    if (!tpl || !clinic) continue;

    // First non-cancelled/no-show appointment determines the window anchor.
    const firstVisit = kase.appointments.find(
      (a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW",
    );
    if (!firstVisit) continue;
    const days = firstVisit.primaryService?.freeRepeatDays ?? null;
    if (!days || days <= 0) continue;

    // Skip if patient already has a future appointment in this case — they
    // are coming back, no nudge needed. CONFIRMED counts: every phone
    // booking is confirmed at creation.
    const hasFutureBooked = kase.appointments.some(
      (a) =>
        a.id !== firstVisit.id &&
        (a.status === "BOOKED" || a.status === "CONFIRMED" || a.status === "WAITING") &&
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

    const deadline = firstVisit.date.getTime() + days * dayMs;
    const fireFrom = deadline - daysBefore * dayMs;
    if (at.getTime() < fireFrom) continue;
    if (at.getTime() >= deadline) continue; // window already closed

    const recipient = pickRecipient(tpl.channel, kase.patient);
    if (!recipient) {
      // Wave 4 of `docs/TZ-sms-removal.md` — compensator for TG-less
      // patients on the case-repeat band. `firstVisit` is the anchor row,
      // not the upcoming visit (cases that already have a future booking
      // are skipped above), so we surface the case anchor date as the
      // appointment context instead.
      await recordPatientNoChannel({
        clinicId: kase.clinicId,
        patientId: kase.patientId,
        patientName: kase.patient.fullName,
        triggerKey: "case.repeat-due",
        appointmentId: firstVisit.id,
        appointmentAt: firstVisit.date,
      });
      continue;
    }

    const daysLeft = Math.max(1, Math.ceil((deadline - at.getTime()) / dayMs));
    const lang =
      patientLang(kase.patient) === "uz" && tpl.bodyUz.trim() !== "" ? "uz" : "ru";
    const body = render(lang === "uz" ? tpl.bodyUz : tpl.bodyRu, {
      patient: {
        name: kase.patient.fullName,
        firstName: firstName(kase.patient.fullName),
        phone: kase.patient.phone,
      },
      case: {
        daysLeft: String(daysLeft),
        deadline: formatDayMonth(
          new Date(deadline),
          lang,
          clinic.timezone || "Asia/Tashkent",
        ),
      },
      clinic: clinicContext(clinic, lang),
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
      scheduledFor: at,
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
        scheduledFor: at,
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
        preferredLang: true,
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
      select: { nameRu: true, nameUz: true, phone: true, addressRu: true, addressUz: true },
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
    // In the referrer's language, with the clinic named in it (audit
    // TG-23: always the Russian text and the Russian clinic name).
    const lang = patientLang(referrer) === "uz" && tpl.bodyUz.trim() !== "" ? "uz" : "ru";
    const ctx: Record<string, unknown> = {
      patient: {
        name: referrer.fullName,
        firstName: firstName(referrer.fullName),
      },
      friend: { name: friendName },
      percent: String(reward.rewardPercent),
      clinic: clinic ? clinicContext(clinic, lang) : { name: "", phone: "", address: "" },
    };
    const body = render(lang === "uz" ? tpl.bodyUz : tpl.bodyRu, ctx);
    const channel = tpl.channel as "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";

    const recipient = pickRecipient(channel, referrer);

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
  // The appointment's start moved. Distinct from `appointment.updated`, which
  // only tops up the cascade and cannot undo reminders already rendered
  // against the previous time.
  | { kind: "appointment.rescheduled"; appointmentId: string }
  | { kind: "appointment.updated"; appointmentId: string }
  // Auto-messages widget — fired when a visit lands in COMPLETED so the
  // patient gets a "Спасибо за визит". Best-effort + idempotent.
  | { kind: "appointment.completed"; appointmentId: string }
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
        case "appointment.rescheduled": {
          await onAppointmentRescheduled(payload.appointmentId);
          return;
        }
        case "appointment.updated": {
          // Non-move edits only. A time change must go through
          // `appointment.rescheduled` — this path cannot retract reminders
          // that were already rendered against the old slot.
          await scheduleAppointmentReminders(payload.appointmentId);
          return;
        }
        case "appointment.completed": {
          await onAppointmentThankYou(payload.appointmentId);
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

// Test-only exports of the scheduler's daily and per-tick passes.
export {
  runBirthdays as _runBirthdaysForTests,
  runPaymentsDue as _runPaymentsDueForTests,
  runCaseRepeatReminders as _runCaseRepeatRemindersForTests,
};
