/**
 * Types used across the /crm/call-center hooks.
 *
 * Mirrors the shape returned by `GET /api/crm/calls`. The DB schema now
 * carries an explicit `status` column (CallStatus enum); `deriveStatus`
 * prefers that column and falls back to the legacy direction/endedAt/tags
 * derivation for rows persisted before migration 20260608140000.
 */

export type CallDirection = "IN" | "OUT" | "MISSED";

export type CallStatus = "RINGING" | "ANSWERED" | "ENDED" | "MISSED";

export type DerivedCallStatus = "ringing" | "answered" | "ended" | "missed";

export type CallRow = {
  id: string;
  direction: CallDirection;
  status: CallStatus | null;
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
  startedAt: string | null;
  answeredAt: string | null;
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

export function deriveStatus(
  row: Pick<CallRow, "direction" | "endedAt" | "tags" | "status">,
): DerivedCallStatus {
  if (row.status) {
    switch (row.status) {
      case "RINGING":
        return "ringing";
      case "ANSWERED":
        return "answered";
      case "ENDED":
        return "ended";
      case "MISSED":
        return "missed";
    }
  }
  // Legacy fallback for rows persisted before the status column landed.
  if (row.direction === "MISSED") return "missed";
  if (row.endedAt) return "ended";
  if (row.tags.includes("answered")) return "answered";
  return "ringing";
}
