/**
 * Phase 18 Wave 1 — schedule-heatmap resolver.
 *
 * Reads `mv_schedule_heatmap` (last 90 days, one row per clinicId ×
 * doctorId × ISO dayOfWeek × hour). Returns a flat matrix the dashboard
 * can render directly.
 */

import type { RawQueryClient } from "./cohort-resolver";

interface RawHeatmapRow {
  clinicId: string;
  doctorId: string;
  dayOfWeek: number;
  hour: number;
  appointmentCount: bigint | number;
  availableSlotCount: bigint | number;
}

export interface ScheduleHeatmapCell {
  doctorId: string;
  dayOfWeek: number;
  hour: number;
  appointmentCount: number;
  availableSlotCount: number;
}

export interface ScheduleHeatmapResult {
  cells: ScheduleHeatmapCell[];
  generatedAt: string;
  source: "mv:mv_schedule_heatmap";
}

const SQL = `
SELECT
  "clinicId",
  "doctorId",
  "dayOfWeek",
  "hour",
  "appointmentCount",
  "availableSlotCount"
FROM "mv_schedule_heatmap"
WHERE "clinicId" = $1
ORDER BY "doctorId", "dayOfWeek", "hour"
`.trim();

export async function resolveScheduleHeatmap(
  prisma: RawQueryClient,
  clinicId: string,
): Promise<ScheduleHeatmapResult> {
  let rows: RawHeatmapRow[];
  try {
    rows = await prisma.$queryRawUnsafe<RawHeatmapRow[]>(SQL, clinicId);
  } catch (e) {
    // MV exists but never refreshed yet — return empty heatmap rather than
    // 500. Same fallback the cohort + financial-pace resolvers use.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("has not been populated")) {
      return {
        cells: [],
        generatedAt: new Date().toISOString(),
        source: "mv:mv_schedule_heatmap",
      };
    }
    throw e;
  }
  return {
    cells: rows.map((r) => ({
      doctorId: r.doctorId,
      dayOfWeek: Number(r.dayOfWeek),
      hour: Number(r.hour),
      appointmentCount: Number(r.appointmentCount),
      availableSlotCount: Number(r.availableSlotCount),
    })),
    generatedAt: new Date().toISOString(),
    source: "mv:mv_schedule_heatmap",
  };
}
