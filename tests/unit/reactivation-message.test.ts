/**
 * Audit AN-19: the «we miss you» message rendered with an empty clinic
 * («Запишитесь в  по телефону .»), always from the Russian text, and went to
 * patients with a CONFIRMED visit ahead. The CONFIRMED part was fixed by
 * AN-22 (pinned in an22-confirmed-bookings.test.ts); the text now names the
 * clinic in the patient's language, and only channels that deliver get a
 * row.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));

type Row = Record<string, unknown>;

function fakeDb(over: { channel?: string; lang?: "RU" | "UZ" } = {}) {
  const created: Row[] = [];
  const patientRow = {
    id: "p1",
    clinicId: "c1",
    fullName: "Каримов Азиз",
    phone: "+998901112233",
    telegramId: "tg_1",
    preferredChannel: "TG",
    preferredLang: over.lang ?? "UZ",
    reactivationSentAt: [],
    dormantSince: null,
    lastVisitAt: new Date("2026-05-01T00:00:00.000Z"),
    marketingOptOut: false,
    deletedAt: null,
  };
  const tx = {
    notificationSend: { create: vi.fn(async ({ data }: { data: Row }) => created.push(data)) },
    patient: { update: vi.fn(async () => ({})) },
  };
  const db = {
    patient: { findUnique: vi.fn(async () => patientRow), update: vi.fn(async () => ({})) },
    notificationTemplate: {
      findFirst: vi.fn(async () => ({
        id: "tpl_r",
        channel: over.channel ?? "TG",
        bodyRu: "{{patient.firstName}}, мы скучаем! {{clinic.name}}, {{clinic.phone}}",
        bodyUz: "{{patient.firstName}}, sizni sog'indik! {{clinic.name}}, {{clinic.phone}}",
      })),
    },
    clinic: {
      findUnique: vi.fn(async () => ({
        nameRu: "НейроФакс",
        nameUz: "NeuroFax",
        phone: "+998712000000",
        addressRu: "Ташкент",
        addressUz: "Toshkent",
      })),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { db, created };
}

const candidate = {
  patientId: "p1",
  segment: "recent_lapse" as const,
  lastVisitAt: new Date("2026-05-01T00:00:00.000Z"),
  daysSinceLastVisit: 150,
};

describe("reactivation message (AN-19)", () => {
  it("names the clinic and its phone in the patient's language", async () => {
    const { enqueueReactivationFor } = await import("@/server/revenue/reactivation");
    const { db, created } = fakeDb();
    const res = await enqueueReactivationFor(db as never, "c1", candidate);
    expect(res.scheduled).toBe(true);
    const tg = created.find((r) => r.channel === "TG")!;
    expect(tg.body).toBe("Каримов, sizni sog'indik! NeuroFax, +998712000000");
  });

  it("Russian for a Russian reader", async () => {
    const { enqueueReactivationFor } = await import("@/server/revenue/reactivation");
    const { db, created } = fakeDb({ lang: "RU" });
    await enqueueReactivationFor(db as never, "c1", candidate);
    expect(created[0]!.body).toBe("Каримов, мы скучаем! НейроФакс, +998712000000");
  });

  it("an EMAIL template is not addressed to the phone (INF-11)", async () => {
    const { enqueueReactivationFor } = await import("@/server/revenue/reactivation");
    const { db, created } = fakeDb({ channel: "EMAIL" });
    const res = await enqueueReactivationFor(db as never, "c1", candidate);
    expect(res).toEqual({ scheduled: false, reason: "no_recipient" });
    expect(created).toEqual([]);
  });
});
