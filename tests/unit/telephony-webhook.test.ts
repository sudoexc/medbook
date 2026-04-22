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
  fromNumber: string;
  toNumber: string;
  sipCallId: string | null;
  patientId: string | null;
  operatorId: string | null;
  createdAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  recordingUrl: string | null;
  tags: string[];
};

type PatientRow = {
  id: string;
  clinicId: string;
  phoneNormalized: string;
  phone: string;
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
  nextId: 1,
};

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
        const w = args.where as {
          clinicId: string;
          OR?: Array<{ phoneNormalized?: { in: string[] }; phone?: { in: string[] } }>;
        };
        const variants = new Set<string>();
        for (const clause of w.OR ?? []) {
          const pn = clause.phoneNormalized?.in ?? [];
          const ph = clause.phone?.in ?? [];
          for (const v of pn) variants.add(v);
          for (const v of ph) variants.add(v);
        }
        return (
          state.patients.find(
            (p) =>
              p.clinicId === w.clinicId &&
              (variants.has(p.phoneNormalized) || variants.has(p.phone)),
          ) ?? null
        );
      }),
    },
    call: {
      upsert: vi.fn(
        async (args: {
          where: { clinicId_sipCallId: { clinicId: string; sipCallId: string } };
          create: Partial<CallRow> & { clinicId: string; sipCallId: string };
          update: Partial<CallRow>;
        }) => {
          const { clinicId, sipCallId } = args.where.clinicId_sipCallId;
          const existing = findCallBySip(clinicId, sipCallId);
          if (existing) {
            Object.assign(existing, args.update);
            return existing;
          }
          const row: CallRow = {
            id: String(state.nextId++),
            clinicId,
            direction: args.create.direction ?? "IN",
            fromNumber: args.create.fromNumber ?? "",
            toNumber: args.create.toNumber ?? "",
            sipCallId,
            patientId: args.create.patientId ?? null,
            operatorId: args.create.operatorId ?? null,
            createdAt: args.create.createdAt ?? new Date(),
            endedAt: null,
            durationSec: null,
            recordingUrl: args.create.recordingUrl ?? null,
            tags: [],
          };
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
        const row = state.calls.find((c) => c.id === args.where.id);
        if (!row) throw new Error("Not found");
        Object.assign(row, args.data);
        return row;
      }),
      create: vi.fn(
        async (args: {
          data: Partial<CallRow> & { clinicId: string; direction: CallRow["direction"] };
        }) => {
          const row: CallRow = {
            id: String(state.nextId++),
            clinicId: args.data.clinicId,
            direction: args.data.direction,
            fromNumber: args.data.fromNumber ?? "",
            toNumber: args.data.toNumber ?? "",
            sipCallId: args.data.sipCallId ?? null,
            patientId: args.data.patientId ?? null,
            operatorId: args.data.operatorId ?? null,
            createdAt: args.data.createdAt ?? new Date(),
            endedAt: args.data.endedAt ?? null,
            durationSec: args.data.durationSec ?? null,
            recordingUrl: args.data.recordingUrl ?? null,
            tags: args.data.tags ?? [],
          };
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
  state.nextId = 1;

  state.clinics.push({ id: "clinic-a", slug: "neurofax" });
  state.patients.push({
    id: "p1",
    clinicId: "clinic-a",
    phoneNormalized: "+998901234567",
    phone: "+998901234567",
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

  it("hangup computes durationSec from createdAt to event timestamp", async () => {
    await POST(
      buildRequest({
        kind: "ringing",
        callId: "log-dur-1",
        from: "+998901234567",
        to: "+998712001020",
        timestamp: new Date("2026-04-22T10:00:00Z"),
      }) as never,
    );
    // Force the createdAt so duration math is deterministic.
    const row = findCallBySip("clinic-a", "log-dur-1");
    if (row) row.createdAt = new Date("2026-04-22T10:00:00Z");

    await POST(
      buildRequest({
        kind: "hangup",
        callId: "log-dur-1",
        from: "+998901234567",
        to: "+998712001020",
        timestamp: new Date("2026-04-22T10:02:00Z"), // +120s
      }) as never,
    );
    const updated = findCallBySip("clinic-a", "log-dur-1");
    expect(updated?.endedAt).toBeInstanceOf(Date);
    expect(updated?.durationSec).toBe(120);
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
