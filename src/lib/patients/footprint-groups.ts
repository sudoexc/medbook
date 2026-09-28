/**
 * What a patient card carries besides its own row, grouped the way the
 * delete dialog explains a refusal (audit G1-09).
 *
 * The keys are the `Patient` relations counted by
 * `src/server/patient/footprint.ts`; a unit test checks the two lists
 * against prisma/schema.prisma, so a relation added later cannot slip past
 * the delete guard unnoticed.
 *
 * Client-safe: no server imports.
 */

export const FOOTPRINT_GROUPS = {
  visits: ["appointments", "visitNotes"],
  medical: [
    "cases",
    "allergies",
    "chronicConditions",
    "diagnoses",
    "clinicalNote",
    "prescriptions",
    "medicationReminderSends",
    "labResults",
    "labOrders",
    "ePrescriptions",
    "sickLeaves",
    "referrals",
    "cdsOverrides",
  ],
  documents: ["documents"],
  payments: ["payments"],
  messages: ["conversations", "calls", "communications", "notifications"],
  requests: ["onlineRequests", "leads", "reviews", "patientReviews"],
  family: [
    "ownedFamilyLinks",
    "linkedFamilyLinks",
    "referralCodes",
    "referralRewardsAsReferrer",
    "referralRewardsAsReferred",
  ],
  dsar: ["dataExportJobs", "dataDeletionJobs"],
  reminders: ["reminders"],
} as const;

export type FootprintGroup = keyof typeof FOOTPRINT_GROUPS;
export type FootprintRelation =
  (typeof FOOTPRINT_GROUPS)[FootprintGroup][number];

export const FOOTPRINT_RELATIONS: readonly FootprintRelation[] = Object.values(
  FOOTPRINT_GROUPS,
).flat();

/**
 * Relations that go with the card on purpose, and why:
 *   - telegramInviteTokens: a one-time «link your Telegram» token staff
 *     generated from this card; it means nothing without the card.
 * (PatientView is not a relation at all any more: the access log keeps a
 * plain patient id and outlives the card.)
 */
export const FOOTPRINT_EXEMPT_RELATIONS = ["telegramInviteTokens"] as const;

/**
 * Sum per group, only the groups with something in them, in the order the
 * dialog lists them. Unknown keys (an older server) are ignored.
 */
export function groupFootprint(
  counts: Record<string, number>,
): Array<{ group: FootprintGroup; count: number }> {
  const out: Array<{ group: FootprintGroup; count: number }> = [];
  for (const group of Object.keys(FOOTPRINT_GROUPS) as FootprintGroup[]) {
    let count = 0;
    for (const rel of FOOTPRINT_GROUPS[group]) count += counts[rel] ?? 0;
    if (count > 0) out.push({ group, count });
  }
  return out;
}
