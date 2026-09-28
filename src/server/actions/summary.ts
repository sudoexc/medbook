/**
 * Clinic-wide aggregate of the open Action work list, for the Action Center
 * KPI tiles, the «Потери сегодня» card and the category counters
 * (`GET /api/crm/actions/summary`).
 *
 * Audit AC-18: the page used to derive every number from the one page of 50
 * rows it had loaded, so «Неподтверждённые», «Риск пропуска» and the money
 * next to them silently undercounted as soon as the clinic had more open
 * tasks than that (it has had 58 and more). The summary runs over the same
 * visibility filter as the list (`visibleActionsWhere`) but over every row,
 * so a tile always equals what paging through the list would show.
 *
 * Counts come from one `groupBy`. The money figures live inside the JSON
 * payload, which SQL `groupBy` cannot sum portably, so the few money-bearing
 * types are read with a narrow select and summed here. Those types are
 * bounded by construction (tomorrow's empty slots, the next hours' no-show
 * risks, three dormant segments, visits with a debt).
 *
 * Money stays in raw payload units (tiins); the client multiplies by the
 * clinic's average visit price, which only it has.
 */
import {
  ACTION_SEVERITIES,
  type ActionPayload,
  type ActionSeverity,
  type ActionType,
} from "@/lib/actions/types";
import type { TenantScopedPrisma } from "@/lib/prisma";

type PrismaLike = TenantScopedPrisma;

export type ActionsSummary = {
  /** Every visible open task. */
  total: number;
  byType: Partial<Record<ActionType, number>>;
  bySeverity: Record<ActionSeverity, number>;
  /** Σ EMPTY_SLOT_TOMORROW.estimatedRevenueLossUzs (tiins). */
  freeSlotsRevenueTiins: number;
  /** Σ NO_SHOW_RISK_HIGH.risk: expected no-shows among the flagged visits. */
  noShowRiskSum: number;
  /** Σ PAYMENT_OVERDUE.amountUzs (tiins). */
  paymentsAmountTiins: number;
  /** Σ DORMANT_BATCH.patientCount. */
  dormantPatients: number;
  /** The doctor of the longest DOCTOR_OVERLOAD queue, for the AI hint. */
  overloadDoctorName: string | null;
};

const MONEY_TYPES = [
  "EMPTY_SLOT_TOMORROW",
  "NO_SHOW_RISK_HIGH",
  "PAYMENT_OVERDUE",
  "DORMANT_BATCH",
  "DOCTOR_OVERLOAD",
] as const;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export async function summarizeActions(
  prisma: PrismaLike,
  where: Record<string, unknown>,
): Promise<ActionsSummary> {
  const groups = (await prisma.action.groupBy({
    by: ["type", "severity"],
    where: where as never,
    _count: { _all: true },
  })) as unknown as Array<{
    type: string;
    severity: string;
    _count: { _all: number };
  }>;

  const summary: ActionsSummary = {
    total: 0,
    byType: {},
    bySeverity: Object.fromEntries(ACTION_SEVERITIES.map((s) => [s, 0])) as Record<
      ActionSeverity,
      number
    >,
    freeSlotsRevenueTiins: 0,
    noShowRiskSum: 0,
    paymentsAmountTiins: 0,
    dormantPatients: 0,
    overloadDoctorName: null,
  };
  for (const g of groups) {
    const n = g._count._all;
    summary.total += n;
    const type = g.type as ActionType;
    summary.byType[type] = (summary.byType[type] ?? 0) + n;
    if (g.severity in summary.bySeverity) {
      summary.bySeverity[g.severity as ActionSeverity] += n;
    }
  }

  const moneyTypes = MONEY_TYPES.filter((t) => (summary.byType[t] ?? 0) > 0);
  if (moneyTypes.length === 0) return summary;

  const rows = (await prisma.action.findMany({
    where: { AND: [where, { type: { in: moneyTypes } }] } as never,
    select: { type: true, payload: true },
  })) as Array<{ type: string; payload: ActionPayload | null }>;

  let longestQueue = -1;
  for (const { payload: p } of rows) {
    if (!p) continue;
    switch (p.type) {
      case "EMPTY_SLOT_TOMORROW":
        summary.freeSlotsRevenueTiins += num(p.estimatedRevenueLossUzs);
        break;
      case "NO_SHOW_RISK_HIGH":
        summary.noShowRiskSum += num(p.risk);
        break;
      case "PAYMENT_OVERDUE":
        summary.paymentsAmountTiins += num(p.amountUzs);
        break;
      case "DORMANT_BATCH":
        summary.dormantPatients += num(p.patientCount);
        break;
      case "DOCTOR_OVERLOAD":
        if (num(p.queueLength) > longestQueue) {
          longestQueue = num(p.queueLength);
          summary.overloadDoctorName = p.doctorName || null;
        }
        break;
      default:
        break;
    }
  }
  // Two decimals like the payloads themselves, so float dust never reaches
  // the wire.
  summary.noShowRiskSum = Math.round(summary.noShowRiskSum * 100) / 100;
  return summary;
}
