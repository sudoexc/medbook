/**
 * Phase 10 — server resolver for reassignment suggestions.
 *
 * Computes today's per-doctor load (delay, remaining work, free capacity) and
 * a list of currently waiting appointments enriched with the set of eligible
 * substitute doctors via the `ServiceOnDoctor` join. Hands the bundle to the
 * pure `suggestReassignments` engine.
 *
 * Auto-scoped via the Prisma tenant extension; branch scoping kicks in when
 * the active TenantContext carries `branchId`.
 */

import { prisma } from "@/lib/prisma";
import {
  suggestReassignments,
  type DoctorLoad,
  type ReassignCandidate,
} from "@/lib/ai/reassign-engine";

export interface ResolveReassignResult {
  loads: DoctorLoad[];
  candidates: ReassignCandidate[];
}

const DAY_CAPACITY_MIN = 8 * 60; // 8 working hours per doctor by default

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}
function diffMin(a: Date, b: Date): number {
  return Math.max(0, (a.getTime() - b.getTime()) / 60_000);
}

export async function resolveReassign(opts: { now?: Date } = {}): Promise<ResolveReassignResult> {
  const now = opts.now ?? new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  // Active doctors visible in current scope (auto-clinic + optional branch).
  const doctors = await prisma.doctor.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  if (doctors.length === 0) {
    return { loads: [], candidates: [] };
  }

  // Today's appointments — used for both load and waiting list.
  const todays = await prisma.appointment.findMany({
    where: {
      date: { gte: dayStart, lte: dayEnd },
    },
    select: {
      id: true,
      doctorId: true,
      serviceId: true,
      date: true,
      durationMin: true,
      queueStatus: true,
      status: true,
      calledAt: true,
      startedAt: true,
      completedAt: true,
    },
    orderBy: { date: "asc" },
  });

  // Build per-doctor load.
  const loads: DoctorLoad[] = doctors.map((doc) => {
    const mine = todays.filter((a) => a.doctorId === doc.id);
    let delayMin = 0;
    let remainingTodayMin = 0;
    let bookedMin = 0;
    for (const a of mine) {
      bookedMin += a.durationMin;
      if (
        a.queueStatus === "BOOKED" ||
        a.queueStatus === "WAITING" ||
        a.queueStatus === "IN_PROGRESS"
      ) {
        remainingTodayMin += a.durationMin;
      }
      // Delay heuristic: late on the currently-running visit.
      if (a.queueStatus === "IN_PROGRESS" && a.startedAt) {
        const elapsed = diffMin(now, a.startedAt);
        const over = elapsed - a.durationMin;
        if (over > delayMin) delayMin = over;
      } else if (
        (a.queueStatus === "BOOKED" || a.queueStatus === "WAITING") &&
        a.date.getTime() < now.getTime()
      ) {
        const over = diffMin(now, a.date);
        if (over > delayMin) delayMin = over;
      }
    }
    const capacityRemainingMin = Math.max(0, DAY_CAPACITY_MIN - bookedMin);
    return {
      doctorId: doc.id,
      delayMin,
      remainingTodayMin,
      capacityRemainingMin,
    };
  });

  // Waiting list (queueStatus === WAITING) with eligibility derived from
  // the ServiceOnDoctor join.
  const waiting = todays.filter((a) => a.queueStatus === "WAITING");
  const serviceIds = Array.from(
    new Set(waiting.map((w) => w.serviceId).filter((s): s is string => !!s)),
  );

  const eligibleByService = new Map<string, string[]>();
  if (serviceIds.length > 0) {
    const links = await prisma.serviceOnDoctor.findMany({
      where: { serviceId: { in: serviceIds } },
      select: { doctorId: true, serviceId: true },
    });
    for (const link of links) {
      const arr = eligibleByService.get(link.serviceId) ?? [];
      arr.push(link.doctorId);
      eligibleByService.set(link.serviceId, arr);
    }
  }

  const waitingInput = waiting
    .filter((w) => !!w.serviceId)
    .map((w) => ({
      appointmentId: w.id,
      doctorId: w.doctorId,
      serviceId: w.serviceId as string,
      waitMin: w.calledAt
        ? diffMin(now, w.calledAt)
        : diffMin(now, w.date),
      eligibleDoctorIds: eligibleByService.get(w.serviceId as string) ?? [],
    }));

  const candidates = suggestReassignments({ loads, waiting: waitingInput });
  return { loads, candidates };
}
