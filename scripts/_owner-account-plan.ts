/**
 * Decisions behind the platform owner's account scripts (owner request
 * 09.10.2026, docs/design/OWNER-ACCOUNT.md §1 and §5):
 *
 *   - scripts/bootstrap-super-admin.ts creates the owner's SUPER_ADMIN
 *     account (or refreshes an existing one);
 *   - scripts/owner-break-glass.ts gets a locked out owner back in.
 *
 * Pure, no database: tests/unit/owner-account-scripts.test.ts checks every
 * rule here without one. The scripts read the rows, ask this module what to
 * do, print the plan and write only with APPLY=1.
 *
 * The hard rule for both: they touch a SUPER_ADMIN account and nothing else.
 * An email that belongs to a clinic account (an ADMIN, a doctor) is refused,
 * never converted: the clinic would lose its admin, and a SUPER_ADMIN with a
 * clinic breaks the platform's invariant (`User.clinicId` is null for him).
 */

/** The account the bootstrap script made before it took `--email`. */
export const DEFAULT_SUPER_ADMIN_EMAIL = "super@neurofax.uz";
/** The name a new account gets when `--name` is not given. */
export const DEFAULT_SUPER_ADMIN_NAME = "Super Admin";
/**
 * The owner's password opens every clinic: a longer floor than the staff
 * minimum of 8 (/api/crm/me/password). A generated one is 20 characters.
 */
export const MIN_OWNER_PASSWORD = 12;
export const GENERATED_PASSWORD_LENGTH = 20;
/**
 * AUDIT_ACTION.PLATFORM_BREAK_GLASS spelled out. The runbook runs the script
 * from the host's scripts folder mounted into the worker, possibly an image
 * built before the action existed, where the constant would be undefined
 * and the audit row would fail the whole transaction. A unit test keeps the
 * two equal.
 */
export const PLATFORM_BREAK_GLASS_ACTION = "PLATFORM_BREAK_GLASS";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type OwnerArgs = { email?: string; name?: string };

/**
 * `--email <x>` / `--email=<x>` and `--name <x>` / `--name=<x>`. Anything
 * else is an error rather than a guess: these scripts change the key to
 * every clinic. The email is lower-cased, as staff emails are stored
 * (audit ST-15).
 */
export function parseOwnerArgs(
  argv: readonly string[],
): { ok: true; args: OwnerArgs } | { ok: false; error: string } {
  const args: OwnerArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    const m = /^--(email|name)(?:=(.*))?$/.exec(raw);
    if (!m) return { ok: false, error: `unknown argument «${raw}»` };
    const key = m[1] as "email" | "name";
    let value = m[2];
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, error: `--${key} needs a value` };
      }
      i++;
    }
    value = value.trim();
    if (!value) return { ok: false, error: `--${key} is empty` };
    if (args[key] !== undefined) return { ok: false, error: `--${key} given twice` };
    if (key === "email") {
      value = value.toLowerCase();
      if (!EMAIL_RE.test(value)) return { ok: false, error: `«${value}» is not an email` };
    }
    args[key] = value;
  }
  return { ok: true, args };
}

/** Null when the password is acceptable for the owner, else why not. */
export function ownerPasswordProblem(password: string): string | null {
  if (password.length < MIN_OWNER_PASSWORD) {
    return `the password must be at least ${MIN_OWNER_PASSWORD} characters`;
  }
  return null;
}

export type ExistingAccount = {
  id: string;
  email: string;
  name: string;
  role: string;
  clinicId: string | null;
  active: boolean;
  mustChangePassword: boolean;
};

function notOwnAccount(match: ExistingAccount): string | null {
  if (match.role !== "SUPER_ADMIN") {
    return (
      `${match.email} belongs to a clinic account (${match.role}). ` +
      "This script never converts a clinic account: use another email."
    );
  }
  if (match.clinicId) {
    return `${match.email} is a SUPER_ADMIN bound to a clinic, fix that by hand first`;
  }
  return null;
}

export type BootstrapPlan =
  | { kind: "refuse"; reason: string }
  | { kind: "create"; email: string; name: string }
  | {
      kind: "update";
      id: string;
      email: string;
      /** What the write changes, for the printout and the audit row. */
      changes: Array<"password" | "reactivate" | "clear_must_change_password">;
      /** The stored name, kept as it is. */
      keptName: string;
      /** `--name` asked for another name, which the script does not apply. */
      nameIgnored: boolean;
    }
  | { kind: "nothing"; id: string; email: string; keptName: string; nameIgnored: boolean };

/**
 * What `bootstrap-super-admin.ts` does for `email`.
 *
 *   - no account: create a SUPER_ADMIN (clinicId null) named `--name`, or
 *     «Super Admin»; SUPER_PASS required;
 *   - a SUPER_ADMIN account: set the password when SUPER_PASS is given (and
 *     drop a pending «change password»), switch it back on when it was
 *     deactivated. The name is never overwritten (design §1);
 *   - anything else (a clinic account, two rows for one email): refuse.
 */
export function planBootstrap(input: {
  email: string;
  name: string | null;
  hasPassword: boolean;
  matches: readonly ExistingAccount[];
}): BootstrapPlan {
  if (input.matches.length > 1) {
    return {
      kind: "refuse",
      reason: `more than one account matches ${input.email}, fix the emails first`,
    };
  }
  const match = input.matches[0];
  if (!match) {
    if (!input.hasPassword) {
      return { kind: "refuse", reason: "SUPER_PASS is required to create the account" };
    }
    return {
      kind: "create",
      email: input.email,
      name: input.name ?? DEFAULT_SUPER_ADMIN_NAME,
    };
  }
  const refusal = notOwnAccount(match);
  if (refusal) return { kind: "refuse", reason: refusal };

  const nameIgnored = input.name !== null && input.name !== match.name;
  const changes: Array<"password" | "reactivate" | "clear_must_change_password"> = [];
  if (input.hasPassword) changes.push("password");
  if (!match.active) changes.push("reactivate");
  if (input.hasPassword && match.mustChangePassword) {
    changes.push("clear_must_change_password");
  }
  if (changes.length === 0) {
    return {
      kind: "nothing",
      id: match.id,
      email: match.email,
      keptName: match.name,
      nameIgnored,
    };
  }
  return {
    kind: "update",
    id: match.id,
    email: match.email,
    changes,
    keptName: match.name,
    nameIgnored,
  };
}

export type BreakGlassTarget = ExistingAccount & { totpEnabled: boolean };

export type BreakGlassPlan =
  | { kind: "refuse"; reason: string }
  | {
      kind: "reset";
      target: BreakGlassTarget;
      passwordSource: "env" | "generated";
      /**
       * A generated password was printed to a terminal, so it must be
       * replaced at the first sign-in. One the owner typed into NEW_PASSWORD
       * is already his own.
       */
      mustChangePassword: boolean;
      reactivate: boolean;
    };

/**
 * What `owner-break-glass.ts` does for `--email`: only a SUPER_ADMIN
 * account, never a clinic one (that one gets its password from the clinic's
 * admin or the /admin console); NEW_PASSWORD, when given, must pass the
 * owner's floor.
 */
export function planBreakGlass(input: {
  email: string;
  matches: readonly BreakGlassTarget[];
  newPassword: string | undefined;
}): BreakGlassPlan {
  if (input.matches.length === 0) {
    return { kind: "refuse", reason: `no account with the email ${input.email}` };
  }
  if (input.matches.length > 1) {
    return {
      kind: "refuse",
      reason: `more than one account matches ${input.email}, fix the emails first`,
    };
  }
  const target = input.matches[0]!;
  if (target.role !== "SUPER_ADMIN") {
    return {
      kind: "refuse",
      reason:
        `${target.email} is a clinic account (${target.role}). Break-glass is for ` +
        "the platform owner only: a clinic account gets a new password from " +
        "its clinic admin or the /admin console.",
    };
  }
  if (target.clinicId) {
    return {
      kind: "refuse",
      reason: `${target.email} is a SUPER_ADMIN bound to a clinic, fix that by hand first`,
    };
  }
  const fromEnv = input.newPassword !== undefined && input.newPassword !== "";
  if (fromEnv) {
    const problem = ownerPasswordProblem(input.newPassword!);
    if (problem) return { kind: "refuse", reason: `NEW_PASSWORD: ${problem}` };
  }
  return {
    kind: "reset",
    target,
    passwordSource: fromEnv ? "env" : "generated",
    mustChangePassword: !fromEnv,
    reactivate: !target.active,
  };
}
