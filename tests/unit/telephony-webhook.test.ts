/**
 * Unit tests for the SIP provider webhook (`/api/calls/sip/event`).
 *
 * The endpoint runs outside a NextAuth session and uses `runWithTenant`
 * internally; we stub Prisma + the tenant module so no database is needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CallRow = {
  id: string;
  clinicId: string;
  direction: "IN" | "OUT" | "MISSED";
  status: "RINGING" | "ANSWERED" | "ENDED" | "MISSED" | null;
  fromNumber: string;
  toNumber: string;
  sipCallId: string | null;
  patientId: string | null;
  operatorId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  recordingUrl: string | null;
  tags: string[];
};

type UserRow = { id: string; clinicId: string | null; active: boolean };

type PatientRow = {
  id: string;
  clinicId: string;
  phoneNormalized: string;
  phone: string;
  phoneVerifiedAt: Date | null;
};

type ClinicRow = {
  id: string;
  slug: string;
};

type ProviderConnectionRow = {
  clinicId: string;
  kind: "TELEGRAM" | "SMS" | "PAYME" | "CLICK" | "UZUM" | "OPENAI" | "OTHER";
  label: string | null;
  active: boolean;
  config: Record<string, unknown> | null;
};

const state = {
  calls: [] as CallRow[],
  patients: [] as PatientRow[],
  clinics: [] as ClinicRow[],
  providers: [] as ProviderConnectionRow[],
  users: [] as UserRow[],
  nextId: 1,
  /** Set to make the next call write throw (a database outage). */
  failWrites: false,
};

function blankCall(over: Partial<CallRow> & { clinicId: string }): CallRow {
  return {
    id: String(state.nextId++),
    direction: "IN",
    status: null,
    fromNumber: "",
    toNumber: "",
    sipCallId: null,
    patientId: null,
    operatorId: null,
    createdAt: new Date(),
    startedAt: null,
    answeredAt: null,
    endedAt: null,
    durationSec: null,
    recordingUrl: null,
    tags: [],
    ...over,
  };
}

function guardWrite(): void {
  if (state.failWrites) throw new Error("connection refused");
}

function findCallBySip(clinicId: string, sipCallId: string): CallRow | null {
  return state.calls.find((c) => c.clinicId === clinicId && c.sipCallId === sipCallId) ?? null;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findUnique: vi.fn(async (args: { where: { slug: string } }) => {
        return state.clinics.find((c) => c.slug === args.where.slug) ?? null;
      }),
    },
    providerConnection: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          clinicId: string;
          active: boolean;
          kind: string;
          label: string;
        };
        return (
          state.providers.find(
            (p) =>
              p.clinicId === w.clinicId &&
              p.kind === w.kind &&
              p.label === w.label &&
              p.active === w.active,
          ) ?? null
        );
      }),
    },
    patient: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        // Inbound caller match: only the VERIFIED owner of the number
        // (audit PH-01), by phoneNormalized.
        const w = args.where as {
          clinicId: string;
          phoneNormalized?: { in: string[] };
          phoneVerifiedAt?: { not: null };
        };
        const variants = new Set<string>(w.phoneNormalized?.in ?? []);
        return (
          state.patients.find(
            (p) =>
              p.clinicId === w.clinicId &&
              variants.has(p.phoneNormalized) &&
              (!w.phoneVerifiedAt || p.phoneVerifiedAt !== null),
          ) ?? null
        );
      }),
    },
    user: {
      findFirst: vi.fn(
        async (args: { where: { id: string; clinicId: string; active?: boolean } }) =>
          state.users.find(
            (u) =>
              u.id === args.where.id &&
              u.clinicId === args.where.clinicId &&
              (args.where.active === undefined || u.active === args.where.active),
          ) ?? null,
      ),
    },
    call: {
      upsert: vi.fn(
        async (args: {
          where: { clinicId_sipCallId: { clinicId: string; sipCallId: string } };
          create: Partial<CallRow> & { clinicId: string; sipCallId: string };
          update: Partial<CallRow>;
        }) => {
          guardWrite();
          const { clinicId, sipCallId } = args.where.clinicId_sipCallId;
          const existing = findCallBySip(clinicId, sipCallId);
          if (existing) {
            for (const [k, v] of Object.entries(args.update)) {
              if (v !== undefined) (existing as Record<string, unknown>)[k] = v;
            }
            return existing;
          }
          const row = blankCall({ ...args.create, clinicId, sipCallId });
          state.calls.push(row);
          return row;
        },
      ),
      findUnique: vi.fn(async (args: { where: { clinicId_sipCallId: { clinicId: string; sipCallId: string } } }) => {
        return findCallBySip(
          args.where.clinicId_sipCallId.clinicId,
          args.where.clinicId_sipCallId.sipCallId,
        );
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Partial<CallRow> }) => {
        guardWrite();
        const row = state.calls.find((c) => c.id === args.where.id);
        if (!row) throw new Error("Not found");
        for (const [k, v] of Object.entries(args.data)) {
          if (v !== undefined) (row as Record<string, unknown>)[k] = v;
        }
        return row;
      }),
      // Close-if-live: `{ id, endedAt: null }`.
      updateMany: vi.fn(
        async (args: { where: { id: string; endedAt?: null }; data: Partial<CallRow> }) => {
          guardWrite();
          const row = state.calls.find(
            (c) =>
              c.id === args.where.id &&
              (args.where.endedAt === undefined || c.endedAt === null),
          );
          if (!row) return { count: 0 };
          Object.assign(row, args.data);
          return { count: 1 };
        },
      ),
      create: vi.fn(
        async (args: {
          data: Partial<CallRow> & { clinicId: string; direction: CallRow["direction"] };
        }) => {
          guardWrite();
          const row = blankCall(args.data);
          state.calls.push(row);
          return row;
        },
      ),
    },
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async <T,>(_ctx: unknown, fn: () => T | Promise<T>) => fn(),
}));

const published = vi.hoisted(() => ({
  bus: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
  events: [] as Array<{ clinicId: string; type: string }>,
}));
vi.mock("@/server/realtime/event-bus", () => ({
  publish: (channel: string, payload: Record<string, unknown>) => {
    published.bus.push({ channel, payload });
  },
}));
vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: (clinicId: string, e: { type: string }) => {
    published.events.push({ clinicId, type: e.type });
  },
}));
vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: async () => undefined,
}));

// Import AFTER mocks.
import { POST, GET } from "@/app/api/calls/sip/event/route";

function buildRequest(
  body: unknown,
  {
    slug = "neurofax",
    secret,
    useHeader = true,
  }: { slug?: string; secret?: string; useHeader?: boolean } = {},
): Request {
  const url = new URL(`https://example.test/api/calls/sip/event?clinicSlug=${slug}`);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) {
    if (useHeader) headers["x-sip-secret"] = secret;
    else url.searchParams.set("secret", secret);
  }
  return new Request(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.calls.length = 0;
  state.patients.length = 0;
  state.clinics.length = 0;
  state.providers.length = 0;
  state.users.length = 0;
  state.nextId = 1;
  state.failWrites = false;
  published.bus.length = 0;
  published.events.length = 0;

  state.clinics.push({ id: "clinic-a", slug: "neurofax" });
  state.patients.push({
    id: "p1",
    clinicId: "clinic-a",
    phoneNormalized: "+998901234567",
    phone: "+998901234567",
    phoneVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  });
  (process.env as Record<string, string>).NODE_ENV = "development";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SIP webhook — method guards", () => {
  it("returns 405 on GET", async () => {
    const res = await (GET as unknown as () => Promise<Response>)();
    expect(res.status).toBe(405);
  });
});

describe("SIP webhook — clinic resolution", () => {
  it("returns 404 when no clinicSlug is supplied", async () => {
    const req = new Request("https://example.test/api/calls/sip/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown clinic", async () => {
    const res = await POST(
      buildRequest({ kind: "ringing", callId: "x", from: "+1", to: "+2", timestamp: new Date() }, {
        slug: "does-not-exist",
      }) as never,
    );
    expect(res.status).toBe(404);
  });
});

describe("SIP webhook — secret verification", () => {
  it("accepts a request with no configured secret in dev mode (with warning)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(
      buildRequest({
        kind: "ringing",
        callId: "log-dev-1",
        from: "+998901234567",
        to: "+998712001020",
        timestamp: new Date("2026-04-22T10:00:00Z"),
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects a request with no secret in production", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    const res = await POST(
      buildRequest({
        kind: "ringing",
        callId: "log-prod-1",
        from: "+998901234567",
        to: "+998712001020",
        timestamp: new Date("2026-04-22T10:00:00Z"),
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("rejects when the provided secret doesn't match", async () => {
    state.providers.push({
      clinicId: "clinic-a",
      kind: "OTHER",
      label: "sip",
      active: true,
      config: { webhookSecret: "correct-horse" },
    });
    const res = await POST(
      buildRequest(
        {
          kind: "ringing",
          callId: "log-1",
          from: "+998901234567",
          to: "+998712001020",
          timestamp: new Date("2026-04-22T10:00:00Z"),
        },
        { secret: "battery-staple" },
      ) as never,
    );
    expect(res.status).toBe(401);
  });

  it("accepts the matching secret", async () => {
    state.providers.push({
      clinicId: "clinic-a",
      kind: "OTHER",
      label: "sip",
      active: true,
      config: { webhookSecret: "correct-horse" },
    });
    const res = await POST(
      buildRequest(
        {
          kind: "ringing",
          callId: "log-2",
          from: "+998901234567",
          to: "+998712001020",
          timestamp: new Date("2026-04-22T10:00:00Z"),
        },
        { secret: "correct-horse" },
      ) as never,
    );
    expect(res.status).toBe(200);
  });
});

describe("SIP webhook — event handling", () => {
  it("ringing → upserts a Call and links patient by phone", async () => {
    const res = await POST(
      buildRequest({
        kind: "ringing",
        callId: "log-ring-1",
        from: "+998901234567",
        to: "+998712001020",
        timestamp: new Date("2026-04-22T10:00:00Z"),
      }) as never,
    );
    expect(res.status).toBe(200);
    const row = findCallBySip("clinic-a", "log-ring-1");
    expect(row).toBeTruthy();
    expect(row?.direction).toBe("IN");
    expect(row?.patientId).toBe("p1");
  });

  it("ringing from a number only CLAIMED in the Mini App links no card (audit PH-01)", async () => {
    // Someone typed this number into his own Telegram card: showing him as
    // «the caller» would invite reception to book the real caller into it.
    state.patients.push({
      id: "p_claim",
      clinicId: "clinic-a",
      phoneNormalized: "+998907777777",
      phone: "+998907777777",
      phoneVerifiedAt: null,
    });
    await POST(
      buildRequest({
        kind: "ringing",
        callId: "log-claim-1",
        from: "+998907777777",
        to: "+998712001020",
        timestamp: new Date("2026-04-22T10:00:00Z"),
      }) as never,
    );
    expect(findCallBySip("clinic-a", "log-claim-1")?.patientId).toBeNull();
  });

  // Audit CM-10: the duration is the talk time, from the answer.
  it("hangup of an answered call: ENDED, durationSec from answeredAt", async () => {
    const at = (s: string) => new Date(`2026-04-22T10:${s}Z`);
    const evt = (kind: string, ts: Date) =>
      buildRequest({
        kind,
        callId: "log-dur-1",
        from: "+998901234567",
        to: "+998712001020",
        timestamp: ts,
      }) as never;
    await POST(evt("ringing", at("00:00")));
    await POST(evt("answered", at("00:40")));
    await POST(evt("hangup", at("02:40"))); // 120 s after the answer
    const updated = findCallBySip("clinic-a", "log-dur-1");
    expect(updated?.endedAt).toBeInstanceOf(Date);
    expect(updated?.status).toBe("ENDED");
    expect(updated?.direction).toBe("IN");
    expect(updated?.durationSec).toBe(120);
    expect(published.events.map((e) => e.type)).toContain("call.ended");
  });

  // Audit CM-10: ringing → hangup with no answer is a missed call, counted
  // by the badge (direction) and never a «conversation» in the funnel.
  it("hangup of an unanswered call: MISSED, direction MISSED, no duration", async () => {
    const evt = (kind: string, ts: string) =>
      buildRequest({
        kind,
        callId: "log-unans-1",
        from: "+998901234567",
        to: "+998712001020",
        timestamp: ts,
      }) as never;
    await POST(evt("ringing", "2026-04-22T10:00:00Z"));
    await POST(evt("hangup", "2026-04-22T10:00:40Z"));
    const row = findCallBySip("clinic-a", "log-unans-1");
    expect(row?.status).toBe("MISSED");
    expect(row?.direction).toBe("MISSED");
    expect(row?.durationSec).toBeNull();
    expect(published.events.map((e) => e.type)).toContain("call.missed");
  });

  it("missed marks an existing Call MISSED and sets endedAt", async () => {
    await POST(
      buildRequest({
        kind: "ringing",
        callId: "log-miss-1",
        from: "+998901234567",
        to: "+998712001020",
        timestamp: new Date("2026-04-22T10:00:00Z"),
      }) as never,
    );
    await POST(
      buildRequest({
        kind: "missed",
        callId: "log-miss-1",
        from: "+998901234567",
        to: "+998712001020",
        timestamp: new Date("2026-04-22T10:00:30Z"),
      }) as never,
    );
    const row = findCallBySip("clinic-a", "log-miss-1");
    expect(row?.direction).toBe("MISSED");
    expect(row?.endedAt).toBeInstanceOf(Date);
  });

  it("answered is idempotent — re-applying the event doesn't duplicate tags", async () => {
    await POST(
      buildRequest({
        kind: "ringing",
        callId: "log-ans-1",
        from: "+998901234567",
        to: "+998712001020",
        timestamp: new Date("2026-04-22T10:00:00Z"),
      }) as never,
    );
    await POST(
      buildRequest({
        kind: "answered",
        callId: "log-ans-1",
        from: "+998901234567",
        to: "+998712001020",
        timestamp: new Date("2026-04-22T10:00:05Z"),
      }) as never,
    );
    await POST(
      buildRequest({
        kind: "answered",
        callId: "log-ans-1",
        from: "+998901234567",
        to: "+998712001020",
        timestamp: new Date("2026-04-22T10:00:10Z"),
      }) as never,
    );
    const row = findCallBySip("clinic-a", "log-ans-1");
    expect(row?.tags.filter((t) => t === "answered")).toHaveLength(1);
  });

  it("returns 400 on malformed JSON", async () => {
    const url = new URL(
      "https://example.test/api/calls/sip/event?clinicSlug=neurofax",
    );
    const req = new Request(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 on schema violation", async () => {
    const res = await POST(
      buildRequest({ kind: "unknown", callId: "log-bad", from: "", to: "", timestamp: "bad" }) as never,
    );
    expect(res.status).toBe(400);
  });
});

describe("SIP webhook — audit CM-01", () => {
  const ring = (callId: string, extra: Record<string, unknown> = {}) => ({
    kind: "ringing",
    callId,
    from: "+998901234567",
    to: "+998712001020",
    timestamp: "2026-04-22T10:00:00Z",
    ...extra,
  });

  it("a secret in the query string is not accepted", async () => {
    state.providers.push({
      clinicId: "clinic-a",
      kind: "OTHER",
      label: "sip",
      active: true,
      config: { webhookSecret: "correct-horse" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(
      buildRequest(ring("q-1"), { secret: "correct-horse", useHeader: false }) as never,
    );
    expect(res.status).toBe(401);
    expect(findCallBySip("clinic-a", "q-1")).toBeNull();
    warn.mockRestore();
  });

  it("a database error answers 500, so the provider retries", async () => {
    state.failWrites = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(buildRequest(ring("db-1")) as never);
    expect(res.status).toBe(500);
    error.mockRestore();
    // The retry lands once the database is back.
    state.failWrites = false;
    expect((await POST(buildRequest(ring("db-1")) as never)).status).toBe(200);
    expect(findCallBySip("clinic-a", "db-1")?.status).toBe("RINGING");
  });

  it("an unknown operator («101») creates the call without an operator", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(buildRequest(ring("op-1", { operatorId: "101" })) as never);
    expect(res.status).toBe(200);
    const row = findCallBySip("clinic-a", "op-1");
    expect(row).toBeTruthy();
    expect(row?.operatorId).toBeNull();
    warn.mockRestore();
  });

  it("an extension mapped in the SIP connection names the clinic's user", async () => {
    state.users.push({ id: "u_op", clinicId: "clinic-a", active: true });
    state.providers.push({
      clinicId: "clinic-a",
      kind: "OTHER",
      label: "sip",
      active: true,
      config: { webhookSecret: "s3cret", extensions: { "101": "u_op" } },
    });
    await POST(buildRequest(ring("op-2"), { secret: "s3cret" }) as never);
    await POST(
      buildRequest(
        { ...ring("op-2"), kind: "answered", operatorId: "101", timestamp: "2026-04-22T10:00:05Z" },
        { secret: "s3cret" },
      ) as never,
    );
    expect(findCallBySip("clinic-a", "op-2")?.operatorId).toBe("u_op");
  });

  it("another clinic's user id is not written as the operator", async () => {
    state.users.push({ id: "u_other", clinicId: "clinic-b", active: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await POST(buildRequest(ring("op-3", { operatorId: "u_other" })) as never);
    expect(findCallBySip("clinic-a", "op-3")?.operatorId).toBeNull();
    warn.mockRestore();
  });

  it("unix seconds are read as seconds, not as 1970", async () => {
    await POST(buildRequest(ring("ts-1", { timestamp: 1776852000 })) as never);
    expect(findCallBySip("clinic-a", "ts-1")?.startedAt?.toISOString()).toBe(
      "2026-04-22T10:00:00.000Z",
    );
  });

  it("an ISO time without a zone is refused (400), not guessed", async () => {
    const res = await POST(
      buildRequest(ring("ts-2", { timestamp: "2026-04-22T15:00:00" })) as never,
    );
    expect(res.status).toBe(400);
  });

  it("a late answered never reopens a finished call", async () => {
    await POST(buildRequest(ring("late-1")) as never);
    await POST(
      buildRequest({ ...ring("late-1"), kind: "answered", timestamp: "2026-04-22T10:00:10Z" }) as never,
    );
    await POST(
      buildRequest({ ...ring("late-1"), kind: "hangup", timestamp: "2026-04-22T10:03:10Z" }) as never,
    );
    published.events.length = 0;
    await POST(
      buildRequest({ ...ring("late-1"), kind: "answered", timestamp: "2026-04-22T10:04:00Z" }) as never,
    );
    const row = findCallBySip("clinic-a", "late-1");
    expect(row?.status).toBe("ENDED");
    expect(row?.durationSec).toBe(180);
    expect(published.events).toEqual([]);
  });

  it("an answer that arrives after the hangup but happened before it makes the call a conversation", async () => {
    await POST(buildRequest(ring("ooo-1")) as never);
    await POST(
      buildRequest({ ...ring("ooo-1"), kind: "hangup", timestamp: "2026-04-22T10:02:00Z" }) as never,
    );
    expect(findCallBySip("clinic-a", "ooo-1")?.status).toBe("MISSED");
    await POST(
      buildRequest({ ...ring("ooo-1"), kind: "answered", timestamp: "2026-04-22T10:00:30Z" }) as never,
    );
    const row = findCallBySip("clinic-a", "ooo-1");
    expect(row?.status).toBe("ENDED");
    expect(row?.direction).toBe("IN");
    expect(row?.durationSec).toBe(90);
  });

  it("a hangup with no ringing seen records a missed call to return", async () => {
    await POST(
      buildRequest({ ...ring("lost-1"), kind: "hangup", timestamp: "2026-04-22T10:01:00Z" }) as never,
    );
    const row = findCallBySip("clinic-a", "lost-1");
    expect(row?.status).toBe("MISSED");
    expect(row?.direction).toBe("MISSED");
    expect(row?.patientId).toBe("p1");
    // A ringing retried after it changes nothing and announces nothing.
    published.events.length = 0;
    await POST(buildRequest(ring("lost-1")) as never);
    expect(findCallBySip("clinic-a", "lost-1")?.status).toBe("MISSED");
    expect(published.events).toEqual([]);
  });

  it("a «missed» for a call somebody answered is another leg: the call stays live", async () => {
    await POST(buildRequest(ring("leg-1")) as never);
    await POST(
      buildRequest({ ...ring("leg-1"), kind: "answered", timestamp: "2026-04-22T10:00:05Z" }) as never,
    );
    await POST(
      buildRequest({ ...ring("leg-1"), kind: "missed", timestamp: "2026-04-22T10:00:06Z" }) as never,
    );
    const row = findCallBySip("clinic-a", "leg-1");
    expect(row?.status).toBe("ANSWERED");
    expect(row?.endedAt).toBeNull();
  });

  it("provider meta cannot overwrite our clinicId on the event bus", async () => {
    await POST(buildRequest(ring("meta-1", { meta: { clinicId: "clinic-b", trunk: "t1" } })) as never);
    const ringing = published.bus.find((b) => b.channel === "telephony.ringing");
    const meta = ringing?.payload.meta as Record<string, unknown>;
    expect(meta.clinicId).toBe("clinic-a");
    expect(meta.trunk).toBe("t1");
  });
});
