/**
 * Types used across the /crm/call-center hooks.
 *
 * These mirror the shape returned by `GET /api/crm/calls`. The Call model
 * itself doesn't have a `status` column (see prisma/schema.prisma model
 * Call); we derive it on the client from `direction` + `endedAt`:
 *
 *   direction === 'MISSED'  → "missed"
 *   !endedAt                 → "ringing" if tags.includes('answered') ? "answered" : "ringing"
 *   endedAt                  → "ended"
 *
 * TODO(prisma-schema-owner): add a proper `status` enum + `startedAt`/
 * `answeredAt` columns so the client doesn't need this derivation.
 */

export type CallDirection = "IN" | "OUT" | "MISSED";

export type DerivedCallStatus = "ringing" | "answered" | "ended" | "missed";

export type CallRow = {
  id: string;
  direction: CallDirection;
  fromNumber: string;
  toNumber: string;
  patientId: string | null;
  operatorId: string | null;
  appointmentId: string | null;
  durationSec: number | null;
  recordingUrl: string | null;
  summary: string | null;
  tags: string[];
  sipCallId: string | null;
  createdAt: string;
  endedAt: string | null;
  patient: {
    id: string;
    fullName: string;
    phone: string;
  } | null;
  operator: {
    id: string;
    name: string | null;
  } | null;
};

export type CallListResponse = {
  rows: CallRow[];
  nextCursor: string | null;
};

export function deriveStatus(row: Pick<CallRow, "direction" | "endedAt" | "tags">): DerivedCallStatus {
  if (row.direction === "MISSED") return "missed";
  if (row.endedAt) return "ended";
  if (row.tags.includes("answered")) return "answered";
  return "ringing";
}
