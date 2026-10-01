/**
 * Reminders for a relative who has no Telegram of their own go to the family
 * member who manages them (audit P1D-01).
 *
 * A child or an elderly parent is usually a card without Telegram, linked in
 * the Mini App to the parent or child who does have it
 * (`PatientFamily.ownerPatientId`). The materialisers only ever looked at the
 * patient's own `telegramId`, so the relative's visit produced nothing but a
 * PATIENT_NO_CHANNEL call task, while the person who brings them to the
 * clinic sat in the bot. The owner now gets the message, in their language,
 * under a line naming whose visit it is. The row stays the relative's
 * (`patientId`): their visit, their consent, their history. Only when no
 * family member can be reached does the call task remain.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { escapeHtml } from "@/lib/telegram";

import { patientLocale, patientTexts, type PatientLang } from "./patient-texts";

export type FamilyRelay = {
  ownerPatientId: string;
  /** The owner's Telegram chat: the message's recipient. */
  telegramId: string;
  /** The language the owner reads. */
  lang: PatientLang;
};

/**
 * The reachable family owner of each patient, by patient id. A relative with
 * several owners gets the earliest link. Best effort: a failed lookup leaves
 * the map empty, and the caller falls back to the call task it raised before.
 */
export async function familyRelaysFor(
  patients: ReadonlyArray<{ id: string; clinicId: string }>,
): Promise<Map<string, FamilyRelay>> {
  const out = new Map<string, FamilyRelay>();
  if (patients.length === 0) return out;
  try {
    const links = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.patientFamily.findMany({
        where: {
          clinicId: { in: Array.from(new Set(patients.map((p) => p.clinicId))) },
          linkedPatientId: { in: patients.map((p) => p.id) },
          ownerPatient: {
            telegramId: { not: null },
            tgBlockedAt: null,
            deletedAt: null,
          },
        },
        select: {
          clinicId: true,
          linkedPatientId: true,
          ownerPatient: {
            select: { id: true, telegramId: true, preferredLang: true },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
    const clinicOf = new Map(patients.map((p) => [p.id, p.clinicId]));
    for (const link of links) {
      const owner = link.ownerPatient;
      if (!owner?.telegramId) continue;
      if (clinicOf.get(link.linkedPatientId) !== link.clinicId) continue;
      if (out.has(link.linkedPatientId)) continue;
      out.set(link.linkedPatientId, {
        ownerPatientId: owner.id,
        telegramId: owner.telegramId,
        lang: patientLocale(owner.preferredLang),
      });
    }
  } catch (e) {
    console.warn(
      `[notifications] family relay lookup failed: ${(e as Error).message}`,
    );
  }
  return out;
}

/**
 * The line put above a relayed message, so the owner knows whose visit it
 * is: «👤 Член семьи: Каримов Азиз». Telegram HTML, like every body.
 */
export function familyRelayHeader(lang: PatientLang, relativeName: string): string {
  return patientTexts(lang)("familyRelay", { name: escapeHtml(relativeName.trim()) });
}

/**
 * Whether the Telegram user who tapped «✅ Подтверждаю» may confirm this
 * patient's visit: the patient themselves, or the family member the relayed
 * reminder went to. Anyone else (a forwarded message) may not.
 */
export async function telegramUserMayConfirm(input: {
  clinicId: string;
  patientId: string;
  patientTelegramId: string | null;
  senderTelegramId: string | null;
}): Promise<boolean> {
  if (!input.senderTelegramId) return false;
  if (input.patientTelegramId && input.patientTelegramId === input.senderTelegramId) {
    return true;
  }
  try {
    const link = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.patientFamily.findFirst({
        where: {
          clinicId: input.clinicId,
          linkedPatientId: input.patientId,
          ownerPatient: { telegramId: input.senderTelegramId, deletedAt: null },
        },
        select: { id: true },
      }),
    );
    return link !== null;
  } catch {
    // Unknown is «not yours»: the button never confirms on a failed check.
    return false;
  }
}
