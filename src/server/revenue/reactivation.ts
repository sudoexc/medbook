/**
 * Reactivation Engine — Phase 14, Wave 2.
 *
 * Detect dormant patients, classify them into segments, and enqueue a
 * reactivation notification per patient — at most once per quarter per
 * patient.
 *
 * Segments (days since last visit):
 *   recent_lapse  90-180
 *   mid_lapse     180-365   (inclusive of 180 and 365)
 *   deep_lapse    >365
 *
 * Per-patient idempotency gate (skipped + reason):
 *   - already sent within the last 90 days  → "recently_sent"
 *   - patient has a future BOOKED/WAITING/IN_PROGRESS appointment → "has_upcoming"
 *   - never visited                          → "no_last_visit"
 *
 * Compliance gate (Phase 17 Wave 1):
 *   - Patients with `deletedAt != null` (Wave 3 DSAR scrubs) are skipped.
 *   - Patients with `marketingOptOut === true` are skipped — reactivation
 *     is marketing, not transactional. The previous Phase 14 LOG note
 *     ("no opt-out column today, proceed without gate") is now obsolete.
 *
 * Tenant context: SYSTEM-scoped reads, explicit clinicId in WHERE, mirrors
 * `triggers.ts` and the empty-slot engine.
 */
import type {
  AppointmentStatus,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import type { TenantScopedPrisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { isAllowedToReceive } from "@/server/notifications/consent-gate";
import { render } from "@/server/notifications/template";
import type { TriggerKey } from "@/server/notifications/triggers";

export type ReactivationSegment =
  | "recent_lapse"
  | "mid_lapse"
  | "deep_lapse";

export type ReactivationCandidate = {
  patientId: string;
  segment: ReactivationSegment;
  lastVisitAt: Date | null;
  daysSinceLastVisit: number;
};

const QUARTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Classify a number of days since last visit into a reactivation segment.
 * Returns null below the activation threshold (89 days or fewer).
 *
 *   <90  → null         (still active enough)
 *   90-179 → recent_lapse
 *   180-365 → mid_lapse  (inclusive on both ends)
 *   >365 → deep_lapse
 */
export function classifyLapse(
  daysSinceLastVisit: number,
): ReactivationSegment | null {
  if (!Number.isFinite(daysSinceLastVisit)) return null;
  if (daysSinceLastVisit < 90) return null;
  if (daysSinceLastVisit < 180) return "recent_lapse";
  if (daysSinceLastVisit <= 365) return "mid_lapse";
  return "deep_lapse";
}

/**
 * Pure helper. Decides whether the engine should send a reactivation to
 * this patient *right now*, based on the once-per-quarter gate.
 *
 *   - send=true if no entry in `lastSentAtList` is within `quarterDays`
 *     of `now` (inclusive — exactly 90 days ago counts as still in window
 *     to be safe; we reset on day 91).
 *   - send=false otherwise, with reason="recently_sent".
 */
export function shouldSendReactivation(input: {
  lastSentAtList: ReadonlyArray<Date>;
  now: Date;
  quarterDays?: number;
}): { send: boolean; reason?: string } {
  const window =
    input.quarterDays && input.quarterDays > 0
      ? input.quarterDays
      : QUARTER_DAYS;
  const cutoff = input.now.getTime() - window * DAY_MS;
  for (const ts of input.lastSentAtList) {
    if (ts.getTime() >= cutoff) {
      return { send: false, reason: "recently_sent" };
    }
  }
  return { send: true };
}

/**
 * Accept either the raw `PrismaClient` (used by ops scripts) or the
 * tenant-scoped wrapper (production code path).
 */
type PrismaLike = TenantScopedPrisma | PrismaClient;

type PatientRow = {
  id: string;
  lastVisitAt: Date | null;
  reactivationSentAt: Date[];
  dormantSince: Date | null;
  marketingOptOut: boolean | null;
  deletedAt: Date | null;
};

/**
 * Pure helper: which appointment statuses count as "still on the books"
 * for the purposes of skipping reactivation. The reactivation engine
 * excludes any patient with a future appointment in one of these states.
 */
function activeApptStatuses(): AppointmentStatus[] {
  return ["BOOKED", "WAITING", "IN_PROGRESS"];
}

export async function findReactivationCandidates(
  prisma: PrismaLike,
  clinicId: string,
  now: Date,
): Promise<ReactivationCandidate[]> {
  // Fetch every dormant-eligible patient. We pull on `lastVisitAt`
  // strictly older than 90 days; `lastVisitAt = null` (never visited)
  // is excluded by definition — those are leads, not lapsed patients.
  const cutoff = new Date(now.getTime() - 90 * DAY_MS);
  // Phase 17 Wave 1 — exclude opted-out + soft-deleted patients at the
  // SQL layer so the in-memory loop below doesn't bother classifying
  // them. `marketingOptOut` defaults to `false` for legacy rows so the
  // semantics are correct for both fresh and existing data.
  const patients = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.patient.findMany({
      where: {
        clinicId,
        lastVisitAt: { lt: cutoff, not: null },
        marketingOptOut: false,
        deletedAt: null,
      },
      select: {
        id: true,
        lastVisitAt: true,
        reactivationSentAt: true,
        dormantSince: true,
        marketingOptOut: true,
        deletedAt: true,
      },
    }),
  )) as PatientRow[];
  if (patients.length === 0) return [];

  // Exclude patients with a future "still on the books" appointment.
  const ids = patients.map((p) => p.id);
  const futureRows = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        clinicId,
        patientId: { in: ids },
        date: { gt: now },
        status: { in: activeApptStatuses() },
      },
      select: { patientId: true },
    }),
  )) as Array<{ patientId: string }>;
  const futureSet = new Set(futureRows.map((r) => r.patientId));

  const out: ReactivationCandidate[] = [];
  for (const p of patients) {
    if (!p.lastVisitAt) continue;
    if (futureSet.has(p.id)) continue;
    const days = Math.floor(
      (now.getTime() - p.lastVisitAt.getTime()) / DAY_MS,
    );
    const segment = classifyLapse(days);
    if (!segment) continue;
    out.push({
      patientId: p.id,
      segment,
      lastVisitAt: p.lastVisitAt,
      daysSinceLastVisit: days,
    });
  }
  return out;
}

/**
 * Side-effecting: schedule a reactivation send for one candidate.
 *
 *   - Honors the once-per-quarter gate via `shouldSendReactivation`.
 *   - On scheduling: appends `now` to `Patient.reactivationSentAt`,
 *     stamps `dormantSince` if currently null (with the lapse start
 *     date — i.e. `lastVisitAt + 90d`).
 *   - Looks up an active `NotificationTemplate` whose `key` matches the
 *     reactivation trigger and creates a `NotificationSend` row in
 *     status QUEUED. If no template is configured for the clinic, we
 *     record the side-effect on Patient anyway so the operator can
 *     inspect the queue and we don't loop the same patient daily.
 *
 * Returns `{ scheduled, reason? }` for the caller to aggregate.
 */
export async function enqueueReactivationFor(
  prisma: PrismaLike,
  clinicId: string,
  candidate: ReactivationCandidate,
): Promise<{ scheduled: boolean; reason?: string }> {
  const now = new Date();

  const patient = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.patient.findUnique({
      where: { id: candidate.patientId },
      select: {
        id: true,
        clinicId: true,
        fullName: true,
        phone: true,
        telegramId: true,
        preferredChannel: true,
        reactivationSentAt: true,
        dormantSince: true,
        lastVisitAt: true,
        marketingOptOut: true,
        deletedAt: true,
      },
    }),
  )) as
    | {
        id: string;
        clinicId: string;
        fullName: string;
        phone: string;
        telegramId: string | null;
        preferredChannel: string;
        reactivationSentAt: Date[];
        dormantSince: Date | null;
        lastVisitAt: Date | null;
        marketingOptOut: boolean | null;
        deletedAt: Date | null;
      }
    | null;
  if (!patient || patient.clinicId !== clinicId) {
    return { scheduled: false, reason: "patient_not_found" };
  }

  // Phase 17 Wave 1 — defensive consent check at the enqueue boundary.
  // Reactivation is `marketing`. The candidate query already filters
  // these out, but a race (e.g. patient opts out between scan and
  // enqueue) would otherwise sneak past.
  const consent = isAllowedToReceive(patient, "marketing");
  if (!consent.allowed) {
    return { scheduled: false, reason: consent.reason };
  }

  const gate = shouldSendReactivation({
    lastSentAtList: patient.reactivationSentAt ?? [],
    now,
  });
  if (!gate.send) return { scheduled: false, reason: gate.reason };

  // Look up the reactivation template for this clinic. Bodies live in the
  // DB so the template engine — not i18n message files — owns the strings.
  const trigger: TriggerKey = "patient.reactivation";
  type TplRow = {
    id: string;
    bodyRu: string;
    bodyUz: string;
    channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
  };
  const tpl = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationTemplate.findFirst({
      where: {
        clinicId,
        isActive: true,
        key: trigger,
      },
      select: { id: true, bodyRu: true, bodyUz: true, channel: true },
    }),
  )) as TplRow | null;

  // Stamp Patient regardless of template availability so we don't re-pick
  // the patient on every tick when no template is configured. The operator
  // sees the dormancy and creates the template; the next quarter the
  // engine fires a real send.
  const dormantSinceUpdate =
    patient.dormantSince ?? deriveDormantSince(patient.lastVisitAt);

  if (!tpl) {
    await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.patient.update({
        where: { id: patient.id },
        data: {
          reactivationSentAt: { push: now },
          dormantSince: dormantSinceUpdate,
        } as Prisma.PatientUpdateInput,
      }),
    );
    return { scheduled: false, reason: "no_template" };
  }

  // Pick a recipient compatible with the template's channel.
  const recipient =
    tpl.channel === "TG"
      ? patient.telegramId
      : tpl.channel === "INAPP"
        ? patient.id
        : patient.phone;
  if (!recipient) {
    // Still mark as "sent" so we don't retry the same patient every day.
    await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.patient.update({
        where: { id: patient.id },
        data: {
          reactivationSentAt: { push: now },
          dormantSince: dormantSinceUpdate,
        } as Prisma.PatientUpdateInput,
      }),
    );
    return { scheduled: false, reason: "no_recipient" };
  }

  const body = render(tpl.bodyRu, {
    patient: {
      name: patient.fullName,
      firstName: firstName(patient.fullName),
      phone: patient.phone,
    },
    clinic: { name: "", phone: "", address: "" },
  });

  // Cast tx through a structural type so the engine accepts both the raw
  // PrismaClient and the tenant-scoped wrapper.
  type Tx = Prisma.TransactionClient;
  await runWithTenant({ kind: "SYSTEM" }, () =>
    (prisma as PrismaClient).$transaction(async (tx: Tx) => {
      await tx.notificationSend.create({
        data: {
          clinicId,
          patientId: patient.id,
          appointmentId: null,
          templateId: tpl.id,
          channel: tpl.channel,
          recipient,
          body,
          scheduledFor: now,
          status: "QUEUED",
        } as Prisma.NotificationSendUncheckedCreateInput,
      });
      // Mirror to INAPP for TG-using patients (same rationale as the
      // appointment-reminder cascade — free secondary touch).
      if (
        patient.telegramId &&
        tpl.channel !== "INAPP" &&
        tpl.channel !== "VISIT" &&
        tpl.channel !== "CALL"
      ) {
        await tx.notificationSend.create({
          data: {
            clinicId,
            patientId: patient.id,
            appointmentId: null,
            templateId: tpl.id,
            channel: "INAPP",
            recipient: patient.id,
            body,
            scheduledFor: now,
            status: "QUEUED",
          } as Prisma.NotificationSendUncheckedCreateInput,
        });
      }
      await tx.patient.update({
        where: { id: patient.id },
        data: {
          reactivationSentAt: { push: now },
          dormantSince: dormantSinceUpdate,
        } as Prisma.PatientUpdateInput,
      });
    }),
  );

  return { scheduled: true };
}

function firstName(full: string): string {
  const trimmed = full.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

/**
 * Derive a `dormantSince` value from `lastVisitAt`. We define it as
 * `lastVisitAt + 90d` — the date the patient first crossed the activation
 * threshold. Pure for testing.
 */
export function deriveDormantSince(
  lastVisitAt: Date | null | undefined,
): Date | null {
  if (!lastVisitAt) return null;
  return new Date(lastVisitAt.getTime() + 90 * DAY_MS);
}

/**
 * Top-level scheduler: enumerate candidates, gate each one, and write
 * the side effects. Returns aggregate counts for logging.
 */
export async function runReactivationScheduler(
  prisma: PrismaLike,
  clinicId: string,
  now: Date,
): Promise<{ scanned: number; scheduled: number; skipped: number }> {
  const candidates = await findReactivationCandidates(prisma, clinicId, now);
  let scheduled = 0;
  let skipped = 0;
  for (const c of candidates) {
    try {
      const res = await enqueueReactivationFor(prisma, clinicId, c);
      if (res.scheduled) scheduled += 1;
      else skipped += 1;
    } catch (e) {
      // One bad patient row shouldn't kill the whole clinic pass.
      console.error(
        `[reactivation] clinic=${clinicId} patient=${c.patientId} failed`,
        e,
      );
      skipped += 1;
    }
  }
  return { scanned: candidates.length, scheduled, skipped };
}

// Re-export for tests
export const __INTERNALS__ = { QUARTER_DAYS, DAY_MS };
