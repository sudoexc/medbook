/**
 * Sequence helpers for Phase G7 form numbering.
 *
 * `RX-YYYYMMDD-NNNN` for e-prescriptions, `SL-YYYYMMDD-NNNN` for sick
 * leaves. Same UTC-day-bucket approach as `LabOrder.orderNumber` — the
 * UNIQUE constraint on the column protects against the (rare) tie race.
 *
 * Verify token is a 24-byte base32 string printed inside the QR; the
 * public verify endpoint matches on this token, NOT on the human-friendly
 * number, so guessing a valid certificate is computationally infeasible
 * even if the daily counter is leaked on a printout.
 */
import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";

export async function nextRxNumber(clinicId: string): Promise<string> {
  return nextNumber({
    clinicId,
    prefix: "RX",
    countToday: (start) =>
      prisma.ePrescription.count({
        where: { clinicId, createdAt: { gte: start } },
      }),
  });
}

export async function nextSickLeaveNumber(clinicId: string): Promise<string> {
  return nextNumber({
    clinicId,
    prefix: "SL",
    countToday: (start) =>
      prisma.sickLeave.count({
        where: { clinicId, createdAt: { gte: start } },
      }),
  });
}

async function nextNumber({
  prefix,
  countToday,
}: {
  clinicId: string;
  prefix: "RX" | "SL";
  countToday: (start: Date) => Promise<number>;
}): Promise<string> {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const startOfDay = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate()));
  const count = await countToday(startOfDay);
  const seq = String(count + 1).padStart(4, "0");
  return `${prefix}-${y}${m}${d}-${seq}`;
}

export function newVerifyToken(): string {
  // 24 bytes → 39 base32 chars without padding. Stripped of `=` and
  // lowercased on the URL side; the column stores the canonical form.
  return randomBytes(24).toString("base64url");
}
