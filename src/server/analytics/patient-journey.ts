/**
 * «Путь пациента» on the owner analytics page: how many patients came for
 * the first time, how many visits were repeat ones, the average check.
 *
 * The strip used to derive all of this in the browser from numbers that
 * mean something else: completed visits fell back to `total × 0.62`, repeat
 * visits were completed × the share of medical CASES with more than one
 * visit, first consultations were the remainder, and new patients were
 * `max(all open cases ever, first consultations × 0.76)`. A week with five
 * new patients showed 38 (audit AN-15). Every number here is a count over
 * real rows, so each one can be checked with a query.
 *
 * Definitions (window [from, to), Tashkent days via resolveAnalyticsRange;
 * a doctor sees only their own visits, so «first» means first with them):
 *   visits        COMPLETED appointments dated in the window;
 *   newPatients   patients whose first COMPLETED visit in scope falls in the
 *                 window (no COMPLETED visit before `from`). Each of them
 *                 has exactly one first visit, the rest are repeat visits;
 *   repeatVisits  visits − newPatients, i.e. visits whose ordinal number
 *                 for that patient is 2 or more;
 *   repeatPct     repeatVisits / visits, in percent;
 *   avgCheck      PAID payments filed under those visits / visits that have
 *                 one. Null when none has: an average of nothing is not
 *                 zero.
 *
 * Money only counts once the clinic records every payment in the CRM
 * (Clinic.paymentsTrackedSince, see paymentsRecordedSince). Until then the
 * few payments a receptionist happened to enter (a card payment here and
 * there) would pass for the clinic's average check, so the strip says that
 * payments are not recorded instead (`paymentsTracked: false`).
 *
 * Soft-deleted patients are left out, like everywhere else in analytics.
 *
 * Checking the strip by hand (clinic scope; add `AND a."doctorId" = …` and
 * `AND b."doctorId" = …` for a doctor):
 *   visits       SELECT count(*) FROM "Appointment" a
 *                  JOIN "Patient" p ON p.id = a."patientId"
 *                 WHERE a."clinicId" = $c AND a.status = 'COMPLETED'
 *                   AND p."deletedAt" IS NULL
 *                   AND a.date >= $from AND a.date < $to;
 *   newPatients  SELECT count(DISTINCT a."patientId") … same WHERE …
 *                   AND NOT EXISTS (SELECT 1 FROM "Appointment" b
 *                     WHERE b."patientId" = a."patientId"
 *                       AND b.status = 'COMPLETED' AND b.date < $from);
 */
import type { prisma } from "@/lib/prisma";

export interface JourneyVisitInput {
  patientId: string;
  /** Sum of the PAID payments filed under this visit (0 when none). */
  paidAmount: number;
  /** Whether at least one PAID payment is filed under this visit. */
  paid: boolean;
}

export interface PatientJourney {
  /** Whether the clinic records payments in the CRM (money cards shown). */
  paymentsTracked: boolean;
  visits: number;
  patients: number;
  newPatients: number;
  repeatVisits: number;
  /** Percent, one decimal. 0 when there are no visits. */
  repeatPct: number;
  paidVisits: number;
  /** Average PAID amount per paid visit (tiins), null when no visit is paid. */
  avgCheck: number | null;
}

export const EMPTY_JOURNEY: PatientJourney = {
  paymentsTracked: false,
  visits: 0,
  patients: 0,
  newPatients: 0,
  repeatVisits: 0,
  repeatPct: 0,
  paidVisits: 0,
  avgCheck: null,
};

/**
 * The strip's numbers from the window's completed visits and the patients
 * among them who already had a completed visit (in scope) before it.
 */
export function computePatientJourney(input: {
  visits: ReadonlyArray<JourneyVisitInput>;
  returningPatientIds: Iterable<string>;
  paymentsTracked: boolean;
}): PatientJourney {
  const { paymentsTracked } = input;
  const visits = input.visits.length;
  if (visits === 0) return { ...EMPTY_JOURNEY, paymentsTracked };

  const patientIds = new Set(input.visits.map((v) => v.patientId));
  const returning = new Set(input.returningPatientIds);
  let newPatients = 0;
  for (const id of patientIds) if (!returning.has(id)) newPatients += 1;

  const repeatVisits = visits - newPatients;
  let paidVisits = 0;
  let paidSum = 0;
  for (const v of input.visits) {
    if (!paymentsTracked || !v.paid) continue;
    paidVisits += 1;
    paidSum += v.paidAmount;
  }

  return {
    paymentsTracked,
    visits,
    patients: patientIds.size,
    newPatients,
    repeatVisits,
    repeatPct: Math.round((repeatVisits / visits) * 1000) / 10,
    paidVisits,
    avgCheck: paidVisits > 0 ? Math.round(paidSum / paidVisits) : null,
  };
}

/** The slice of the Prisma client the loader reads (tenant-scoped). */
export type JourneyDb = Pick<typeof prisma, "appointment">;

/**
 * Two queries: the window's completed visits (with their PAID payments),
 * then which of those patients had a completed visit before the window.
 * Tenant scope comes from the caller's Prisma client.
 */
export async function loadPatientJourney(
  db: JourneyDb,
  opts: {
    from: Date;
    to: Date;
    doctorId: string | null;
    paymentsTracked: boolean;
  },
): Promise<PatientJourney> {
  const scope = opts.doctorId ? { doctorId: opts.doctorId } : {};

  const rows = await db.appointment.findMany({
    where: {
      status: "COMPLETED",
      date: { gte: opts.from, lt: opts.to },
      patient: { deletedAt: null },
      ...scope,
    },
    select: {
      patientId: true,
      payments: {
        where: { status: "PAID" },
        select: { amount: true, refundedAmount: true },
      },
    },
  });

  const visits: JourneyVisitInput[] = rows.map((r) => ({
    patientId: r.patientId,
    paid: r.payments.length > 0,
    // Net of a partial refund (audit AN-11); a fully refunded payment is
    // REFUNDED and not counted at all.
    paidAmount: r.payments.reduce(
      (sum, p) => sum + Math.max(0, p.amount - (p.refundedAmount ?? 0)),
      0,
    ),
  }));

  const patientIds = [...new Set(visits.map((v) => v.patientId))];
  const returning =
    patientIds.length > 0
      ? await db.appointment.findMany({
          where: {
            status: "COMPLETED",
            date: { lt: opts.from },
            patientId: { in: patientIds },
            ...scope,
          },
          select: { patientId: true },
          distinct: ["patientId"],
        })
      : [];

  return computePatientJourney({
    visits,
    returningPatientIds: returning.map((r) => r.patientId),
    paymentsTracked: opts.paymentsTracked,
  });
}
