/**
 * Consume a `TelegramInviteToken` from the bot webhook.
 *
 * Flow on the Telegram side:
 *   1. Staff member opens the patient card → POSTs to
 *      `/api/crm/patients/[id]/telegram-invite` → receives
 *      `t.me/<bot>?start=<token>` and shares it with the patient. The same
 *      link is printed as a QR on the conclusion (see `mintOrReuseInviteUrl`).
 *   2. The patient taps the link in Telegram. The client sends
 *      `/start <token>` to the bot.
 *   3. The clinic-scoped webhook (`/api/telegram/webhook/[clinicSlug]`)
 *      calls `claimInviteToken(...)` whatever the bot's auto-reply flag or
 *      the thread's takeover mode (audit TG-07): the token is valid, this
 *      account is noted as the one that opened it, and the bot asks it to
 *      share its phone number (one «📱» button).
 *   4. The shared contact comes back to the webhook, which finds the pending
 *      claim (`findPendingInviteClaim`) and calls `consumeInviteToken(...)`
 *      with it.
 *
 * Why the phone (audit PT-04): the QR lives on paper the patient hands to an
 * employer, a pharmacy, or leaves in a taxi, and a link sent by reception can
 * go to the wrong number. When opening the link was enough, whoever scanned
 * it first became «this patient» in the Mini App for a month: every
 * conclusion, every document, and every future one in their Telegram.
 * Telegram vouches for a contact only when it is the sender's own
 * (`isOwnContact`), so a stranger cannot pass the check by typing the number
 * printed on the conclusion. Birth year or digits of the phone would not do:
 * the conclusion prints both.
 *
 * Responsibilities of `consumeInviteToken`:
 *   - Look up the row by `token` under the system context (no tenant
 *     scoping — the webhook does not run in a TENANT context).
 *   - Reject if expired or already consumed.
 *   - Link nothing unless the account shared its OWN contact and the number
 *     is the card's (`phone-required` / `phone-mismatch`).
 *   - Refuse to cross-link a token from clinic A onto a webhook firing
 *     for clinic B (defence in depth — the slug-pinned webhook is
 *     already isolated, but we double-check at the data layer).
 *   - Stamp `Patient.telegramId` (and `telegramUsername` when present).
 *     Skipped when the patient already carries a different telegramId —
 *     we do NOT silently overwrite an existing link.
 *   - One card per Telegram account (audit MA-04). A returning patient who
 *     opened the bot before scanning the invite already has an empty card
 *     the Mini App created on first open; that card is retired in the same
 *     transaction so the Mini App stops flip-flopping between the two. If
 *     the account's other card holds real history, nothing is relinked:
 *     reception gets a TELEGRAM_LINK_CONFLICT task and the token stays
 *     unconsumed for a retry after the merge.
 *   - Stamp `consumedAt` + `consumedTelegramId` on the token row.
 *   - Emit one audit row (`patient.telegram.invite_consumed`).
 *
 * Returns a small discriminated union the caller logs/emits as desired.
 * Side-effects are best-effort — a failure here MUST NOT abort the
 * welcome message (we still want the patient to see the bot reply).
 */
import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { phoneSearchVariants } from "@/lib/phone";
import { runWithTenant } from "@/lib/tenant-context";
import {
  canonicalPhone,
  isRealPhone,
  isRetirableAutoCard,
  isUniqueViolation,
  retiredCardData,
} from "@/server/patient/phone-identity";
import { raiseTelegramLinkConflict } from "@/server/patient/telegram-link-conflict";
import {
  isOwnContact,
  type SharedContact,
} from "@/server/telegram/contact-verify";

export type InviteConsumeResult =
  | {
      kind: "linked";
      patientId: string;
      tokenId: string;
      /** The empty auto-created card this account left behind, if any. */
      retiredPatientId?: string | null;
    }
  | {
      kind: "telegram-has-other-card";
      tokenId: string;
      patientId: string;
      otherPatientId: string;
    }
  /** No contact, or not the account's own: nothing was linked. */
  | { kind: "phone-required"; tokenId: string; patientId: string }
  /** The account's own number is not the card's: nothing was linked. */
  | { kind: "phone-mismatch"; tokenId: string; patientId: string }
  | { kind: "already-consumed"; tokenId: string }
  | { kind: "expired"; tokenId: string }
  | { kind: "patient-already-linked"; tokenId: string; patientId: string }
  | { kind: "wrong-clinic"; tokenId: string; expectedClinicId: string }
  | { kind: "not-found" };

export interface ConsumeInviteTokenInput {
  clinicId: string;
  token: string;
  telegramId: string;
  telegramUsername?: string | null;
  /**
   * The contact the account shared in the bot chat. Required: the card is
   * bound only when it is the account's own number (Telegram's `user_id`
   * matches the sender) and that number is the card's (audit PT-04).
   */
  contact?: SharedContact;
  now?: Date;
}

/**
 * Is the verified number the card's? The card's `phoneNormalized` may be of
 * either historical shape (LD-10), so the shared number is compared through
 * every search variant; a card holding a stub (`tg:…`, `family:…`) has no
 * number to prove and never matches.
 */
export function inviteCardPhoneMatches(
  cardPhoneNormalized: string | null | undefined,
  verifiedPhone: string,
): boolean {
  if (!verifiedPhone || !isRealPhone(cardPhoneNormalized)) return false;
  return phoneSearchVariants(verifiedPhone).includes(cardPhoneNormalized!);
}

/** The account's own number from a shared contact, or "" when unproven. */
function ownContactPhone(
  telegramId: string,
  contact: SharedContact | undefined,
): string {
  const fromId = Number(telegramId);
  if (!Number.isSafeInteger(fromId) || !isOwnContact(fromId, contact)) return "";
  return canonicalPhone(contact!.phone_number);
}

export async function consumeInviteToken(
  input: ConsumeInviteTokenInput,
): Promise<InviteConsumeResult> {
  const now = input.now ?? new Date();

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const row = await prisma.telegramInviteToken.findUnique({
      where: { token: input.token },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        expiresAt: true,
        consumedAt: true,
      },
    });
    if (!row) return { kind: "not-found" };

    if (row.clinicId !== input.clinicId) {
      return {
        kind: "wrong-clinic",
        tokenId: row.id,
        expectedClinicId: row.clinicId,
      };
    }
    if (row.consumedAt) {
      return { kind: "already-consumed", tokenId: row.id };
    }
    if (row.expiresAt <= now) {
      return { kind: "expired", tokenId: row.id };
    }

    const patient = await prisma.patient.findFirst({
      where: { id: row.patientId, clinicId: input.clinicId },
      select: {
        id: true,
        fullName: true,
        telegramId: true,
        phoneNormalized: true,
      },
    });
    if (!patient) {
      // The patient row vanished (cascade deletes wipe the token too,
      // but we guard against races just in case).
      return { kind: "not-found" };
    }
    if (patient.telegramId && patient.telegramId !== input.telegramId) {
      // The patient was linked to a different Telegram account in the
      // meantime — refuse to overwrite. The bot greets them as normal;
      // staff sees the audit row and can chase the discrepancy.
      return { kind: "patient-already-linked", tokenId: row.id, patientId: patient.id };
    }

    // PT-04: holding the token proves nothing (it is printed on paper).
    // The account's own, Telegram-vouched number must be the card's.
    const phone = ownContactPhone(input.telegramId, input.contact);
    if (!phone) {
      return { kind: "phone-required", tokenId: row.id, patientId: patient.id };
    }
    if (!inviteCardPhoneMatches(patient.phoneNormalized, phone)) {
      return { kind: "phone-mismatch", tokenId: row.id, patientId: patient.id };
    }

    // The account may already own another card here — typically the empty
    // one the Mini App created when the patient first opened the bot.
    const other = patient.telegramId
      ? null
      : await prisma.patient.findFirst({
          where: {
            clinicId: input.clinicId,
            telegramId: input.telegramId,
            id: { not: patient.id },
          },
          select: { id: true, fullName: true },
        });
    let retiredPatientId: string | null = null;
    if (other) {
      if (!(await isRetirableAutoCard(prisma, other.id))) {
        await raiseTelegramLinkConflict({
          clinicId: input.clinicId,
          telegramId: input.telegramId,
          telegramCard: other,
          clinicCard: { id: patient.id, fullName: patient.fullName },
          via: "invite",
        });
        return {
          kind: "telegram-has-other-card",
          tokenId: row.id,
          patientId: patient.id,
          otherPatientId: other.id,
        };
      }
      retiredPatientId = other.id;
    }

    try {
      await prisma.$transaction([
        // Retire first: the account's id must be free before the invited
        // card takes it (one card per account is a unique index).
        ...(other
          ? [
              prisma.patient.update({
                where: { id: other.id },
                data: retiredCardData(patient.id, other.id, now),
              }),
            ]
          : []),
        prisma.patient.update({
          where: { id: patient.id },
          data: {
            telegramId: input.telegramId,
            telegramUsername: input.telegramUsername ?? undefined,
            // First-link timestamp — drives the "+N за неделю" trend. Never overwrite.
            ...(patient.telegramId ? {} : { telegramLinkedAt: now }),
          },
        }),
        prisma.telegramInviteToken.update({
          where: { id: row.id },
          data: {
            consumedAt: now,
            consumedTelegramId: input.telegramId,
          },
        }),
      ]);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // A concurrent first open of the Mini App bound the account to a new
      // card between the lookup and the write. Leave the token for a retry.
      const raced = await prisma.patient.findFirst({
        where: { clinicId: input.clinicId, telegramId: input.telegramId },
        select: { id: true },
      });
      return {
        kind: "telegram-has-other-card",
        tokenId: row.id,
        patientId: patient.id,
        otherPatientId: raced?.id ?? "",
      };
    }

    try {
      await prisma.auditLog.create({
        data: {
          clinicId: input.clinicId,
          action: "patient.telegram.invite_consumed",
          entityType: "Patient",
          entityId: patient.id,
          meta: {
            tokenId: row.id,
            telegramId: input.telegramId,
            telegramUsername: input.telegramUsername ?? null,
            retiredPatientId,
          },
        },
      });
    } catch (auditErr) {
      console.warn("[telegram-invite] consume audit failed", auditErr);
    }

    return {
      kind: "linked",
      patientId: patient.id,
      tokenId: row.id,
      retiredPatientId,
    };
  });
}

/**
 * How long an opened invite waits for the phone. Long enough for a patient
 * who opened the link, put the phone down and came back later the same day;
 * short enough that a claim left behind by somebody else goes stale.
 */
export const INVITE_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;

export type InviteClaimResult =
  | {
      kind: "claimed";
      tokenId: string;
      patientId: string;
      /** The language of the invited card, for the bot's prompt. */
      lang: "ru" | "uz";
    }
  /** The card is already bound to this very account: nothing to do. */
  | { kind: "already-yours"; tokenId: string; patientId: string; lang: "ru" | "uz" }
  | { kind: "already-consumed"; tokenId: string }
  | { kind: "expired"; tokenId: string }
  | { kind: "patient-already-linked"; tokenId: string; patientId: string }
  | { kind: "wrong-clinic"; tokenId: string; expectedClinicId: string }
  | { kind: "not-found" };

/**
 * `/start <token>`: note which account opened a valid invite, so its next
 * shared contact is checked against the invited card (PT-04). Links nothing.
 * A later opener replaces an earlier one: only the account whose own number
 * is the card's can ever complete the link, whoever claimed last.
 */
export async function claimInviteToken(input: {
  clinicId: string;
  token: string;
  telegramId: string;
  now?: Date;
}): Promise<InviteClaimResult> {
  const now = input.now ?? new Date();
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const row = await prisma.telegramInviteToken.findUnique({
      where: { token: input.token },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        expiresAt: true,
        consumedAt: true,
      },
    });
    if (!row) return { kind: "not-found" };
    if (row.clinicId !== input.clinicId) {
      return {
        kind: "wrong-clinic",
        tokenId: row.id,
        expectedClinicId: row.clinicId,
      };
    }
    if (row.consumedAt) return { kind: "already-consumed", tokenId: row.id };
    if (row.expiresAt <= now) return { kind: "expired", tokenId: row.id };

    const patient = await prisma.patient.findFirst({
      where: { id: row.patientId, clinicId: input.clinicId, deletedAt: null },
      select: { id: true, telegramId: true, preferredLang: true },
    });
    if (!patient) return { kind: "not-found" };
    const lang = patient.preferredLang === "UZ" ? "uz" : "ru";
    if (patient.telegramId === input.telegramId) {
      return { kind: "already-yours", tokenId: row.id, patientId: patient.id, lang };
    }
    if (patient.telegramId) {
      return { kind: "patient-already-linked", tokenId: row.id, patientId: patient.id };
    }

    await prisma.telegramInviteToken.update({
      where: { id: row.id },
      data: { claimTelegramId: input.telegramId, claimedAt: now },
    });
    return { kind: "claimed", tokenId: row.id, patientId: patient.id, lang };
  });
}

/**
 * The invite this account opened and has not completed yet, if any: the
 * webhook routes the account's shared contact to it instead of the generic
 * contact flow.
 */
export async function findPendingInviteClaim(input: {
  clinicId: string;
  telegramId: string;
  now?: Date;
}): Promise<{ token: string; lang: "ru" | "uz" } | null> {
  const now = input.now ?? new Date();
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const row = await prisma.telegramInviteToken.findFirst({
      where: {
        clinicId: input.clinicId,
        claimTelegramId: input.telegramId,
        consumedAt: null,
        expiresAt: { gt: now },
        claimedAt: { gte: new Date(now.getTime() - INVITE_CLAIM_WINDOW_MS) },
      },
      orderBy: { claimedAt: "desc" },
      select: { token: true, patient: { select: { preferredLang: true } } },
    });
    if (!row) return null;
    return {
      token: row.token,
      lang: row.patient.preferredLang === "UZ" ? "uz" : "ru",
    };
  });
}

/** The bot's answer to a contact shared for a pending invite. */
export function inviteReplyKey(result: InviteConsumeResult): string {
  switch (result.kind) {
    case "linked":
      return "invite.linked";
    case "phone-required":
      return "invite.notOwn";
    case "phone-mismatch":
      return "invite.phoneMismatch";
    // Reception gets a TELEGRAM_LINK_CONFLICT task; the patient hears the
    // same neutral answer the contact flow gives (it reveals nothing).
    case "telegram-has-other-card":
      return "contact.pending";
    case "patient-already-linked":
    case "already-consumed":
    case "expired":
    case "wrong-clinic":
    case "not-found":
      return "invite.unavailable";
  }
}

/**
 * The bot's answer to `/start <token>`, or null to stay silent. Sent in every
 * auto-reply mode (audit TG-07): the patient scanned a QR in the cabinet or on
 * his paper conclusion and pressed Start, and with the bot's auto-reply off
 * (the production default) nothing else answers him.
 */
export function inviteClaimReplyKey(result: InviteClaimResult): string | null {
  switch (result.kind) {
    case "claimed":
      return "invite.confirmPhone";
    case "already-yours":
      return "invite.alreadyYours";
    case "expired":
      return "invite.expired";
    // A re-scanned link, a card bound to another account, or a /start
    // payload that is not ours: nothing useful to say, the FSM greets.
    case "already-consumed":
    case "patient-already-linked":
    case "wrong-clinic":
    case "not-found":
      return null;
  }
}

/**
 * Mint — or reuse within 24h — the patient's personal deep-link token.
 *
 * Extracted from the invite API route so the printed conclusion can carry the
 * same link as a QR: paper is the one artefact every patient walks out
 * holding, which makes it the highest-leverage place to grow bot adoption.
 * Reuse matters doubly here — every print/reprint of a conclusion calls this,
 * and each call must NOT mint a fresh row.
 *
 * Returns null when the clinic has no bot username (a t.me URL would be
 * meaningless) or the patient is already linked (nothing to invite).
 */
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REUSE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 h

export async function mintOrReuseInviteUrl(args: {
  patientId: string;
  createdByUserId: string | null;
}): Promise<{ url: string; token: string } | null> {
  const patient = await prisma.patient.findUnique({
    where: { id: args.patientId },
    select: { id: true, clinicId: true, telegramId: true, deletedAt: true },
  });
  if (!patient || patient.deletedAt || patient.telegramId) return null;

  const clinic = await prisma.clinic.findUnique({
    where: { id: patient.clinicId },
    select: { tgBotUsername: true },
  });
  if (!clinic?.tgBotUsername) return null;

  const now = new Date();
  const existing = await prisma.telegramInviteToken.findFirst({
    where: {
      patientId: patient.id,
      consumedAt: null,
      expiresAt: { gt: now },
      createdAt: { gte: new Date(now.getTime() - REUSE_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { token: true },
  });

  const token =
    existing?.token ??
    (
      await prisma.telegramInviteToken.create({
        data: {
          patientId: patient.id,
          clinicId: patient.clinicId,
          token: randomBytes(12).toString("base64url"),
          expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
          createdByUserId: args.createdByUserId,
        },
        select: { token: true },
      })
    ).token;

  return { url: `https://t.me/${clinic.tgBotUsername}?start=${token}`, token };
}
