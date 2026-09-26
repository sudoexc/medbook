/**
 * Which card does a phone number belong to? (audit PH-01, Q-03, MA-04)
 *
 * A number is IDENTITY only when it was proven: typed by staff or at the
 * kiosk while the person stood there, or shared from Telegram as the
 * sender's own contact. A number a Telegram user typed into the Mini App is
 * a claim (`phoneVerifiedAt` NULL): before this rule, anyone could put a
 * stranger's number on his own card and the next walk-in by that number
 * attached her visit (and its conclusion) to him.
 *
 * Three kinds of cards can carry a number:
 *   - the verified OWNER: `phoneNormalized` = the number, `phoneVerifiedAt`
 *     set. At most one per clinic (unique phoneNormalized), except while
 *     two cards hold the two shapes of one number (findVerifiedPhoneOwners).
 *   - an unverified CLAIM: same columns, `phoneVerifiedAt` NULL. Never
 *     matched on its own. At the desk or the kiosk it is shown to the
 *     person standing there: «that is me» verifies it in place (her Mini
 *     App bookings and Telegram stay on it), «not me» takes the number
 *     away. It also gives the number up as soon as a verified owner
 *     appears.
 *   - a CONTACT SHARER: a relative who uses the owner's number (a child
 *     brought by his mother). `phone` holds the number for display and
 *     calls, `phoneNormalized` a `contact:` stub so the unique index stays
 *     intact and the number is never mistaken for his identity.
 */
import { prisma } from "@/lib/prisma";
import { normalizePhone, phoneSearchVariants } from "@/lib/phone";

type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** `phoneNormalized` prefix of a card using a relative's number. */
export const CONTACT_PHONE_PREFIX = "contact:";

/** A real number («+998…»), as opposed to a tg:/family:/contact: stub. */
export function isRealPhone(phoneNormalized: string | null | undefined): boolean {
  return typeof phoneNormalized === "string" && phoneNormalized.startsWith("+");
}

/** Fresh stub for a contact sharer; unique so the index never trips. */
export function contactPhoneStub(): string {
  return `${CONTACT_PHONE_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Prisma unique-constraint violation (P2002), by code or message. */
export function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: unknown }).code;
  if (code === "P2002") return true;
  const msg = (e as { message?: unknown }).message;
  return typeof msg === "string" && /Unique constraint/i.test(msg);
}

export type PhoneCard = {
  id: string;
  fullName: string;
  birthDate: Date | null;
};

/**
 * Every card whose verified identity this number is, oldest first.
 *
 * Normally one. Two while a pre-LD-10 card holds «+334125567» and a newer
 * card holds «+998334125567»: the old lookup of the full number never saw
 * the short shape, so the second card was created for whoever typed it,
 * often ANOTHER person on the family's number (a son on his mother's).
 * scripts/fix-ld10-local-phones.ts cannot move such a card and leaves the
 * pair to reception. Callers that know who is standing there pick by name
 * among these; taking the oldest alone asked the son «Это <мать>?» and, on
 * «Нет», created a third card while his own was never offered.
 */
export async function findVerifiedPhoneOwners(
  db: PrismaLike,
  clinicId: string,
  phone: string,
): Promise<PhoneCard[]> {
  const variants = phoneSearchVariants(phone);
  if (variants.length === 0) return [];
  return db.patient.findMany({
    where: {
      clinicId,
      phoneNormalized: { in: variants },
      phoneVerifiedAt: { not: null },
      deletedAt: null,
    },
    // Oldest first, so a caller with no better clue always lands on the
    // same card and visits do not alternate between the two.
    orderBy: { createdAt: "asc" },
    select: { id: true, fullName: true, birthDate: true },
  });
}

/** Relatives registered under this number as their contact phone. */
export async function findContactSharers(
  db: PrismaLike,
  clinicId: string,
  phone: string,
): Promise<PhoneCard[]> {
  const variants = phoneSearchVariants(phone);
  if (variants.length === 0) return [];
  return db.patient.findMany({
    where: {
      clinicId,
      phone: { in: variants },
      phoneNormalized: { startsWith: CONTACT_PHONE_PREFIX },
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, fullName: true, birthDate: true },
  });
}

/**
 * The card that holds this number WITHOUT proof (typed into the Mini App),
 * when no verified owner exists. Never identity on its own: callers show
 * it to a person who can say «that is me» (audit PH-01, Q-03).
 */
export async function findPhoneClaim(
  db: PrismaLike,
  clinicId: string,
  phone: string,
): Promise<PhoneCard | null> {
  const variants = phoneSearchVariants(phone);
  if (variants.length === 0) return null;
  return db.patient.findFirst({
    where: {
      clinicId,
      phoneNormalized: { in: variants },
      phoneVerifiedAt: null,
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, fullName: true, birthDate: true },
  });
}

/**
 * The person standing at the desk or the kiosk said a claimed number's card
 * is theirs: the number becomes that card's verified identity. Audited,
 * because it is the moment a Mini App claim turns into identity.
 */
export async function verifyPhoneInPerson(
  db: PrismaLike,
  clinicId: string,
  patientId: string,
  via: string,
  now: Date = new Date(),
): Promise<void> {
  await db.patient.update({
    where: { id: patientId },
    data: { phoneVerifiedAt: now },
  });
  await db.auditLog.create({
    data: {
      clinicId,
      action: "patient.phone_verified_in_person",
      entityType: "Patient",
      entityId: patientId,
      meta: { via },
    },
  });
}

/**
 * Take a number away from every card that only CLAIMS it, so its verified
 * owner can hold it. The claim loses both columns (a number left in `phone`
 * would still surface that card in phone searches) and an audit row keeps
 * the old value. Returns the released card ids.
 */
export async function releaseUnverifiedPhone(
  db: PrismaLike,
  clinicId: string,
  phone: string,
  reason: string,
): Promise<string[]> {
  const variants = phoneSearchVariants(phone);
  if (variants.length === 0) return [];
  const claims = await db.patient.findMany({
    where: {
      clinicId,
      phoneNormalized: { in: variants },
      phoneVerifiedAt: null,
    },
    select: { id: true, phone: true, phoneNormalized: true },
  });
  for (const claim of claims) {
    await db.patient.update({
      where: { id: claim.id },
      data: { phone: "", phoneNormalized: `released:${claim.id}` },
    });
    await db.auditLog.create({
      data: {
        clinicId,
        action: "patient.phone_claim_released",
        entityType: "Patient",
        entityId: claim.id,
        meta: {
          phone: claim.phone,
          phoneNormalized: claim.phoneNormalized,
          reason,
        },
      },
    });
  }
  return claims.map((c) => c.id);
}

/**
 * Statuses of a booking nobody has started: no check-in, no visit, so no
 * clinical data hangs off it yet.
 */
const NOT_STARTED_STATUSES = ["BOOKED", "CONFIRMED", "CANCELLED"] as const;

/**
 * What a card the Mini App created on first open holds, when the same
 * Telegram account proves it is the patient of the clinic's real card:
 *   - "empty": nothing at all; the card simply makes way;
 *   - "bookings": only Mini App bookings nobody has started (and the cases
 *     the booking opened for them). The most common path of a returning
 *     patient is to book first and confirm the number afterwards (MA-04);
 *     those bookings carry no medical data yet, so they can follow the
 *     patient to the clinic's card;
 *   - "history": anything clinical, financial or family, or a card that is
 *     not an unverified Telegram auto card at all. Merging that is a human
 *     decision.
 */
export type AutoCardFootprint = "empty" | "bookings" | "history";

/**
 * The footprint without telling bookings from history: "empty", or
 * "occupied" with only bookings and cases on it (worth a closer look), or
 * "history" straight away.
 */
async function autoCardCounts(
  db: PrismaLike,
  patientId: string,
): Promise<"empty" | "occupied" | "history"> {
  const row = await db.patient.findFirst({
    where: { id: patientId },
    select: {
      source: true,
      phoneVerifiedAt: true,
      _count: {
        select: {
          appointments: true,
          visitNotes: true,
          documents: true,
          payments: true,
          cases: true,
          prescriptions: true,
          ePrescriptions: true,
          sickLeaves: true,
          referrals: true,
          labOrders: true,
          labResults: true,
          allergies: true,
          chronicConditions: true,
          diagnoses: true,
          ownedFamilyLinks: true,
          linkedFamilyLinks: true,
          onlineRequests: true,
        },
      },
    },
  });
  if (!row) return "history";
  if (row.source !== "TELEGRAM" || row.phoneVerifiedAt !== null) return "history";
  const { appointments = 0, cases = 0, ...rest } = row._count as Record<
    string,
    number | undefined
  >;
  if (Object.values(rest).some((n) => (n ?? 0) > 0)) return "history";
  return appointments === 0 && cases === 0 ? "empty" : "occupied";
}

export async function autoCardFootprint(
  db: PrismaLike,
  patientId: string,
): Promise<AutoCardFootprint> {
  const counts = await autoCardCounts(db, patientId);
  if (counts !== "occupied") return counts;
  const started = await db.appointment.count({
    where: { patientId, status: { notIn: [...NOT_STARTED_STATUSES] } },
  });
  return started === 0 ? "bookings" : "history";
}

/**
 * An auto-created card that holds nothing at all (see `autoCardFootprint`).
 * Such a card can make way for the clinic's real card when the same Telegram
 * account proves it is that patient.
 */
export async function isRetirableAutoCard(
  db: PrismaLike,
  patientId: string,
): Promise<boolean> {
  return (await autoCardCounts(db, patientId)) === "empty";
}

/**
 * Move an auto card's not-started bookings to the clinic's card of the same
 * person, with the rows that carry the patient next to the booking: queued
 * reminders (they would go to a retired card with no Telegram), the doctor's
 * and call centre's context, and the cases the booking opened. Only for a
 * card whose footprint is "bookings". Returns the moved appointment ids.
 */
export async function moveBookingsToCard(
  db: PrismaLike,
  clinicId: string,
  fromId: string,
  toId: string,
): Promise<string[]> {
  const rows = await db.appointment.findMany({
    where: { clinicId, patientId: fromId },
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await db.appointment.updateMany({
      where: { id: { in: ids } },
      data: { patientId: toId },
    });
    const byBooking = { patientId: fromId, appointmentId: { in: ids } };
    await db.notificationSend.updateMany({
      where: byBooking,
      data: { patientId: toId },
    });
    await db.reminder.updateMany({ where: byBooking, data: { patientId: toId } });
    await db.call.updateMany({ where: byBooking, data: { patientId: toId } });
  }
  await db.medicalCase.updateMany({
    where: { clinicId, patientId: fromId },
    data: { patientId: toId },
  });
  return ids;
}

/**
 * Update payload that retires an empty auto-created card in favour of
 * `keeperId`. Soft on purpose: the row stays (reversible, never trips a
 * foreign key), but it no longer owns the Telegram account or any number,
 * and `deletedAt` keeps it out of sends, analytics and patient counts.
 */
export function retiredCardData(keeperId: string, cardId: string, now: Date) {
  return {
    telegramId: null,
    telegramUsername: null,
    phone: "",
    phoneNormalized: `retired:${cardId}`,
    phoneVerifiedAt: null,
    deletedAt: now,
    deletionReason: `duplicate_of:${keeperId}`,
  };
}

/** Canonical form of a number for writing, or "" when unusable. */
export function canonicalPhone(phone: string): string {
  const n = normalizePhone(phone);
  return isRealPhone(n) && n.replace(/\D/g, "").length >= 9 ? n : "";
}
