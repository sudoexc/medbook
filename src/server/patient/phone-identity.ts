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
 *     set. At most one per clinic (unique phoneNormalized).
 *   - an unverified CLAIM: same columns, `phoneVerifiedAt` NULL. Never
 *     matched; it gives the number up as soon as a verified owner appears.
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

/** The card whose verified identity this number is, or null. */
export async function findVerifiedPhoneOwner(
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
      phoneVerifiedAt: { not: null },
      deletedAt: null,
    },
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
 * A card the Mini App created on first open that holds nothing worth
 * keeping: born in Telegram, no verified number, and no clinical, financial
 * or family footprint. Such a card can make way for the clinic's real card
 * when the same Telegram account proves it is that patient.
 */
export async function isRetirableAutoCard(
  db: PrismaLike,
  patientId: string,
): Promise<boolean> {
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
  if (!row) return false;
  if (row.source !== "TELEGRAM" || row.phoneVerifiedAt !== null) return false;
  return Object.values(row._count).every((n) => n === 0);
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
