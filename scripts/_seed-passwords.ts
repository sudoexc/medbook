/**
 * Passwords for seeded staff accounts, without shipping any (audit SEC-04).
 *
 * The seeds used to hash literals: SUPER_ADMIN super@neurofax.uz / «super»,
 * ADMIN 1@1.uz / «1», admin / recept, and the seven real NeuroFax doctors /
 * «doctor». Anyone who had seen the repository could sign in to production,
 * and re-running a seed silently reset those accounts back to the known
 * password on every run.
 *
 * Rules for every script that creates staff logins:
 *   - the password comes from an env var the operator sets for that run, or
 *     is generated at random and printed ONCE at the end of the run;
 *   - it is written only when the account is CREATED; an upsert's update
 *     branch never touches passwordHash, so re-running a seed cannot reset a
 *     password someone has since changed;
 *   - a new account must pick its own password at first sign-in
 *     (mustChangePassword), except a dev database where the developer chose
 *     the password through the env var;
 *   - with NODE_ENV=production the script refuses to run unless
 *     SEED_ALLOW_PROD_ACCOUNTS=1 is set explicitly.
 *
 * `scripts/audit-known-passwords.ts` checks a live database for accounts
 * still carrying one of the old known passwords.
 */
import bcrypt from "bcryptjs";

import { generateTempPassword } from "../src/server/auth/password";

export function assertAccountSeedAllowed(scriptName: string): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.SEED_ALLOW_PROD_ACCOUNTS === "1") return;
  console.error(
    [
      "",
      `⛔ ${scriptName} создаёт учётные записи персонала, а NODE_ENV=production.`,
      "",
      "   Если это действительно нужно на проде, запусти с явным флагом:",
      `     SEED_ALLOW_PROD_ACCOUNTS=1 npx tsx … ${scriptName}`,
      "   Пароли новых учёток будут случайными и выведутся один раз в конце.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

type Issued = { email: string; password: string; source: "env" | "generated" };

const issued: Issued[] = [];

export type SeedPassword = {
  hash: string;
  /** Put on the created account: must the user pick a new password? */
  mustChangePassword: boolean;
};

/**
 * Password for a seeded account that is about to be CREATED. `envVar` names
 * the variable to read it from (falls back to SEED_PASSWORD, then to a random
 * one). Call it only on the create path, and print the list with
 * `printIssuedPasswords()` once the run is done.
 */
export async function seedPasswordFor(
  email: string,
  envVar?: string,
): Promise<SeedPassword> {
  const fromEnv =
    (envVar ? process.env[envVar] : undefined) || process.env.SEED_PASSWORD;
  const password = fromEnv || generateTempPassword(14);
  const source = fromEnv ? "env" : "generated";
  issued.push({ email, password, source });
  return {
    hash: await bcrypt.hash(password, 10),
    // A developer who set the password for a local database may keep it; on
    // production, and for anything generated, the owner picks their own.
    mustChangePassword:
      source === "generated" || process.env.NODE_ENV === "production",
  };
}

/** Print the passwords handed out in this run, once. */
export function printIssuedPasswords(): void {
  if (issued.length === 0) return;
  console.log("\nНовые учётные записи (пароль показан один раз):");
  for (const i of issued) {
    const shown = i.source === "env" ? "(из переменной окружения)" : i.password;
    console.log(`  ${i.email.padEnd(32)} ${shown}`);
  }
  console.log("");
}

/**
 * Upsert helper for the common "create with a password, but never reset it
 * on update" shape. Returns the row the way `prisma.user.upsert` would.
 */
export async function upsertSeedUser<T>(args: {
  email: string;
  envVar?: string;
  exists: () => Promise<boolean>;
  create: (pw: SeedPassword) => Promise<T>;
  update: () => Promise<T>;
}): Promise<T> {
  if (await args.exists()) return args.update();
  return args.create(await seedPasswordFor(args.email, args.envVar));
}
