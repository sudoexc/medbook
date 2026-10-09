/**
 * Owner account P0, the scripts (owner request 09.10.2026,
 * docs/design/OWNER-ACCOUNT.md §1, §5, §7 P0):
 *
 *   - scripts/bootstrap-super-admin.ts takes --email and --name, never
 *     renames an existing account and never converts a clinic account;
 *   - scripts/owner-break-glass.ts resets a SUPER_ADMIN only;
 *   - both are DRY RUN by default (APPLY=1 writes) and ship to the worker.
 *
 * The decisions are pure (scripts/_owner-account-plan.ts) and tested here
 * without a database; the wiring is checked on the sources.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  DEFAULT_SUPER_ADMIN_EMAIL,
  DEFAULT_SUPER_ADMIN_NAME,
  PLATFORM_BREAK_GLASS_ACTION,
  ownerPasswordProblem,
  parseOwnerArgs,
  planBootstrap,
  planBreakGlass,
  type BreakGlassTarget,
  type ExistingAccount,
} from "../../scripts/_owner-account-plan";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const OWNER: ExistingAccount = {
  id: "sa1",
  email: "owner@example.uz",
  name: "Джавохир",
  role: "SUPER_ADMIN",
  clinicId: null,
  active: true,
  mustChangePassword: false,
};
const CLINIC_ADMIN: ExistingAccount = {
  id: "a1",
  email: "admin@clinic.uz",
  name: "Админ клиники",
  role: "ADMIN",
  clinicId: "c1",
  active: true,
  mustChangePassword: false,
};

describe("parseOwnerArgs", () => {
  it("takes --email and --name in both spellings, the email lower-cased", () => {
    expect(parseOwnerArgs(["--email", "Owner@Example.UZ", "--name", "Имя Фамилия"])).toEqual({
      ok: true,
      args: { email: "owner@example.uz", name: "Имя Фамилия" },
    });
    expect(parseOwnerArgs(["--email=owner@example.uz", "--name=Имя"])).toEqual({
      ok: true,
      args: { email: "owner@example.uz", name: "Имя" },
    });
    expect(parseOwnerArgs([])).toEqual({ ok: true, args: {} });
  });

  it("refuses anything it would have to guess", () => {
    for (const argv of [
      ["owner@example.uz"],
      ["--mail", "owner@example.uz"],
      ["--email"],
      ["--email", "--name", "x"],
      ["--email", "not-an-email"],
      ["--email", "a@b.uz", "--email", "c@d.uz"],
      ["--name", "  "],
    ]) {
      expect(parseOwnerArgs(argv).ok, argv.join(" ")).toBe(false);
    }
  });

  it("the owner's password floor is 12", () => {
    expect(ownerPasswordProblem("short-pass1")).not.toBeNull();
    expect(ownerPasswordProblem("long-enough-1")).toBeNull();
  });
});

describe("planBootstrap", () => {
  it("no account: creates a SUPER_ADMIN, «Super Admin» unless --name says otherwise", () => {
    expect(
      planBootstrap({ email: "owner@example.uz", name: null, hasPassword: true, matches: [] }),
    ).toEqual({ kind: "create", email: "owner@example.uz", name: DEFAULT_SUPER_ADMIN_NAME });
    expect(
      planBootstrap({ email: "owner@example.uz", name: "Имя", hasPassword: true, matches: [] }),
    ).toMatchObject({ kind: "create", name: "Имя" });
  });

  it("no account and no SUPER_PASS: refused", () => {
    expect(
      planBootstrap({ email: "owner@example.uz", name: null, hasPassword: false, matches: [] }).kind,
    ).toBe("refuse");
  });

  it("an existing SUPER_ADMIN keeps his name, whatever --name says", () => {
    const plan = planBootstrap({
      email: OWNER.email,
      name: "Другое имя",
      hasPassword: true,
      matches: [{ ...OWNER, mustChangePassword: true, active: false }],
    });
    expect(plan).toEqual({
      kind: "update",
      id: "sa1",
      email: OWNER.email,
      changes: ["password", "reactivate", "clear_must_change_password"],
      keptName: "Джавохир",
      nameIgnored: true,
    });
  });

  it("an existing active SUPER_ADMIN without SUPER_PASS: nothing to change", () => {
    expect(
      planBootstrap({ email: OWNER.email, name: null, hasPassword: false, matches: [OWNER] }),
    ).toMatchObject({ kind: "nothing", keptName: "Джавохир", nameIgnored: false });
  });

  it("a clinic account's email is refused, never converted", () => {
    const plan = planBootstrap({
      email: CLINIC_ADMIN.email,
      name: null,
      hasPassword: true,
      matches: [CLINIC_ADMIN],
    });
    expect(plan.kind).toBe("refuse");
    expect(plan.kind === "refuse" && plan.reason).toMatch(/clinic account \(ADMIN\)/);
  });

  it("two rows for one email, or a SUPER_ADMIN bound to a clinic: refused", () => {
    expect(
      planBootstrap({ email: OWNER.email, name: null, hasPassword: true, matches: [OWNER, OWNER] }).kind,
    ).toBe("refuse");
    expect(
      planBootstrap({
        email: OWNER.email,
        name: null,
        hasPassword: true,
        matches: [{ ...OWNER, clinicId: "c1" }],
      }).kind,
    ).toBe("refuse");
  });
});

describe("planBreakGlass", () => {
  const owner: BreakGlassTarget = { ...OWNER, totpEnabled: true };

  it("generated password: must be changed at the first sign-in", () => {
    expect(planBreakGlass({ email: owner.email, matches: [owner], newPassword: undefined })).toEqual({
      kind: "reset",
      target: owner,
      passwordSource: "generated",
      mustChangePassword: true,
      reactivate: false,
    });
  });

  it("NEW_PASSWORD: kept as his own; a deactivated account comes back on", () => {
    expect(
      planBreakGlass({
        email: owner.email,
        matches: [{ ...owner, active: false }],
        newPassword: "correct-horse-battery",
      }),
    ).toMatchObject({ kind: "reset", passwordSource: "env", mustChangePassword: false, reactivate: true });
  });

  it("refuses a short NEW_PASSWORD, a clinic account, no account and two accounts", () => {
    expect(planBreakGlass({ email: owner.email, matches: [owner], newPassword: "short" }).kind).toBe(
      "refuse",
    );
    expect(
      planBreakGlass({
        email: CLINIC_ADMIN.email,
        matches: [{ ...CLINIC_ADMIN, totpEnabled: false }],
        newPassword: undefined,
      }).kind,
    ).toBe("refuse");
    expect(planBreakGlass({ email: owner.email, matches: [], newPassword: undefined }).kind).toBe(
      "refuse",
    );
    expect(
      planBreakGlass({ email: owner.email, matches: [owner, owner], newPassword: undefined }).kind,
    ).toBe("refuse");
  });

  it("its audit action is AUDIT_ACTION.PLATFORM_BREAK_GLASS", () => {
    expect(PLATFORM_BREAK_GLASS_ACTION).toBe(AUDIT_ACTION.PLATFORM_BREAK_GLASS);
  });
});

describe("the scripts' wiring", () => {
  const allow = read("scripts/worker-allowlist.txt")
    .split("\n")
    .map((l) => l.trim());

  it("ship to the worker with their plan module", () => {
    for (const f of ["bootstrap-super-admin.ts", "owner-break-glass.ts", "_owner-account-plan.ts"]) {
      expect(allow, f).toContain(f);
    }
  });

  for (const f of ["scripts/bootstrap-super-admin.ts", "scripts/owner-break-glass.ts"]) {
    it(`${f} is a dry run by default and asks the plan module first`, () => {
      const src = read(f);
      expect(src).toMatch(/const APPLY = process\.env\.APPLY === "1"/);
      expect(src).toContain("DRY RUN. Set APPLY=1 to write.");
      // Every write sits after the dry run's return.
      const dryRun = src.indexOf("if (!APPLY)");
      expect(dryRun).toBeGreaterThan(0);
      for (const write of ["$transaction(", ".update(", ".create(", ".deleteMany(", ".updateMany("]) {
        const at = src.indexOf(write);
        if (at >= 0) expect(at, `${f} ${write}`).toBeGreaterThan(dryRun);
      }
      expect(src).toMatch(/from "\.\/_owner-account-plan"/);
      expect(src).not.toMatch(/_destructive-guard|assertSeedAllowed/);
    });
  }

  it("bootstrap defaults to super@neurofax.uz and never writes a name on update", () => {
    expect(DEFAULT_SUPER_ADMIN_EMAIL).toBe("super@neurofax.uz");
    const src = read("scripts/bootstrap-super-admin.ts");
    expect(src).toContain("parsed.args.email ?? DEFAULT_SUPER_ADMIN_EMAIL");
    const update = src.slice(src.indexOf("const data: {"), src.indexOf("tx.user.update("));
    expect(update).not.toMatch(/\bname\b\s*[:?]/);
    expect(src).not.toMatch(/upsert\(/);
  });

  it("break-glass wipes 2FA, ends sessions and live visits, and journals it", () => {
    const src = read("scripts/owner-break-glass.ts");
    expect(src).toContain("...TOTP_RESET_DATA");
    expect(src).toMatch(/userSession\.deleteMany\(\{ where: \{ userId: target\.id \} \}\)/);
    expect(src).toMatch(/endedReason: "revoked"/);
    expect(src).toContain('via: "break_glass"');
    expect(src).toContain("action: PLATFORM_BREAK_GLASS_ACTION");
    // No default account: the email is required.
    expect(src).toContain('usage("--email is required")');
  });

  it("the runbook says how to run it on the server", () => {
    const runbook = read("docs/operations/RUNBOOK.md");
    expect(runbook).toContain("### 3.8 Потерял доступ владельца");
    expect(runbook).toContain(
      "docker compose run --rm -T -v /opt/neurofax/scripts:/app/scripts worker \\\n  npx tsx scripts/owner-break-glass.ts --email",
    );
  });
});
