/**
 * Mini-app helper — resolve the *acting* patient for a mini-app write.
 *
 * Phase 16 added family scenarios: the TG-authenticated owner can act on
 * behalf of a linked relative. The owner stays the audit actor; the
 * appointment / medication / pre-visit row's `patientId` becomes the
 * relative's id. Validation must happen on every write path, so it lives here
 * once instead of being open-coded in each route.
 *
 * Returns `ok: false` when `onBehalfOf` references a patient id that is *not*
 * linked to the authenticated owner. Routes translate that to a 403
 * `on_behalf_of_not_linked`.
 */

import { prisma } from "@/lib/prisma";

export type ActivePatientCtx = {
  clinicId: string;
  patientId: string;
  preferredLang: "RU" | "UZ";
};

export type ActivePatientResult =
  | {
      ok: true;
      patientId: string;
      preferredLang: "RU" | "UZ";
      isOnBehalfOf: boolean;
      /** Owner who initiated the action — always the TG-authenticated patient. */
      ownerPatientId: string;
    }
  | { ok: false; reason: "on_behalf_of_not_linked" };

export async function resolveActivePatient(input: {
  ctx: ActivePatientCtx;
  onBehalfOf?: string | null;
}): Promise<ActivePatientResult> {
  const { ctx } = input;
  const target = input.onBehalfOf?.trim() || null;

  if (!target || target === ctx.patientId) {
    return {
      ok: true,
      patientId: ctx.patientId,
      preferredLang: ctx.preferredLang,
      isOnBehalfOf: false,
      ownerPatientId: ctx.patientId,
    };
  }

  const link = await prisma.patientFamily.findFirst({
    where: {
      clinicId: ctx.clinicId,
      ownerPatientId: ctx.patientId,
      linkedPatientId: target,
    },
    select: {
      linkedPatient: { select: { id: true, preferredLang: true } },
    },
  });
  if (!link?.linkedPatient) return { ok: false, reason: "on_behalf_of_not_linked" };

  return {
    ok: true,
    patientId: link.linkedPatient.id,
    preferredLang:
      (link.linkedPatient.preferredLang as "RU" | "UZ" | null) ??
      ctx.preferredLang,
    isOnBehalfOf: true,
    ownerPatientId: ctx.patientId,
  };
}

/**
 * Cheap fan-out — the set of patient ids the TG owner may legitimately read
 * / write on. Used by the SSE filter (Phase M3) and any list-handler that
 * returns "all my + family" data.
 */
export async function getFamilyAllowedPatientIds(
  clinicId: string,
  ownerPatientId: string,
): Promise<string[]> {
  const links = await prisma.patientFamily.findMany({
    where: { clinicId, ownerPatientId },
    select: { linkedPatientId: true },
  });
  return [ownerPatientId, ...links.map((l) => l.linkedPatientId)];
}
