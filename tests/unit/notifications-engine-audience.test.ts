/**
 * Audit TG-10: broadcast audience and launch.
 *
 *   - the Telegram / consent / block gates run in SQL before the row limit,
 *     so a clinic with more cards than the limit still reaches every
 *     Telegram patient;
 *   - an audience above the limit is reported (`truncated`) and the launch
 *     refuses it instead of cutting it silently;
 *   - two launches of one campaign at once insert one set of sends.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { matchesWhere } from "./notifications/where-matcher";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  patients: [] as Array<Record<string, unknown>>,
  findManyArgs: [] as Array<Record<string, unknown>>,
  campaign: null as null | Record<string, unknown>,
  inserted: [] as Array<Record<string, unknown>>,
  enqueued: [] as string[],
}));

vi.mock("@/lib/prisma", () => {
  const patient = {
    count: async ({ where }: { where: Row }) =>
      state.patients.filter((p) => matchesWhere(p, where)).length,
    findMany: async (args: { where: Row; take?: number }) => {
      state.findManyArgs.push(args);
      const rows = state.patients.filter((p) => matchesWhere(p, args.where));
      return rows.slice(0, args.take ?? rows.length);
    },
  };
  // One row lock: the conditional DRAFT → SENDING flip is atomic.
  const campaign = {
    findUnique: async () => (state.campaign ? { ...state.campaign } : null),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      if (!state.campaign || !matchesWhere(state.campaign, where)) return { count: 0 };
      Object.assign(state.campaign, data);
      return { count: 1 };
    },
    update: async ({ data }: { data: Row }) => Object.assign(state.campaign!, data),
  };
  const tx = {
    campaign,
    notificationSend: {
      createMany: async ({ data }: { data: Row[] }) => {
        data.forEach((d, i) => state.inserted.push({ id: `s${state.inserted.length + i}`, ...d }));
        return { count: data.length };
      },
      findMany: async () =>
        state.inserted.map((r) => ({ id: r.id, scheduledFor: r.scheduledFor })),
    },
    action: { findUnique: async () => null, update: async () => ({}) },
  };
  return {
    prisma: {
      patient,
      campaign,
      clinic: {
        findUnique: async () => ({
          nameRu: "НейроФакс",
          nameUz: "NeuroFax",
          phone: "+998712000000",
          addressRu: null,
          addressUz: null,
        }),
      },
      notificationTemplate: { findUnique: async () => null },
      appointment: { findMany: async () => [] },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

vi.mock("@/server/workers/notifications-send", () => ({
  enqueueDelivery: vi.fn(async (send: { id: string }) => {
    state.enqueued.push(send.id);
  }),
}));

function patient(i: number, over: Row = {}): Row {
  return {
    id: `p${String(i).padStart(5, "0")}`,
    fullName: `Пациент ${i}`,
    phone: `+99890${i}`,
    telegramId: null,
    preferredLang: "RU",
    lastVisitAt: null,
    marketingOptOut: false,
    tgBlockedAt: null,
    deletedAt: null,
    ...over,
  };
}

beforeEach(() => {
  state.patients = [];
  state.findManyArgs = [];
  state.campaign = null;
  state.inserted = [];
  state.enqueued = [];
});

describe("resolveAudience", () => {
  it("reaches every Telegram patient even when cards outnumber the limit", async () => {
    const { resolveAudience } = await import("@/server/campaigns/audience");
    const { MAX_AUDIENCE } = await import("@/server/campaigns/dormant-audience");
    // More never-visited cards without Telegram than one broadcast carries,
    // and 40 Telegram patients after them.
    for (let i = 0; i < MAX_AUDIENCE + 50; i++) state.patients.push(patient(i));
    for (let i = 0; i < 40; i++) {
      state.patients.push(
        patient(MAX_AUDIENCE + 100 + i, {
          telegramId: `tg${i}`,
          lastVisitAt: new Date("2026-05-01"),
        }),
      );
    }
    state.patients.push(patient(90001, { telegramId: "tgx", marketingOptOut: true }));
    state.patients.push(patient(90002, { telegramId: "tgy", tgBlockedAt: new Date() }));

    const res = await resolveAudience({ segment: { kind: "all" }, channel: "TG" });

    expect(res.eligible).toBe(40);
    expect(res.patients).toHaveLength(40);
    expect(res.truncated).toBe(false);
    expect(res.channelBreakdown).toEqual({
      tgReady: 40,
      noChannel: MAX_AUDIENCE + 50,
      optedOut: 1,
      blocked: 1,
    });
    // The limit applies to reachable patients, not to cards.
    const listQuery = state.findManyArgs[0]!;
    expect(listQuery.take).toBe(MAX_AUDIENCE);
    expect(JSON.stringify(listQuery.where)).toContain("tgBlockedAt");
  });

  it("flags an audience above the limit", async () => {
    const { resolveAudience } = await import("@/server/campaigns/audience");
    const { MAX_AUDIENCE } = await import("@/server/campaigns/dormant-audience");
    for (let i = 0; i < MAX_AUDIENCE + 1; i++) {
      state.patients.push(patient(i, { telegramId: `tg${i}` }));
    }
    const res = await resolveAudience({ segment: { kind: "all" }, channel: "TG" });
    expect(res.truncated).toBe(true);
    expect(res.eligible).toBe(MAX_AUDIENCE + 1);
    expect(res.limit).toBe(MAX_AUDIENCE);
  });
});

describe("launchCampaign", () => {
  function draft(): Row {
    return {
      id: "cmp_1",
      clinicId: "c1",
      name: "Акция",
      channel: "TG",
      status: "DRAFT",
      templateId: null,
      body: "{{patient.firstName}}, у нас акция",
      segment: { kind: "all" },
      scheduledFor: null,
      totalCount: 0,
    };
  }

  it("inserts one set of sends when two launches race", async () => {
    const { launchCampaign } = await import("@/server/campaigns/launch");
    state.campaign = draft();
    state.patients.push(patient(1, { telegramId: "tg1" }), patient(2, { telegramId: "tg2" }));

    const [a, b] = await Promise.all([
      launchCampaign({ campaignId: "cmp_1" }),
      launchCampaign({ campaignId: "cmp_1" }),
    ]);

    expect(state.inserted).toHaveLength(2);
    expect([a.alreadyLaunched, b.alreadyLaunched].sort()).toEqual([false, true]);
    expect(state.campaign!.status).toBe("SENDING");
    expect(state.enqueued).toHaveLength(2);
  });

  it("refuses an audience above the limit instead of cutting it", async () => {
    const { launchCampaign } = await import("@/server/campaigns/launch");
    const { MAX_AUDIENCE } = await import("@/server/campaigns/dormant-audience");
    state.campaign = draft();
    for (let i = 0; i < MAX_AUDIENCE + 1; i++) {
      state.patients.push(patient(i, { telegramId: `tg${i}` }));
    }
    await expect(launchCampaign({ campaignId: "cmp_1" })).rejects.toMatchObject({
      message: "AudienceTooLarge",
      status: 400,
    });
    expect(state.inserted).toHaveLength(0);
    expect(state.campaign!.status).toBe("DRAFT");
  });
});
