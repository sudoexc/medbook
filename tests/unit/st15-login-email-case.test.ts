/**
 * Audit ST-15: a staff login address in any case.
 *
 *   - the sign-in (and its pre-flight at /api/crm/auth/totp-required) finds
 *     the account whatever case the address is typed in, including accounts
 *     already stored in mixed case;
 *   - two accounts that differ only in case make the address ambiguous, and
 *     an ambiguous address signs in nobody;
 *   - new and edited addresses are stored in lower case, and a case variant
 *     of an existing address counts as taken.
 */
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => h.users.get(where.email) ?? null),
      // ILIKE semantics, wildcards included: `_` matches any one character.
      findMany: vi.fn(async ({ where }: { where: { email: { equals: string } } }) => {
        const escaped = where.email.equals
          .replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")
          .replace(/_/g, ".");
        const pattern = new RegExp("^" + escaped + "$", "i");
        return [...h.users.values()].filter((u) => pattern.test(String(u.email)));
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.audits.push(data);
        return data;
      }),
    },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => Promise.resolve(fn()),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));
vi.mock("@/server/auth/login-sources", () => ({
  isKnownLoginSource: vi.fn(async () => false),
}));
vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "admin1", role: "ADMIN" };
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        handler({
          request,
          body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
          ctx,
        }),
    createApiListHandler: () => async () => new Response(null),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import {
  findLoginAccount,
  pickLoginAccount,
  sameEmailIgnoringCase,
} from "@/server/auth/login-email";
import { CreateUserSchema, UpdateUserSchema } from "@/server/schemas/user";
import { POST as precheck } from "@/app/api/crm/auth/totp-required/route";
import { POST as createUser } from "@/app/api/crm/users/route";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";

const row = (email: string) => ({ id: email, email });

describe("pickLoginAccount", () => {
  it("prefers the exact spelling, else the one account equal ignoring case", () => {
    const rows = [row("Nodira@neurofax.uz"), row("nodira@neurofax.uz")];
    expect(pickLoginAccount("nodira@neurofax.uz", rows)?.id).toBe("nodira@neurofax.uz");
    expect(pickLoginAccount(" NODIRA@neurofax.uz ", [row("Nodira@neurofax.uz")])?.id).toBe(
      "Nodira@neurofax.uz",
    );
  });

  it("signs in nobody when two accounts differ only in case", () => {
    const rows = [row("Nodira@neurofax.uz"), row("nodira@neurofax.uz")];
    expect(pickLoginAccount("NODIRA@NEUROFAX.UZ", rows)).toBeNull();
  });

  it("drops what ILIKE wildcards let through", () => {
    expect(pickLoginAccount("a_b@x.uz", [row("axb@x.uz")])).toBeNull();
    expect(sameEmailIgnoringCase("a_b@x.uz", [row("axb@x.uz"), row("A_B@x.uz")])).toEqual([
      row("A_B@x.uz"),
    ]);
  });
});

describe("findLoginAccount", () => {
  it("asks the unique index first and searches any case only on a miss", async () => {
    const exact = vi.fn(async (e: string) => (e === "d@x.uz" ? row("d@x.uz") : null));
    const anyCase = vi.fn(async () => [row("D@x.uz")]);
    expect(await findLoginAccount("d@x.uz", { exact, anyCase })).toEqual(row("d@x.uz"));
    expect(anyCase).not.toHaveBeenCalled();
    expect(await findLoginAccount("d@X.uz", { exact, anyCase })).toEqual(row("D@x.uz"));
    expect(anyCase).toHaveBeenCalledWith("d@X.uz");
    expect(await findLoginAccount("   ", { exact, anyCase })).toBeNull();
  });
});

describe("staff address schemas", () => {
  it("store the address trimmed and in lower case", () => {
    const created = CreateUserSchema.parse({
      email: " Nodira@NeuroFax.uz ",
      name: "Нодира",
      role: "NURSE",
    });
    expect(created.email).toBe("nodira@neurofax.uz");
    expect(UpdateUserSchema.parse({ email: "A@B.UZ" }).email).toBe("a@b.uz");
  });
});

const post = (email: string, password: string) =>
  precheck(
    new Request("https://neurofax.uz/api/crm/auth/totp-required", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "198.51.100.30" },
      body: JSON.stringify({ email, password }),
    }),
  );

beforeEach(async () => {
  __resetRateLimitsForTests();
  h.audits = [];
  h.users.clear();
  h.users.set("nodira@neurofax.uz", {
    id: "u1",
    email: "nodira@neurofax.uz",
    role: "DOCTOR",
    clinicId: "c1",
    active: true,
    totpEnabledAt: null,
    passwordHash: await bcrypt.hash("right", 4),
  });
  // Stored before the CRM form lower-cased addresses.
  h.users.set("Aziz@NeuroFax.uz", {
    id: "u2",
    email: "Aziz@NeuroFax.uz",
    role: "DOCTOR",
    clinicId: "c1",
    active: true,
    totpEnabledAt: null,
    passwordHash: await bcrypt.hash("right", 4),
  });
});

describe("the login pre-flight ignores case", () => {
  it("a capitalised address finds the lower-case account", async () => {
    const res = await post("Nodira@neurofax.uz", "right");
    expect(res.status).toBe(200);
  });

  it("a lower-case address finds an account stored in mixed case", async () => {
    expect((await post("aziz@neurofax.uz", "right")).status).toBe(200);
  });

  it("a wrong password is still refused", async () => {
    expect((await post("NODIRA@NEUROFAX.UZ", "wrong")).status).toBe(401);
    expect(h.audits[0]).toMatchObject({ meta: { reason: "bad_password", stage: "precheck" } });
  });
});

describe("POST /api/crm/users", () => {
  it("counts a case variant of an existing address as taken", async () => {
    const res = await createUser(
      new Request("https://x/api/crm/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "AZIZ@neurofax.uz", name: "Азиз", role: "RECEPTIONIST" }),
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "email_taken" });
  });
});
