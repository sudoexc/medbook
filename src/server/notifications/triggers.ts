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

import { render } from "./template";

export const TRIGGER_KEYS = [
  "appointment.created",
  "appointment.reminder-24h",
  "appointment.reminder-2h",
  "appointment.cancelled",
  "birthday",
  "no-show",
  "payment.due",
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
  channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT";
} | null;

async function findTemplateFor(
  clinicId: string,
  trigger: TriggerKey,
  lang: "ru" | "uz",
): Promise<FindTemplateResult> {
  const row = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationTemplate.findFirst({
      where: {
        clinicId,
        key: trigger,
        isActive: true,
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
      : "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT",
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
  channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT",
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
  channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT";
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
async function materializeForAppointmentsBulk(
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
    channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT";
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
): Promise<void> {
  await materializeForAppointment(
    appointmentId,
    "appointment.cancelled",
    new Date(),
  );
}

export async function onAppointmentNoShow(
  appointmentId: string,
): Promise<void> {
  await materializeForAppointment(appointmentId, "no-show", new Date());
}

/** Schedule 24h and 2h reminders for a just-created/updated appointment. */
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
  if (start - 2 * 60 * 60 * 1000 > now) {
    await materializeForAppointment(
      appointmentId,
      "appointment.reminder-2h",
      new Date(start - 2 * 60 * 60 * 1000),
    );
  }
}

/**
 * Scheduler tick: materialise reminders whose time is approaching. Also
 * runs birthday and payment.due triggers once per tick.
 */
export async function runScheduledTriggers(): Promise<{
  reminders24h: number;
  reminders2h: number;
  birthdays: number;
  paymentsDue: number;
}> {
  const now = new Date();
  // Select appointments in [now, now+25h] that are still BOOKED and lack
  // a queued reminder. We cap the horizon so we don't re-scan the whole
  // future every minute.
  const horizon = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const rows = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        date: { gte: now, lte: horizon },
        status: { in: ["BOOKED", "WAITING"] },
      },
      select: { id: true, date: true },
      take: 500,
    }),
  );

  // Two windows: appointments 23-24h out get 24h reminder, 1-2h out get 2h.
  // Bucket once, then materialize each bucket in a single bulk pass.
  const jobs24h: Array<{ appointmentId: string; scheduledFor: Date }> = [];
  const jobs2h: Array<{ appointmentId: string; scheduledFor: Date }> = [];
  for (const r of rows) {
    const start = r.date.getTime();
    const until = start - Date.now();
    if (until > 0 && until <= 24 * 60 * 60 * 1000 && until > 23 * 60 * 60 * 1000) {
      jobs24h.push({
        appointmentId: r.id,
        scheduledFor: new Date(start - 24 * 60 * 60 * 1000),
      });
    }
    if (until > 0 && until <= 2 * 60 * 60 * 1000 && until > 60 * 60 * 1000) {
      jobs2h.push({
        appointmentId: r.id,
        scheduledFor: new Date(start - 2 * 60 * 60 * 1000),
      });
    }
  }
  const [res24, res2] = await Promise.all([
    materializeForAppointmentsBulk(jobs24h, "appointment.reminder-24h"),
    materializeForAppointmentsBulk(jobs2h, "appointment.reminder-2h"),
  ]);
  const reminders24h = res24.created;
  const reminders2h = res2.created;

  const birthdays = await runBirthdays();
  const paymentsDue = await runPaymentsDue();
  return { reminders24h, reminders2h, birthdays, paymentsDue };
}

async function runBirthdays(): Promise<number> {
  // Find patients whose birthday (month + day) matches today. Idempotent
  // via template+patient+(no appointment)+status filter.
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const patients = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.patient.findMany({
      where: {
        birthDate: { not: null },
      },
      select: {
        id: true,
        clinicId: true,
        fullName: true,
        phone: true,
        telegramId: true,
        birthDate: true,
      },
      take: 2000,
    }),
  );
  // Filter to today's birthdays in memory, then bulk-materialize.
  const matches = patients.filter((p) => {
    if (!p.birthDate) return false;
    const bm = p.birthDate.getUTCMonth() + 1;
    const bd = p.birthDate.getUTCDate();
    return bm === month && bd === day;
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
    channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT";
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

// ─────────────────────────────────────────────────────────────────────────────
// Public dispatcher — single entry point for route handlers
// ─────────────────────────────────────────────────────────────────────────────

export type FireTriggerPayload =
  | { kind: "appointment.created"; appointmentId: string }
  | { kind: "appointment.cancelled"; appointmentId: string }
  | { kind: "appointment.noshow"; appointmentId: string }
  | { kind: "appointment.updated"; appointmentId: string }
  | { kind: "payment.paid"; appointmentId: string | null };

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
        case "appointment.cancelled": {
          await onAppointmentCancelled(payload.appointmentId);
          return;
        }
        case "appointment.noshow": {
          await onAppointmentNoShow(payload.appointmentId);
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
      }
    } catch (e) {
      console.error(`[triggers] fireTrigger(${payload.kind}) failed`, e);
    }
  };
  // Fire-and-forget: not awaited. In Node this runs on the next turn.
  void run();
}
