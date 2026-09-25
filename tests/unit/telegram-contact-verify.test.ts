import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit PH-01 / MA-04: a Telegram account's OWN shared contact is the only
 * way a number reaches a Telegram-born card, and it is also the patient's
 * path to «I already have a card at this clinic».
 */

type Card = {
  id: string;
  clinicId: string;
  fullName: string;
  phone: string;
  phoneNormalized: string;
  phoneVerifiedAt: Date | null;
  telegramId: string | null;
  telegramUsername: string | null;
  telegramLinkedAt: Date | null;
  deletedAt: Date | null;
  source: string;
  appointments: number;
};

const state = vi.hoisted(() => ({
  cards: [] as Card[],
  audits: [] as Array<{ action: string; entityId: string | null }>,
  conflicts: [] as unknown[],
}));

type Where = {
  id?: string;
  clinicId?: string;
  telegramId?: string;
  phoneNormalized?: { in: string[] };
  phoneVerifiedAt?: null;
  deletedAt?: null;
};

function match(c: Card, w: Where): boolean {
  if (w.id !== undefined && c.id !== w.id) return false;
  if (w.clinicId !== undefined && c.clinicId !== w.clinicId) return false;
  if (w.telegramId !== undefined && c.telegramId !== w.telegramId) return false;
  if (w.phoneNormalized && !w.phoneNormalized.in.includes(c.phoneNormalized)) return false;
  if (w.phoneVerifiedAt === null && c.phoneVerifiedAt !== null) return false;
  if (w.deletedAt === null && c.deletedAt !== null) return false;
  return true;
}

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("@/lib/prisma", () => {
  const db = {
    patient: {
      findFirst: vi.fn(
        async ({ where, select }: { where: Where; select?: { _count?: unknown } }) => {
          const c = state.cards.find((x) => match(x, where));
          if (!c) return null;
          if (select?._count) {
            return {
              source: c.source,
              phoneVerifiedAt: c.phoneVerifiedAt,
              _count: { appointments: c.appointments, documents: 0 },
            };
          }
          return { ...c };
        },
      ),
      findMany: vi.fn(async ({ where }: { where: Where }) =>
        state.cards.filter((x) => match(x, where)).map((c) => ({ ...c })),
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<Card> }) => {
          const c = state.cards.find((x) => x.id === where.id)!;
          // The one-card-per-account unique index.
          if (
            data.telegramId &&
            state.cards.some(
              (x) => x.id !== c.id && x.clinicId === c.clinicId && x.telegramId === data.telegramId,
            )
          ) {
            const e = new Error("Unique constraint failed") as Error & { code?: string };
            e.code = "P2002";
            throw e;
          }
          Object.assign(c, data);
          return { ...c };
        },
      ),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: { action: string; entityId?: string } }) => {
        state.audits.push({ action: data.action, entityId: data.entityId ?? null });
        return { id: "a" };
      }),
    },
  };
  return {
    prisma: {
      ...db,
      $transaction: vi.fn(async (fn: (tx: typeof db) => unknown) => fn(db)),
    },
  };
});

vi.mock("@/server/patient/telegram-link-conflict", () => ({
  raiseTelegramLinkConflict: vi.fn(async (p: unknown) => {
    state.conflicts.push(p);
  }),
}));

import {
  applyVerifiedContact,
  contactReplyKey,
  isOwnContact,
  type ContactVerifyResult,
} from "@/server/telegram/contact-verify";
import { t as botT } from "@/server/telegram/messages";

const NOW = new Date("2026-09-25T10:00:00Z");
const PHONE = "+998901234567";

function card(over: Partial<Card> & { id: string }): Card {
  const c: Card = {
    clinicId: "c1",
    fullName: "Card",
    phone: `tg:${over.id}`,
    phoneNormalized: `tg:${over.id}`,
    phoneVerifiedAt: null,
    telegramId: null,
    telegramUsername: null,
    telegramLinkedAt: null,
    deletedAt: null,
    source: "TELEGRAM",
    appointments: 0,
    ...over,
  };
  state.cards.push(c);
  return c;
}

const byId = (id: string) => state.cards.find((c) => c.id === id)!;

function share(fromId: number, userId: number | undefined, phone = "998901234567") {
  return applyVerifiedContact({
    clinicId: "c1",
    fromId,
    fromUsername: "handle",
    contact: { phone_number: phone, user_id: userId },
    now: NOW,
  });
}

beforeEach(() => {
  state.cards = [];
  state.audits = [];
  state.conflicts = [];
});

describe("isOwnContact", () => {
  it("only a contact whose user_id is the sender vouches for the number", () => {
    expect(isOwnContact(111, { phone_number: PHONE, user_id: 111 })).toBe(true);
    expect(isOwnContact(111, { phone_number: PHONE, user_id: 222 })).toBe(false);
    expect(isOwnContact(111, { phone_number: PHONE })).toBe(false);
    expect(isOwnContact(undefined, { phone_number: PHONE, user_id: 111 })).toBe(false);
    expect(isOwnContact(111, undefined)).toBe(false);
  });
});

describe("applyVerifiedContact", () => {
  it("a forwarded contact card (someone else's number) changes nothing", async () => {
    card({ id: "me", telegramId: "111" });
    const r = await share(111, 222);
    expect(r).toEqual({ kind: "not-own-contact" });
    expect(byId("me").phoneNormalized).toBe("tg:me");
  });

  it("the sender's own card gets the number as verified identity", async () => {
    card({ id: "me", telegramId: "111" });
    const r = await share(111, 111);
    expect(r).toEqual({ kind: "verified", patientId: "me" });
    expect(byId("me")).toMatchObject({
      phone: PHONE,
      phoneNormalized: PHONE,
      phoneVerifiedAt: NOW,
    });
    expect(state.audits.map((a) => a.action)).toContain("patient.phone_verified_telegram");
  });

  it("a number the sender once typed into the Mini App is now proven", async () => {
    card({ id: "me", telegramId: "111", phone: PHONE, phoneNormalized: PHONE });
    const r = await share(111, 111);
    expect(r).toEqual({ kind: "verified", patientId: "me" });
    expect(byId("me").phoneVerifiedAt).toEqual(NOW);
  });

  it("MA-04: the number belongs to the clinic's card → the account moves there and the empty auto card is retired", async () => {
    card({ id: "auto", telegramId: "111", fullName: "Dilnoza" });
    card({
      id: "clinic",
      fullName: "Каримова Дилноза",
      phone: PHONE,
      phoneNormalized: PHONE,
      phoneVerifiedAt: new Date("2026-01-01"),
      source: "WALKIN",
      appointments: 3,
    });
    const r = await share(111, 111);
    expect(r).toEqual({ kind: "linked", patientId: "clinic", retiredPatientId: "auto" });
    expect(byId("clinic")).toMatchObject({
      telegramId: "111",
      telegramUsername: "handle",
      telegramLinkedAt: NOW,
    });
    expect(byId("auto")).toMatchObject({
      telegramId: null,
      deletedAt: NOW,
      deletionReason: "duplicate_of:clinic",
    });
    // Never two cards on one account.
    expect(state.cards.filter((c) => c.telegramId === "111")).toHaveLength(1);
    expect(state.conflicts).toHaveLength(0);
  });

  it("MA-04: an auto card that already holds visits is not merged: both stay, reception gets a task", async () => {
    card({ id: "auto", telegramId: "111", fullName: "Dilnoza", appointments: 1 });
    card({
      id: "clinic",
      fullName: "Каримова Дилноза",
      phone: PHONE,
      phoneNormalized: PHONE,
      phoneVerifiedAt: new Date("2026-01-01"),
      source: "WALKIN",
    });
    const r = await share(111, 111);
    expect(r).toEqual({ kind: "conflict", patientId: "auto", clinicCardId: "clinic" });
    expect(byId("auto").telegramId).toBe("111");
    expect(byId("clinic").telegramId).toBeNull();
    expect(state.conflicts).toEqual([
      expect.objectContaining({
        clinicId: "c1",
        telegramId: "111",
        clinicCard: expect.objectContaining({ id: "clinic" }),
        telegramCard: expect.objectContaining({ id: "auto" }),
        via: "contact",
      }),
    ]);
  });

  it("a clinic card already bound to another Telegram account is never taken over", async () => {
    card({ id: "auto", telegramId: "111" });
    card({
      id: "clinic",
      phone: PHONE,
      phoneNormalized: PHONE,
      phoneVerifiedAt: new Date("2026-01-01"),
      telegramId: "222",
      source: "WALKIN",
    });
    const r = await share(111, 111);
    expect(r.kind).toBe("conflict");
    expect(byId("clinic").telegramId).toBe("222");
    expect(byId("auto").telegramId).toBe("111");
  });

  it("PH-01: a card that only CLAIMED the number (typed in the Mini App by another account) loses it to the proven owner", async () => {
    card({
      id: "attacker",
      telegramId: "222",
      phone: PHONE,
      phoneNormalized: PHONE,
      phoneVerifiedAt: null,
    });
    card({ id: "victim", telegramId: "111" });
    const r = await share(111, 111);
    expect(r).toEqual({ kind: "verified", patientId: "victim" });
    expect(byId("attacker")).toMatchObject({ phone: "", phoneNormalized: "released:attacker" });
    expect(byId("victim")).toMatchObject({ phoneNormalized: PHONE, phoneVerifiedAt: NOW });
    expect(state.audits.map((a) => a.action)).toContain("patient.phone_claim_released");
  });

  it("a different number the clinic already recorded is kept, not overwritten", async () => {
    card({
      id: "me",
      telegramId: "111",
      phone: "+998935550000",
      phoneNormalized: "+998935550000",
      phoneVerifiedAt: new Date("2026-01-01"),
      source: "WALKIN",
    });
    const r = await share(111, 111);
    expect(r).toEqual({ kind: "kept-existing", patientId: "me" });
    expect(byId("me").phoneNormalized).toBe("+998935550000");
  });

  it("an account with no card here is told to open the app first", async () => {
    const r = await share(111, 111);
    expect(r).toEqual({ kind: "no-card" });
  });
});

describe("contactReplyKey", () => {
  it("every outcome has a bot reply in both languages", () => {
    const outcomes: ContactVerifyResult[] = [
      { kind: "not-own-contact" },
      { kind: "bad-phone" },
      { kind: "no-card" },
      { kind: "verified", patientId: "p" },
      { kind: "linked", patientId: "p", retiredPatientId: null },
      { kind: "kept-existing", patientId: "p" },
      { kind: "conflict", patientId: null, clinicCardId: "c" },
      { kind: "failed" },
    ];
    for (const o of outcomes) {
      const key = contactReplyKey(o);
      for (const lang of ["ru", "uz"] as const) {
        const text = botT(lang, key);
        expect(text).not.toBe(key);
        // House style for new copy: no dashes.
        expect(text).not.toMatch(/[—–]/);
      }
    }
  });
});
