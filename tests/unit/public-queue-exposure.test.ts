/**
 * Audit INF-10: the public board stream handed every appointment id of the
 * clinic to anyone holding the slug, and `/api/queue/status/<id>` then
 * answered initials, doctor, service and time for each of them. A day of
 * listening was a log of who visited the neurologist and for what.
 *
 * Pinned here:
 *   - the status endpoint takes only a server-signed ticket token: a bare
 *     appointment id is a 404, and the token works on the appointment's own
 *     clinic day only (410 otherwise), with no service name in the answer;
 *   - the paper ticket's QR and the `/t/<code>` short link lead to the
 *     token, never the id;
 *   - the anonymous stream refuses an address's 11th concurrent connection,
 *     while a doctor's own TV (`?screen=<tvToken>`) is never refused.
 *
 * The stream payload half (no appointment id) is in queue-board-stream and
 * queue-call-display tests.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  appointment: null as Record<string, unknown> | null,
  appointmentLookups: 0,
  screenDoctor: null as { id: string } | null,
  unsubscribed: 0,
  qrUrls: [] as string[],
  ticketCodeHit: null as { id: string } | null,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(async (args: { where: { id?: string; ticketCode?: string } }) => {
        h.appointmentLookups++;
        if (args.where.ticketCode !== undefined) return h.ticketCodeHit;
        return h.appointment;
      }),
    },
    doctor: { findFirst: vi.fn(async () => h.screenDoctor) },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runUnscoped: <T,>(_reason: string, fn: () => T) => fn(),
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
}));
vi.mock("@/server/appointments/queue-projection", () => ({
  getQueueProjection: vi.fn(async () =>
    new Map([
      [
        "doc_1",
        {
          waiting: [{ appointmentId: "cmapt000000000000000001", position: 2, etaMinutes: 10 }],
          etaConfidence: "med",
          etaSource: "history",
        },
      ],
    ]),
  ),
}));
vi.mock("@/server/clinic-public/resolve", () => ({
  resolvePublicClinic: vi.fn(async () => ({
    ok: true,
    ctx: { clinicId: "c1", clinicSlug: "neurofax" },
  })),
}));
vi.mock("@/server/realtime/event-bus", () => ({
  getEventBus: () => ({
    subscribe: () => () => {
      h.unsubscribed++;
    },
  }),
}));
vi.mock("@/server/realtime/redis-adapter", () => ({
  isRedisEnabled: () => false,
  ensureRedisSubscriber: () => {},
}));
vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(async (url: string) => {
      h.qrUrls.push(url);
      return "data:image/png;base64,AAAA";
    }),
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.9" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

import { NextRequest } from "next/server";

import {
  boardRowKey,
  parseQueueTicketToken,
  queueTicketToken,
  ticketDayState,
} from "@/server/appointments/public-ticket";
import { GET as statusGET } from "@/app/api/queue/status/[token]/route";
import {
  GET as boardEventsGET,
  MAX_STREAMS_PER_ADDRESS,
} from "@/app/api/c/[slug]/queue/events/route";
import { __resetConnectionCapsForTests } from "@/server/realtime/connection-cap";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";

const APPT_ID = "cmapt000000000000000001";

beforeAll(() => {
  process.env.APP_SECRET = "test-app-secret";
});

function walkin(date: Date): Record<string, unknown> {
  return {
    id: APPT_ID,
    clinicId: "c1",
    doctorId: "doc_1",
    date,
    queueStatus: "WAITING",
    queueOrder: 3,
    ticketSeq: 3,
    channel: "WALKIN",
    time: null,
    patient: { fullName: "Турматов Олим Ботирович" },
    doctor: {
      id: "doc_1",
      nameRu: "Султанов Азиз",
      ticketPrefix: "A",
      cabinet: { number: "3" },
    },
    primaryService: { nameRu: "ЭЭГ" },
    clinic: { nameRu: "Neurofax", slug: "neurofax" },
  };
}

async function status(token: string) {
  return statusGET(new Request(`https://neurofax.uz/api/queue/status/${token}`), {
    params: Promise.resolve({ token }),
  });
}

beforeEach(() => {
  h.appointment = walkin(new Date());
  h.appointmentLookups = 0;
  h.screenDoctor = null;
  h.unsubscribed = 0;
  h.qrUrls = [];
  h.ticketCodeHit = null;
  __resetConnectionCapsForTests();
  __resetRateLimitsForTests();
});

describe("ticket token", () => {
  it("round-trips and is not the bare id", () => {
    const token = queueTicketToken(APPT_ID);
    expect(token).not.toBe(APPT_ID);
    expect(parseQueueTicketToken(token)).toEqual({
      kind: "token",
      appointmentId: APPT_ID,
    });
  });

  it("a bare id is a legacy link, a forged signature is invalid", () => {
    expect(parseQueueTicketToken(APPT_ID)).toEqual({ kind: "legacy" });
    expect(parseQueueTicketToken(`${APPT_ID}.forged`)).toEqual({ kind: "invalid" });
    // The board row key is a different HMAC purpose: it opens nothing.
    expect(parseQueueTicketToken(`${APPT_ID}.${boardRowKey(APPT_ID)}`)).toEqual({
      kind: "invalid",
    });
    // Another appointment's signature does not carry over.
    const other = queueTicketToken("cmapt000000000000000002").split(".")[1];
    expect(parseQueueTicketToken(`${APPT_ID}.${other}`)).toEqual({ kind: "invalid" });
  });

  it("knows the clinic day, not the UTC one", () => {
    // 23:30 Tashkent on the 27th is 18:30 UTC; «now» 00:30 Tashkent on the 28th.
    const late = new Date("2026-09-27T18:30:00.000Z");
    const now = new Date("2026-09-27T19:30:00.000Z");
    expect(ticketDayState(late, now)).toBe("past");
    expect(ticketDayState(new Date("2026-09-27T19:45:00.000Z"), now)).toBe("today");
    expect(ticketDayState(new Date("2026-09-29T05:00:00.000Z"), now)).toBe("future");
  });
});

describe("GET /api/queue/status/:token", () => {
  it("the bare appointment id is a 404, without even a lookup", async () => {
    const res = await status(APPT_ID);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ reason: "legacy_link" });
    expect(h.appointmentLookups).toBe(0);
  });

  it("a forged token is a 404", async () => {
    const res = await status(`${APPT_ID}.AAAAAAAAAAAAAAAAAAAAAA`);
    expect(res.status).toBe(404);
    expect(h.appointmentLookups).toBe(0);
  });

  it("the signed token works today and never names the service", async () => {
    const res = await status(queueTicketToken(APPT_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.patientName).toBe("Турматов О. Б.");
    expect(body.ticketNumber).toBe("A-003");
    expect(body.position).toBe(2);
    expect(body).not.toHaveProperty("service");
    expect(JSON.stringify(body)).not.toContain("ЭЭГ");
  });

  it("yesterday's ticket has expired, next week's is not open yet", async () => {
    h.appointment = walkin(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
    let res = await status(queueTicketToken(APPT_ID));
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ reason: "expired" });

    h.appointment = walkin(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    res = await status(queueTicketToken(APPT_ID));
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ reason: "not_today" });
  });
});

describe("links that lead to the status page", () => {
  it("the paper ticket's QR carries the signed token, not the id", async () => {
    const { default: TicketPage } = await import("@/app/ticket/[id]/page");
    await TicketPage({ params: Promise.resolve({ id: APPT_ID }) });
    expect(h.qrUrls).toHaveLength(1);
    expect(h.qrUrls[0]).toMatch(new RegExp(`/q/${queueTicketToken(APPT_ID).replace(/[.]/g, "\\.")}$`));
    expect(h.qrUrls[0]).not.toMatch(new RegExp(`/q/${APPT_ID}$`));
  });

  it("/t/<code> redirects to the signed token, not the id", async () => {
    h.ticketCodeHit = { id: APPT_ID };
    const { default: TicketResolver } = await import("@/app/t/[code]/page");
    await expect(
      TicketResolver({ params: Promise.resolve({ code: "ABC234" }) }),
    ).rejects.toThrow(`NEXT_REDIRECT /q/${queueTicketToken(APPT_ID)}`);
  });

  it("/t/<code> stops resolving after 20 codes a minute from one address", async () => {
    const { default: TicketResolver } = await import("@/app/t/[code]/page");
    for (let i = 0; i < 20; i++) {
      await expect(
        TicketResolver({ params: Promise.resolve({ code: "ABC234" }) }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
    }
    const before = h.appointmentLookups;
    await expect(
      TicketResolver({ params: Promise.resolve({ code: "ABC234" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.appointmentLookups).toBe(before);
  });
});

describe("GET /api/c/<slug>/queue/events connection cap", () => {
  const opened: AbortController[] = [];
  afterEach(() => {
    for (const ac of opened.splice(0)) ac.abort();
  });

  function open(ip: string, query = "") {
    const ac = new AbortController();
    opened.push(ac);
    const req = new NextRequest(
      `https://neurofax.uz/api/c/neurofax/queue/events${query}`,
      { headers: { "x-real-ip": ip }, signal: ac.signal },
    );
    return { ac, res: boardEventsGET(req) };
  }

  it("refuses the 11th stream from one address and frees a slot on disconnect", async () => {
    expect(MAX_STREAMS_PER_ADDRESS).toBe(10);
    const first = open("198.51.100.7");
    expect((await first.res).status).toBe(200);
    for (let i = 1; i < 10; i++) {
      expect((await open("198.51.100.7").res).status).toBe(200);
    }
    const eleventh = await open("198.51.100.7").res;
    expect(eleventh.status).toBe(429);
    expect(await eleventh.json()).toMatchObject({ reason: "too_many_streams" });

    // Another address is unaffected.
    expect((await open("198.51.100.8").res).status).toBe(200);

    // One closes: its slot comes back and its bus subscription is gone.
    first.ac.abort();
    expect(h.unsubscribed).toBe(1);
    expect((await open("198.51.100.7").res).status).toBe(200);
  });

  it("a doctor's own TV is never counted against the clinic's address", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await open("198.51.100.7").res).status).toBe(200);
    }
    h.screenDoctor = { id: "doc_1" };
    expect((await open("198.51.100.7", "?screen=tv_token_1").res).status).toBe(200);
    // A wrong screen token is just an anonymous stream.
    h.screenDoctor = null;
    expect((await open("198.51.100.7", "?screen=guess").res).status).toBe(429);
  });
});
