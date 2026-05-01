/**
 * Phase 9c — admin subscription handler tests.
 *
 * Covers:
 *   - GET    /api/admin/clinics/[id]/subscription      (auto-create + return shape)
 *   - PATCH  /api/admin/clinics/[id]/subscription      (planId / status / null clear)
 *   - POST   /api/admin/clinics/[id]/subscription/extend-trial
 *   - POST   /api/admin/clinics/[id]/subscription/cancel
 *   - GET    /api/admin/plans
 *
 * DB-less. We mock `@/lib/prisma` with an in-memory store and stub `@/lib/auth`
 * so each test can flip the role between SUPER_ADMIN, ADMIN, or anonymous.
 *
 * The test "PATCH plan changes effective flags returned by getFeatureFlags"
 * uses the real `parsePlanFeatures` helper (no mock) on the post-PATCH state
 * to assert that switching plans flips the feature shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { parsePlanFeatures } from "@/lib/feature-flags";

type Plan = {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  priceMonth: string;
  currency: "UZS" | "USD";
  features: unknown;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type Subscription = {
  id: string;
  clinicId: string;
  planId: string;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type Clinic = { id: string; slug: string; nameRu: string; nameUz: string };

interface State {
  clinics: Clinic[];
  plans: Plan[];
  subs: Subscription[];
  audits: Array<{ action: string; entityId: string | null; meta: unknown }>;
}

const state: State = {
  clinics: [],
  plans: [],
  subs: [],
  audits: [],
};

const sessionRef: { current: { user: { id: string; role: string } } | null } = {
  current: { user: { id: "u_super", role: "SUPER_ADMIN" } },
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => sessionRef.current),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return state.clinics.find((c) => c.id === where.id) ?? null;
      }),
    },
    plan: {
      findUnique: vi.fn(
        async ({ where }: { where: { id?: string; slug?: string } }) => {
          if (where.id) return state.plans.find((p) => p.id === where.id) ?? null;
          if (where.slug)
            return state.plans.find((p) => p.slug === where.slug) ?? null;
          return null;
        },
      ),
      findFirst: vi.fn(async () => {
        return state.plans.find((p) => p.isActive) ?? null;
      }),
      findMany: vi.fn(async () => {
        return [...state.plans]
          .filter((p) => p.isActive)
          .sort(
            (a, b) =>
              a.sortOrder - b.sortOrder || a.nameRu.localeCompare(b.nameRu),
          );
      }),
    },
    subscription: {
      findUnique: vi.fn(async (args: { where: { clinicId: string }; include?: { plan?: boolean } }) => {
        const sub = state.subs.find((s) => s.clinicId === args.where.clinicId);
        if (!sub) return null;
        if (args.include?.plan) {
          const plan = state.plans.find((p) => p.id === sub.planId)!;
          return { ...sub, plan };
        }
        return sub;
      }),
      create: vi.fn(
        async (args: {
          data: Partial<Subscription>;
          include?: { plan?: boolean };
        }) => {
          const now = new Date();
          const sub: Subscription = {
            id: `sub_${state.subs.length + 1}`,
            clinicId: args.data.clinicId!,
            planId: args.data.planId!,
            status: args.data.status ?? "TRIAL",
            trialEndsAt: args.data.trialEndsAt ?? null,
            currentPeriodEndsAt: args.data.currentPeriodEndsAt ?? null,
            cancelledAt: args.data.cancelledAt ?? null,
            createdAt: now,
            updatedAt: now,
          };
          state.subs.push(sub);
          if (args.include?.plan) {
            const plan = state.plans.find((p) => p.id === sub.planId)!;
            return { ...sub, plan };
          }
          return sub;
        },
      ),
      update: vi.fn(
        async (args: {
          where: { clinicId: string };
          data: Partial<Subscription>;
          include?: { plan?: boolean };
        }) => {
          const sub = state.subs.find(
            (s) => s.clinicId === args.where.clinicId,
          );
          if (!sub) throw new Error("not found");
          Object.assign(sub, args.data, { updatedAt: new Date() });
          if (args.include?.plan) {
            const plan = state.plans.find((p) => p.id === sub.planId)!;
            return { ...sub, plan };
          }
          return sub;
        },
      ),
    },
    auditLog: {
      create: vi.fn(async (args: { data: { action: string; entityId: string | null; meta: unknown } }) => {
        state.audits.push({
          action: args.data.action,
          entityId: args.data.entityId ?? null,
          meta: args.data.meta,
        });
        return { id: `a_${state.audits.length}` };
      }),
    },
  },
}));

const PRO_FEATURES = {
  hasTelegramInbox: true,
  hasCallCenter: true,
  hasAnalyticsPro: false,
  maxBranches: 3,
  maxUsers: 20,
};
const ENTERPRISE_FEATURES = {
  hasTelegramInbox: true,
  hasCallCenter: true,
  hasAnalyticsPro: true,
  maxBranches: 50,
  maxUsers: 500,
};

function seedDefaults() {
  state.clinics = [
    { id: "c1", slug: "neurofax", nameRu: "Нейрофакс", nameUz: "Neyrofaks" },
    { id: "c2", slug: "demo", nameRu: "Демо", nameUz: "Demo" },
  ];
  const now = new Date();
  state.plans = [
    {
      id: "plan_basic",
      slug: "basic",
      nameRu: "Basic",
      nameUz: "Basic",
      priceMonth: "0",
      currency: "UZS",
      features: {
        hasTelegramInbox: false,
        hasCallCenter: false,
        hasAnalyticsPro: false,
        maxBranches: 1,
        maxUsers: 5,
      },
      isActive: true,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "plan_pro",
      slug: "pro",
      nameRu: "Pro",
      nameUz: "Pro",
      priceMonth: "1500000",
      currency: "UZS",
      features: PRO_FEATURES,
      isActive: true,
      sortOrder: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "plan_enterprise",
      slug: "enterprise",
      nameRu: "Enterprise",
      nameUz: "Enterprise",
      priceMonth: "5000000",
      currency: "UZS",
      features: ENTERPRISE_FEATURES,
      isActive: true,
      sortOrder: 3,
      createdAt: now,
      updatedAt: now,
    },
  ];
  state.subs = [
    {
      id: "sub_c1",
      clinicId: "c1",
      planId: "plan_pro",
      status: "TRIAL",
      trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      currentPeriodEndsAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
  state.audits = [];
}

beforeEach(() => {
  seedDefaults();
  sessionRef.current = { user: { id: "u_super", role: "SUPER_ADMIN" } };
});

async function loadGet() {
  vi.resetModules();
  const mod = await import("@/app/api/admin/clinics/[id]/subscription/route");
  return mod.GET;
}
async function loadPatch() {
  vi.resetModules();
  const mod = await import("@/app/api/admin/clinics/[id]/subscription/route");
  return mod.PATCH;
}
async function loadExtend() {
  vi.resetModules();
  const mod = await import(
    "@/app/api/admin/clinics/[id]/subscription/extend-trial/route"
  );
  return mod.POST;
}
async function loadCancel() {
  vi.resetModules();
  const mod = await import(
    "@/app/api/admin/clinics/[id]/subscription/cancel/route"
  );
  return mod.POST;
}
async function loadPlans() {
  vi.resetModules();
  const mod = await import("@/app/api/admin/plans/route");
  return mod.GET;
}

function req(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}

describe("GET /api/admin/clinics/[id]/subscription", () => {
  it("returns existing subscription with plan", async () => {
    const GET = await loadGet();
    const res = await GET(req("https://x/api/admin/clinics/c1/subscription"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      subscription: { plan: { slug: string }; status: string };
    };
    expect(body.subscription.plan.slug).toBe("pro");
    expect(body.subscription.status).toBe("TRIAL");
  });

  it("auto-creates a TRIAL on `pro` if no subscription exists", async () => {
    state.subs = []; // wipe
    const GET = await loadGet();
    const res = await GET(req("https://x/api/admin/clinics/c2/subscription"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      subscription: { status: string; plan: { slug: string }; trialEndsAt: string | null };
    };
    expect(body.subscription.status).toBe("TRIAL");
    expect(body.subscription.plan.slug).toBe("pro");
    expect(body.subscription.trialEndsAt).not.toBeNull();
  });

  it("returns 404 for unknown clinic", async () => {
    const GET = await loadGet();
    const res = await GET(req("https://x/api/admin/clinics/c_missing/subscription"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-SUPER_ADMIN role", async () => {
    sessionRef.current = { user: { id: "u_admin", role: "ADMIN" } };
    const GET = await loadGet();
    const res = await GET(req("https://x/api/admin/clinics/c1/subscription"));
    expect(res.status).toBe(403);
  });

  it("returns 401 for anonymous", async () => {
    sessionRef.current = null;
    const GET = await loadGet();
    const res = await GET(req("https://x/api/admin/clinics/c1/subscription"));
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/admin/clinics/[id]/subscription", () => {
  it("changing planId flips the effective feature flags", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(
      req("https://x/api/admin/clinics/c1/subscription", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: "plan_enterprise" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      subscription: { planId: string; plan: { features: unknown } };
    };
    expect(body.subscription.planId).toBe("plan_enterprise");
    expect(parsePlanFeatures(body.subscription.plan.features)).toEqual(
      ENTERPRISE_FEATURES,
    );

    // And the underlying store reflects the change.
    expect(state.subs[0].planId).toBe("plan_enterprise");

    // Audit log captured the field that changed.
    expect(state.audits.some((a) => a.action === "subscription.update")).toBe(true);
  });

  it("changing status writes through", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(
      req("https://x/api/admin/clinics/c1/subscription", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(state.subs[0].status).toBe("ACTIVE");
  });

  it("rejects an inactive / unknown planId", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(
      req("https://x/api/admin/clinics/c1/subscription", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: "plan_does_not_exist" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { reason?: string };
    expect(body.reason).toBe("invalid_plan");
  });

  it("returns 403 for non-SUPER_ADMIN", async () => {
    sessionRef.current = {
      user: { id: "u_recept", role: "RECEPTIONIST" },
    };
    const PATCH = await loadPatch();
    const res = await PATCH(
      req("https://x/api/admin/clinics/c1/subscription", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/clinics/[id]/subscription/extend-trial", () => {
  it("adds exactly 30 days to existing future trialEndsAt", async () => {
    const before = state.subs[0].trialEndsAt!;
    const POST = await loadExtend();
    const res = await POST(
      req("https://x/api/admin/clinics/c1/subscription/extend-trial", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const after = state.subs[0].trialEndsAt!;
    const deltaMs = after.getTime() - before.getTime();
    expect(deltaMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("if trialEndsAt is null, sets it to NOW + 30d", async () => {
    state.subs[0].trialEndsAt = null;
    const t0 = Date.now();
    const POST = await loadExtend();
    const res = await POST(
      req("https://x/api/admin/clinics/c1/subscription/extend-trial", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const after = state.subs[0].trialEndsAt!;
    const expected = t0 + 30 * 24 * 60 * 60 * 1000;
    // Allow 5s of clock drift between t0 and the handler's `new Date()`.
    expect(Math.abs(after.getTime() - expected)).toBeLessThan(5_000);
  });

  it("returns 403 for non-SUPER_ADMIN", async () => {
    sessionRef.current = { user: { id: "u_admin", role: "ADMIN" } };
    const POST = await loadExtend();
    const res = await POST(
      req("https://x/api/admin/clinics/c1/subscription/extend-trial", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/clinics/[id]/subscription/cancel", () => {
  it("sets status=CANCELLED and cancelledAt", async () => {
    const POST = await loadCancel();
    const res = await POST(
      req("https://x/api/admin/clinics/c1/subscription/cancel", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    expect(state.subs[0].status).toBe("CANCELLED");
    expect(state.subs[0].cancelledAt).not.toBeNull();
  });

  it("returns 403 for non-SUPER_ADMIN", async () => {
    sessionRef.current = { user: { id: "u_doc", role: "DOCTOR" } };
    const POST = await loadCancel();
    const res = await POST(
      req("https://x/api/admin/clinics/c1/subscription/cancel", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/plans", () => {
  it("returns active plans ordered by sortOrder", async () => {
    const GET = await loadPlans();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plans: Array<{ slug: string }> };
    expect(body.plans.map((p) => p.slug)).toEqual([
      "basic",
      "pro",
      "enterprise",
    ]);
  });

  it("returns 403 for non-SUPER_ADMIN", async () => {
    sessionRef.current = { user: { id: "u_admin", role: "ADMIN" } };
    const GET = await loadPlans();
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
