import { prisma } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { runQueueTx } from "@/server/appointments/queue-order";

/** The `$transaction` callback parameter. */
export type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Either the prisma singleton or a transaction client. */
type Db = typeof prisma | TxClient;

/**
 * A doctor may have at most one visit IN_PROGRESS at a time. Returns the
 * other active visit for `doctorId` (if any), so a start request can be
 * rejected with a warning naming the patient already on the table.
 *
 * The check is keyed by the appointment's `doctorId`, not the clinic — a
 * receptionist starting visits for different doctors is fine; only a single
 * doctor running two concurrent visits is the conflict.
 *
 * Bounded to the current clinic day (Q-13): a visit the doctor forgot to
 * close yesterday used to answer every «Вызвать» this morning with «уже идёт
 * приём: <вчерашний пациент>», while «Мой день» and the board (which read
 * today only) showed nobody on the table. Such a row is closed by the
 * lifecycle sweep; it must never block today silently. A row slotted on an
 * earlier day but started today still counts: whatever its slot says, that
 * patient is on the table now.
 *
 * Pass the transaction client: the check only protects the invariant when it
 * runs in the same Serializable transaction as the write that starts the
 * visit (see `runStartVisitTx`).
 */
export async function findOtherActiveVisit(
  params: {
    clinicId: string;
    doctorId: string;
    excludeAppointmentId: string;
    now?: Date;
  },
  db: Db = prisma,
): Promise<{ id: string; patientName: string } | null> {
  const { dayStart } = tashkentDayBounds(params.now ?? new Date());
  const row = await db.appointment.findFirst({
    where: {
      clinicId: params.clinicId,
      doctorId: params.doctorId,
      status: "IN_PROGRESS",
      id: { not: params.excludeAppointmentId },
      // NOT stale (the complement of `staleInProgressWhere`): slotted today
      // or later, or started today.
      OR: [{ date: { gte: dayStart } }, { startedAt: { gte: dayStart } }],
    },
    orderBy: { startedAt: "asc" },
    select: { id: true, patient: { select: { fullName: true } } },
  });
  return row ? { id: row.id, patientName: row.patient.fullName } : null;
}

/**
 * Thrown from inside a start-visit transaction when the doctor already has
 * another visit on the table. Throwing (rather than returning) rolls the
 * transaction back; the route turns it into 409 `another_visit_in_progress`.
 */
export class AnotherVisitInProgressError extends Error {
  readonly activeAppointmentId: string;
  readonly activePatientName: string;
  constructor(active: { id: string; patientName: string }) {
    super("another_visit_in_progress");
    this.name = "AnotherVisitInProgressError";
    this.activeAppointmentId = active.id;
    this.activePatientName = active.patientName;
  }
}

/**
 * Run a write that moves a visit into IN_PROGRESS, with the single-active
 * check inside the same Serializable transaction (Q-13).
 *
 * The check used to be a plain read before a separate update: reception
 * pressing «Вызвать из очереди» while the doctor pressed «Вызвать» on
 * another patient let both reads see a free doctor, and both visits went
 * IN_PROGRESS (the board then showed an arbitrary one). Under Serializable
 * the two transactions read each other's predicate, so Postgres aborts one
 * with 40001; `runQueueTx` retries it, the retry sees the committed visit,
 * and the loser gets a clean 409 instead of a second patient on the table.
 */
export async function runStartVisitTx<T>(
  params: { clinicId: string; doctorId: string; appointmentId: string },
  write: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return runQueueTx(async (tx) => {
    const active = await findOtherActiveVisit(
      {
        clinicId: params.clinicId,
        doctorId: params.doctorId,
        excludeAppointmentId: params.appointmentId,
      },
      tx,
    );
    if (active) throw new AnotherVisitInProgressError(active);
    return write(tx);
  });
}

/**
 * Settle a start transaction into its result or the conflict it refused
 * with, so a route can answer 409 without a try/catch around its whole
 * transaction body. Any other error propagates.
 */
export function orActiveVisitConflict<T>(
  run: Promise<T>,
): Promise<T | AnotherVisitInProgressError> {
  return run.catch((e: unknown) => {
    if (e instanceof AnotherVisitInProgressError) return e;
    throw e;
  });
}
