/**
 * Server side of «Позвать регистратуру» (src/lib/staff-calls.ts): reading a
 * call the way the screens show it and telling every screen it changed.
 */
import { prisma } from "@/lib/prisma";
import { publishEventSafe } from "@/server/realtime/publish";
import type { StaffCallStatus, StaffCallView } from "@/lib/staff-calls";

export const STAFF_CALL_SELECT = {
  id: true,
  doctorId: true,
  status: true,
  ackedByName: true,
  createdAt: true,
  ackedAt: true,
  doctor: { select: { nameRu: true, cabinet: { select: { number: true } } } },
} as const;

type StaffCallRow = {
  id: string;
  doctorId: string;
  status: string;
  ackedByName: string | null;
  createdAt: Date;
  ackedAt: Date | null;
  doctor: { nameRu: string; cabinet: { number: string } | null };
};

export function toStaffCallView(row: StaffCallRow): StaffCallView {
  return {
    id: row.id,
    doctorId: row.doctorId,
    doctorName: row.doctor.nameRu,
    cabinet: row.doctor.cabinet?.number ?? null,
    status: row.status as StaffCallStatus,
    ackedByName: row.ackedByName,
    createdAt: row.createdAt.toISOString(),
    ackedAt: row.ackedAt ? row.ackedAt.toISOString() : null,
  };
}

export async function loadStaffCall(id: string): Promise<StaffCallView | null> {
  const row = await prisma.staffCall.findFirst({ where: { id }, select: STAFF_CALL_SELECT });
  return row ? toStaffCallView(row) : null;
}

/** Every reception screen and the doctor's own: the call was made, answered or taken back. */
export function publishStaffCall(clinicId: string, call: StaffCallView): void {
  publishEventSafe(clinicId, {
    type: "staff-call.updated",
    payload: {
      callId: call.id,
      doctorId: call.doctorId,
      doctorName: call.doctorName,
      cabinet: call.cabinet,
      status: call.status,
      ackedByName: call.ackedByName,
      createdAt: call.createdAt,
    },
  });
}
