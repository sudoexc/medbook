import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

/**
 * Audit SEC-04 — seed scripts shipped known passwords (super@ / «super»,
 * 1@1.uz / «1», the real NeuroFax doctors / «doctor») and reset them on every
 * re-run. Now: no literal passwords, create-only password writes, random
 * passwords printed once, and a production guard.
 */
import {
  assertAccountSeedAllowed,
  assertE2eSeedAllowed,
  e2eSeedRefusal,
  seedPasswordFor,
  upsertSeedUser,
} from "../../scripts/_seed-passwords";

const ROOT = path.resolve(__dirname, "../..");
const ENV = ["SEED_PASSWORD", "NODE_ENV", "SEED_ALLOW_PROD_ACCOUNTS", "DEV_ADMIN_PASSWORD"] as const;
let saved: Record<string, string | undefined> = {};

function setEnv(k: string, v: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (v === undefined) delete env[k];
  else env[k] = v;
}

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) setEnv(k, undefined);
});
afterEach(() => {
  for (const k of ENV) setEnv(k, saved[k]);
  vi.restoreAllMocks();
});

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "migrations" || name === "node_modules") continue;
      out.push(...tsFilesUnder(full));
    } else if (/\.(ts|mts|js|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("no known passwords in prisma/ and scripts/", () => {
  it("no bcrypt.hash() of a string literal anywhere", () => {
    const offenders: string[] = [];
    for (const f of [...tsFilesUnder(path.join(ROOT, "prisma")), ...tsFilesUnder(path.join(ROOT, "scripts"))]) {
      if (/bcrypt\.hash(Sync)?\(\s*["'`]/.test(readFileSync(f, "utf8"))) offenders.push(path.relative(ROOT, f));
    }
    expect(offenders).toEqual([]);
  });

  it("the account-creating seeds go through the guard", () => {
    for (const f of ["prisma/seed.ts", "scripts/seed-neurofax-real.ts", "scripts/upsert-dev-admin.ts", "scripts/guard-e2e.ts"]) {
      expect(readFileSync(path.join(ROOT, f), "utf8")).toContain("assertAccountSeedAllowed(");
    }
  });
});

describe("seedPasswordFor", () => {
  it("without an env password: random, not a known one, and must be changed", async () => {
    const pw = await seedPasswordFor("a@x.uz");
    expect(pw.mustChangePassword).toBe(true);
    for (const known of ["super", "admin", "doctor", "recept", "1"]) {
      expect(await bcrypt.compare(known, pw.hash)).toBe(false);
    }
  });

  it("a developer's SEED_PASSWORD is used and kept on a dev database", async () => {
    setEnv("SEED_PASSWORD", "my-local-pass");
    const pw = await seedPasswordFor("a@x.uz");
    expect(await bcrypt.compare("my-local-pass", pw.hash)).toBe(true);
    expect(pw.mustChangePassword).toBe(false);
  });

  it("on production even an env password must be changed at first sign-in", async () => {
    setEnv("SEED_PASSWORD", "chosen");
    setEnv("NODE_ENV", "production");
    expect((await seedPasswordFor("a@x.uz")).mustChangePassword).toBe(true);
  });
});

describe("upsertSeedUser", () => {
  it("re-running a seed never touches an existing account's password", async () => {
    const create = vi.fn(async () => "created");
    const update = vi.fn(async () => "updated");
    const r = await upsertSeedUser({ email: "doc@x.uz", exists: async () => true, create, update });
    expect(r).toBe("updated");
    expect(create).not.toHaveBeenCalled();
  });

  it("a new account is created with a fresh password", async () => {
    const create = vi.fn(async (pw: { hash: string }) => pw.hash);
    const r = await upsertSeedUser({
      email: "new@x.uz",
      exists: async () => false,
      create,
      update: async () => "updated",
    });
    expect(r).toMatch(/^\$2[aby]\$/);
  });
});

describe("assertAccountSeedAllowed", () => {
  it("refuses on production without SEED_ALLOW_PROD_ACCOUNTS=1", () => {
    setEnv("NODE_ENV", "production");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => assertAccountSeedAllowed("seed")).toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    setEnv("SEED_ALLOW_PROD_ACCOUNTS", "1");
    expect(() => assertAccountSeedAllowed("seed")).not.toThrow();
  });
});

describe("tests/e2e/seed.ts refuses anything but a test database (SEC-04 review)", () => {
  // It writes known passwords for super@ / admin@ / recept@ / operator@ and the
  // doctors of clinic "neurofax", the production slug and logins, and resets
  // them on every run. `npm run e2e:seed` reads DATABASE_URL from .env.
  const url = (db: string) => `postgresql://medbook:secret@localhost:5432/${db}?schema=public`;

  it("a production .env (database medbook / neurofax) is refused", () => {
    expect(e2eSeedRefusal({ DATABASE_URL: url("medbook") })).toMatch(/medbook/);
    expect(e2eSeedRefusal({ DATABASE_URL: url("neurofax") })).toMatch(/neurofax/);
    expect(e2eSeedRefusal({})).not.toBeNull();
  });

  it("the local and CI e2e databases are allowed", () => {
    expect(e2eSeedRefusal({ DATABASE_URL: url("neurofax_e2e") })).toBeNull();
    expect(e2eSeedRefusal({ DATABASE_URL: url("medbook_e2e") })).toBeNull();
    expect(e2eSeedRefusal({ DATABASE_URL: url("medbook-test") })).toBeNull();
    // "test" must be its own word, not part of another one.
    expect(e2eSeedRefusal({ DATABASE_URL: url("contest") })).not.toBeNull();
  });

  it("another test database needs its name confirmed explicitly, for that database only", () => {
    expect(e2eSeedRefusal({ DATABASE_URL: url("scratch"), E2E_SEED_ALLOW_DB: "scratch" })).toBeNull();
    expect(e2eSeedRefusal({ DATABASE_URL: url("medbook"), E2E_SEED_ALLOW_DB: "scratch" })).not.toBeNull();
    expect(e2eSeedRefusal({ DATABASE_URL: url("medbook"), E2E_SEED_ALLOW_DB: "1" })).not.toBeNull();
  });

  it("never with NODE_ENV=production, whatever else is set", () => {
    expect(
      e2eSeedRefusal({
        NODE_ENV: "production",
        DATABASE_URL: url("neurofax_e2e"),
        E2E_SEED_ALLOW_DB: "neurofax_e2e",
        SEED_ALLOW_PROD_ACCOUNTS: "1",
      }),
    ).not.toBeNull();
  });

  it("exits before writing anything", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => assertE2eSeedAllowed("tests/e2e/seed.ts", { DATABASE_URL: url("medbook") })).toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(() => assertE2eSeedAllowed("tests/e2e/seed.ts", { DATABASE_URL: url("neurofax_e2e") })).not.toThrow();
  });

  it("the e2e seed checks first, before its first query", () => {
    const src = readFileSync(path.join(ROOT, "tests/e2e/seed.ts"), "utf8");
    const main = src.slice(src.indexOf("async function main()"));
    const guard = main.indexOf('assertE2eSeedAllowed("tests/e2e/seed.ts")');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(main.indexOf("prisma."));
    expect(guard).toBeLessThan(main.indexOf("bcrypt.hash("));
  });
});
