/**
 * Which NO_SHOW rows are still the lifecycle sweep's automatic no-show: the
 * `autoNoShow` input to `canArriveAfterAutoNoShow` (reception's «Пришёл» for
 * a patient who came after the sweep gave up on her).
 *
 * The row itself carries no marker of who set NO_SHOW, so the audit trail
 * answers. The sweep writes APPOINTMENT_AUTO_NO_SHOW. A row only ever leaves
 * NO_SHOW through the doctor's revert (APPOINTMENT_STATUS_REVERTED) or
 * through «Пришёл» itself (APPOINTMENT_QUEUE_STATUS); every other path keeps
 * NO_SHOW terminal. So the current NO_SHOW is the sweep's exactly when its
 * latest auto row is newer than any exit: after an exit, NO_SHOW again was
 * set by a person, since a fresh sweep flip writes a newer auto row.
 */
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTION } from "@/lib/audit-actions";

const EXIT_ACTIONS: ReadonlySet<string> = new Set([
  AUDIT_ACTION.APPOINTMENT_STATUS_REVERTED,
  AUDIT_ACTION.APPOINTMENT_QUEUE_STATUS,
]);

export interface NoShowAuditEvent {
  action: string;
  createdAt: Date;
}

/**
 * Pure: given one appointment's audit rows (any order), true when its
 * latest auto no-show has not been left since. A tie with an exit counts as
 * left, the safe reading.
 */
export function autoNoShowStands(
  events: ReadonlyArray<NoShowAuditEvent>,
): boolean {
  let lastAuto = -Infinity;
  let lastExit = -Infinity;
  for (const e of events) {
    const at = e.createdAt.getTime();
    if (e.action === AUDIT_ACTION.APPOINTMENT_AUTO_NO_SHOW) {
      if (at > lastAuto) lastAuto = at;
    } else if (EXIT_ACTIONS.has(e.action)) {
      if (at > lastExit) lastExit = at;
    }
  }
  return lastAuto > -Infinity && lastAuto > lastExit;
}

/**
 * The ids among `appointmentIds` whose NO_SHOW is still the sweep's. One
 * query over the (entityType, entityId) index; callers pass only NO_SHOW
 * rows of today's clinic day, so the set stays a handful.
 */
export async function findStandingAutoNoShows(
  appointmentIds: ReadonlyArray<string>,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (appointmentIds.length === 0) return out;
  const rows = await prisma.auditLog.findMany({
    where: {
      entityType: "Appointment",
      entityId: { in: [...appointmentIds] },
      action: {
        in: [AUDIT_ACTION.APPOINTMENT_AUTO_NO_SHOW, ...EXIT_ACTIONS],
      },
    },
    select: { entityId: true, action: true, createdAt: true },
  });
  const byId = new Map<string, NoShowAuditEvent[]>();
  for (const r of rows) {
    if (!r.entityId) continue;
    const list = byId.get(r.entityId) ?? [];
    list.push({ action: r.action, createdAt: r.createdAt });
    byId.set(r.entityId, list);
  }
  for (const [id, events] of byId) {
    if (autoNoShowStands(events)) out.add(id);
  }
  return out;
}

export async function isStandingAutoNoShow(
  appointmentId: string,
): Promise<boolean> {
  return (await findStandingAutoNoShows([appointmentId])).has(appointmentId);
}
