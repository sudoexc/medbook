/**
 * The CRM side of the plan-limit guard (audit SEC-10): read the 402
 * `PlanLimitExceeded` answer of the patient create, booking and walk-in
 * routes, so the dialogs say «лимит тарифа» instead of a raw error code.
 */
export type PlanLimitQuota = "maxPatients" | "maxAppointmentsPerMonth";

export function readPlanLimit(
  status: number,
  body: unknown,
): { quota: PlanLimitQuota; max: number } | null {
  if (status !== 402 || !body || typeof body !== "object") return null;
  const b = body as { error?: unknown; quota?: unknown; max?: unknown };
  if (b.error !== "PlanLimitExceeded") return null;
  if (b.quota !== "maxPatients" && b.quota !== "maxAppointmentsPerMonth") {
    return null;
  }
  return { quota: b.quota, max: typeof b.max === "number" ? b.max : 0 };
}
