/**
 * Every card a number typed at the kiosk can stand for (audit P1D-02).
 *
 * A family shares one phone. The kiosk used to look up only the number's
 * owner and that one card's bookings, so a son registered at the desk under
 * his mother's number, or a child the mother booked for in the Mini App
 * (a `family:` card with no phone of its own), could not check in: his
 * booking never showed, the kiosk sent him to «choose a doctor», and the
 * real booking later decayed to NO_SHOW.
 *
 * The cards, in the order the kiosk lists them:
 *   - the number's VERIFIED owners (one, or the two shapes of one number,
 *     LD-10), or, with none, the card that only CLAIMS it from the Mini App
 *     (flagged `unverified`, PH-01);
 *   - relatives registered under the number as their contact phone (Q-03);
 *   - relatives the owner (or the claim) linked in the Mini App «Семья».
 *     A claim proves nothing, so its relatives inherit its flag.
 *
 * The kiosk shows a relative only when he has a booking it can act on (see
 * the lookup route); a relative without one registers by name, and
 * `decidePhoneOwner` finds his card. The walk-in accepts a card picked on
 * the kiosk only when it is one of these, so a paired kiosk still cannot
 * queue an arbitrary patient by id.
 */
import type { prisma } from "@/lib/prisma";
import {
  findContactSharers,
  findPhoneClaim,
  findVerifiedPhoneOwners,
} from "@/server/patient/phone-identity";

type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** How a card is tied to the number. */
export type KioskCardRelation = "owner" | "claim" | "contact" | "family";

export type KioskCard = {
  id: string;
  fullName: string;
  relation: KioskCardRelation;
  /** Tied to the number only through a Mini App claim (PH-01). */
  unverified: boolean;
};

/**
 * More than a family is not a family: past this the list is cut, owners
 * first. Keeps a number shared by a whole office from turning the kiosk
 * into a patient directory.
 */
export const MAX_KIOSK_CARDS = 6;

/** A number's own card (owner or claim), as opposed to a relative's. */
export function isNumberCard(card: Pick<KioskCard, "relation">): boolean {
  return card.relation === "owner" || card.relation === "claim";
}

export async function findKioskCards(
  db: PrismaLike,
  clinicId: string,
  phone: string,
): Promise<KioskCard[]> {
  const owners = await findVerifiedPhoneOwners(db, clinicId, phone);
  const claim = owners.length === 0 ? await findPhoneClaim(db, clinicId, phone) : null;
  const numberCards: KioskCard[] =
    owners.length > 0
      ? owners.map((o) => ({
          id: o.id,
          fullName: o.fullName,
          relation: "owner" as const,
          unverified: false,
        }))
      : claim
        ? [{ id: claim.id, fullName: claim.fullName, relation: "claim", unverified: true }]
        : [];

  const sharers = await findContactSharers(db, clinicId, phone);
  const links =
    numberCards.length > 0
      ? await db.patientFamily.findMany({
          where: {
            clinicId,
            ownerPatientId: { in: numberCards.map((c) => c.id) },
          },
          orderBy: { createdAt: "asc" },
          select: {
            linkedPatient: { select: { id: true, fullName: true, deletedAt: true } },
          },
        })
      : [];

  const out: KioskCard[] = [...numberCards];
  const seen = new Set(out.map((c) => c.id));
  const add = (card: KioskCard) => {
    if (seen.has(card.id)) return;
    seen.add(card.id);
    out.push(card);
  };
  for (const s of sharers) {
    add({ id: s.id, fullName: s.fullName, relation: "contact", unverified: false });
  }
  for (const l of links) {
    const p = l.linkedPatient;
    if (!p || p.deletedAt) continue;
    add({ id: p.id, fullName: p.fullName, relation: "family", unverified: claim !== null });
  }
  return out.slice(0, MAX_KIOSK_CARDS);
}
