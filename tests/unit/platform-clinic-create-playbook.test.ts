/**
 * GO-LIVE gap fix — Path A (admin console) clinic creation can now seed an
 * onboarding playbook, same catalog as self-service /signup.
 *
 * Pins the contract:
 *   - `CreateClinicSchema` accepts an optional `playbook` from the catalog
 *     and rejects unknown slugs;
 *   - POST /api/platform/clinics calls `applyPlaybook(clinicId, slug)` after
 *     the create-transaction when a playbook is chosen, and does NOT call it
 *     when omitted;
 *   - a playbook failure does not roll back clinic creation (201 with
 *     `playbookApplied: false`), mirroring the /signup confirm behaviour;
 *   - the chosen slug is stamped on `Clinic.onboardingPlaybook` and lands in
 *     the `clinic.create` audit meta together with `playbookApplied`.
 *
 * DB-less: prisma, auth and the applier are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  clinicCreateData: null as Record<string, unknown> | null,
  auditRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "sa_1", role: "SUPER_ADMIN" },
  })),
}));

vi.mock("@/server/auth/password", () => ({
  generateTempPassword: vi.fn(() => "temp-pass-123"),
  hashPassword: vi.fn(async () => "$2a$10$hash"),
}));

vi.mock("@/server/onboarding/apply-playbook", () => ({
  applyPlaybook: vi.fn(async () => ({
    servicesCreated: 5,
    templatesCreated: 4,
    scheduleSet: true,
  })),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    clinic: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.clinicCreateData = data;
        return { id: "clinic_new", slug: data.slug, ...data };
      }),
    },
    user: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "user_new",
        ...data,
      })),
    },
  };
  return {
    prisma: {
      clinic: {
        // Slug-uniqueness pre-check → "free".
        findUnique: vi.fn(async () => null),
      },
      user: {
        // Owner-email pre-check → "free".
        findUnique: vi.fn(async () => null),
      },
      $transaction: vi.fn(
        async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      ),
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.auditRows.push(data);
          return data;
        }),
      },
    },
  };
});

import { POST } from "@/app/api/platform/clinics/route";
import { CreateClinicSchema } from "@/server/schemas/platform";
import { applyPlaybook } from "@/server/onboarding/apply-playbook";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("https://neurofax.uz/api/platform/clinics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE_BODY = {
  slug: "real-clinic",
  nameRu: "Реальная клиника",
  nameUz: "Real klinika",
  ownerName: "Иван Петров",
  ownerEmail: "owner@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  state.clinicCreateData = null;
  state.auditRows.length = 0;
});

describe("CreateClinicSchema.playbook", () => {
  it("accepts every catalog slug and tolerates omission/null", () => {
    for (const slug of [
      "general",
      "dental",
      "neurology",
      "pediatric",
      "cosmetology",
    ]) {
      const parsed = CreateClinicSchema.safeParse({
        ...BASE_BODY,
        playbook: slug,
      });
      expect(parsed.success).toBe(true);
    }
    expect(CreateClinicSchema.safeParse(BASE_BODY).success).toBe(true);
    expect(
      CreateClinicSchema.safeParse({ ...BASE_BODY, playbook: null }).success,
    ).toBe(true);
  });

  it("rejects unknown playbook slugs", () => {
    const parsed = CreateClinicSchema.safeParse({
      ...BASE_BODY,
      playbook: "veterinary",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("POST /api/platform/clinics with playbook", () => {
  it("applies the playbook after creation and reports playbookApplied", async () => {
    const res = await POST(
      makeRequest({ ...BASE_BODY, playbook: "neurology" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      playbookApplied: boolean;
      ownerTempPassword: string;
    };
    expect(body.playbookApplied).toBe(true);
    expect(body.ownerTempPassword).toBe("temp-pass-123");

    expect(applyPlaybook).toHaveBeenCalledTimes(1);
    expect(applyPlaybook).toHaveBeenCalledWith("clinic_new", "neurology");

    // The choice is persisted on the Clinic row…
    expect(state.clinicCreateData?.onboardingPlaybook).toBe("neurology");
    // …and recorded in the clinic.create audit meta.
    const audit = state.auditRows.find((r) => r.action === "clinic.create");
    expect(audit).toBeTruthy();
    expect(audit?.meta).toMatchObject({
      playbook: "neurology",
      playbookApplied: true,
    });
  });

  it("skips the applier entirely when no playbook is chosen", async () => {
    const res = await POST(makeRequest(BASE_BODY));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { playbookApplied: boolean };
    expect(body.playbookApplied).toBe(false);
    expect(applyPlaybook).not.toHaveBeenCalled();
    expect(state.clinicCreateData?.onboardingPlaybook).toBeNull();
  });

  it("still creates the clinic when the playbook applier throws", async () => {
    vi.mocked(applyPlaybook).mockRejectedValueOnce(new Error("boom"));
    const res = await POST(
      makeRequest({ ...BASE_BODY, playbook: "dental" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { playbookApplied: boolean };
    expect(body.playbookApplied).toBe(false);
    const audit = state.auditRows.find((r) => r.action === "clinic.create");
    expect(audit?.meta).toMatchObject({
      playbook: "dental",
      playbookApplied: false,
    });
  });
});
