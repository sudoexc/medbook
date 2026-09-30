/**
 * Patient segment recompute (audit PT-15).
 *
 * A completed visit refreshes its patient's segment on the spot
 * (`runCompletionEffects`). What only the calendar changes needs a pass:
 * 90 days without a visit turn an active patient into «Остывают», a year
 * into «Потерянные», and a first-timer who never came back stops being
 * «Новый». This job reruns the rule of `src/lib/patients/segment-rules.ts`
 * over every live patient.
 *
 * Cadence: every 6 hours plus once at start, so a deploy puts every segment
 * right without waiting a day. The rule counts whole days, so running more
 * often changes nothing; a pass is a paged scan of the patients and a
 * handful of `updateMany` writes for the ones that moved.
 *
 * Tenant context: cross-clinic scan in SYSTEM, like the lifecycle sweep.
 * Idempotent: a second pass finds nothing to change.
 */
import { runWithTenant } from "@/lib/tenant-context";
import { getQueue } from "@/server/queue";
import { recomputePatientSegments } from "@/server/patient/segments";

export const QUEUE_NAME = "patient-segments";
export const JOB_NAME = "recompute";

async function tick(): Promise<void> {
  const out = await runWithTenant({ kind: "SYSTEM" }, () =>
    recomputePatientSegments(new Date()),
  );
  console.info(
    `[patient-segments] tick ok changed=${out.changed}/${out.scanned}`,
  );
}

export function startPatientSegmentsWorker(
  intervalMs = 6 * 60 * 60_000,
): { stop: () => void } {
  const q = getQueue();
  q.registerWorker(QUEUE_NAME, JOB_NAME, tick);
  const handle = q.repeat(QUEUE_NAME, JOB_NAME, {}, intervalMs);
  // The first pass right away: a deploy fixes every segment in minutes.
  void q.enqueue(QUEUE_NAME, JOB_NAME, {}).catch((e: unknown) => {
    console.warn(
      `[patient-segments] initial pass not queued: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
  console.info(`[worker] patient-segments registered every ${intervalMs}ms`);
  return handle;
}

export { tick as _tickForTests };
