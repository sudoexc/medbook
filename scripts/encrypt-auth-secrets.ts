/**
 * Backfill — encrypt authentication-critical secrets at rest.
 *
 * Walks `User.totpSecret` / `User.pendingTotpSecret` and `Clinic.tgBotToken`
 * and re-writes plaintext values as `v1:iv:tag:ct` AES-256-GCM ciphertext
 * under the APP_SECRET/AUTH_SECRET-derived key (`src/server/crypto/secrets.ts`)
 * — the same cipher the app now applies on every write through
 * `src/server/crypto/secret-fields.ts`.
 *
 * Idempotent: already-encrypted values are recognised by the `v<n>:` envelope
 * (`isEncryptedSecret`) and skipped — re-running never double-encrypts.
 * The app reads BOTH forms, so this backfill can run any time after deploy
 * with zero downtime; until it runs, legacy plaintext keeps working.
 *
 * Run (production — inside the worker container; it ships the script + tsx
 * and gets the app's own env via `env_file`, so APP_SECRET/AUTH_SECRET and
 * DATABASE_URL are already the right ones):
 *   docker compose exec worker npx tsx scripts/encrypt-auth-secrets.ts --dry-run
 *   docker compose exec worker npx tsx scripts/encrypt-auth-secrets.ts
 *
 * Run (local/dev, the local .env named explicitly):
 *   npx tsx scripts/encrypt-auth-secrets.ts --env-file=.env --dry-run
 *
 * IMPORTANT: the key derives from APP_SECRET (fallback AUTH_SECRET). Running
 * with a secret that differs from the app's would lock every user out of 2FA
 * and break the whole patient surface. Audit G2-11: the script used to load
 * the local `.env` on its own (so a laptop run against a production
 * DATABASE_URL encrypted under the laptop's secret) and checked only that
 * SOME secret was set. Now a `.env` is read only when named with
 * `--env-file=`, and before the first write the existing ciphertext has to
 * decrypt with this secret (scripts/_cipher-key-guard.ts).
 *
 * `--dry-run`       prints what would change without writing.
 * `--table=user`    limits to User rows; `--table=clinic` to Clinic rows.
 * `--env-file=PATH` loads that env file first (never implicitly).
 * `--first-run`     only on a non-local database with no ciphertext yet.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  decrypt,
  describeAppSecret,
  encrypt,
  isEncryptedSecret,
} from "../src/server/crypto/secrets";
import {
  decideKeyCheck,
  looksLikeCiphertext,
  type CipherSample,
} from "./_cipher-key-guard";

const BATCH = 200;

type TableKey = "user" | "clinic";

interface Stats {
  scanned: number;
  alreadyEncrypted: number;
  encrypted: number;
  skippedNull: number;
  errors: number;
}

function newStats(): Stats {
  return {
    scanned: 0,
    alreadyEncrypted: 0,
    encrypted: 0,
    skippedNull: 0,
    errors: 0,
  };
}

/**
 * Per-cell decision: encrypt plaintext, pass through null/empty and
 * already-encrypted values. Pure — exported for the unit test
 * (`tests/unit/secret-fields.test.ts`), mirroring how
 * `encrypt-existing-pii.ts` exposes `reencryptValue`.
 */
function reencryptSecretValue(
  value: string | null,
  stats: Stats,
): { write: boolean; next: string | null } {
  if (value === null || value === undefined) {
    stats.skippedNull++;
    return { write: false, next: null };
  }
  if (value === "") {
    // Nothing secret about absence — leave the empty marker alone.
    stats.skippedNull++;
    return { write: false, next: "" };
  }
  if (isEncryptedSecret(value)) {
    stats.alreadyEncrypted++;
    return { write: false, next: value };
  }
  stats.encrypted++;
  return { write: true, next: encrypt(value) };
}

async function backfillUsers(
  prisma: PrismaClient,
  dryRun: boolean,
): Promise<Stats> {
  const stats = newStats();
  let cursor: string | undefined = undefined;
  for (;;) {
    const rows: {
      id: string;
      totpSecret: string | null;
      pendingTotpSecret: string | null;
    }[] = await prisma.user.findMany({
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: { id: true, totpSecret: true, pendingTotpSecret: true },
    });
    if (rows.length === 0) break;
    stats.scanned += rows.length;

    const updates: {
      id: string;
      totpSecret?: string | null;
      pendingTotpSecret?: string | null;
    }[] = [];
    for (const r of rows) {
      const totp = reencryptSecretValue(r.totpSecret, stats);
      const pending = reencryptSecretValue(r.pendingTotpSecret, stats);
      if (totp.write || pending.write) {
        const data: {
          id: string;
          totpSecret?: string | null;
          pendingTotpSecret?: string | null;
        } = { id: r.id };
        if (totp.write) data.totpSecret = totp.next;
        if (pending.write) data.pendingTotpSecret = pending.next;
        updates.push(data);
      }
    }

    if (updates.length > 0 && !dryRun) {
      try {
        // One transaction per batch so a crash can't leave a half-written
        // batch that a re-run would then treat inconsistently.
        // `updateMany` (not `update`) on purpose: `update` RETURNINGs the full
        // row, which fails on a DB whose migrations lag the generated client
        // (P2022 on any newer column). A backfill must only write its own
        // columns, never read the rest of the row.
        await prisma.$transaction(
          updates.map((u) => {
            const { id, ...rest } = u;
            return prisma.user.updateMany({
              where: { id },
              data: rest as never,
            });
          }),
        );
      } catch (e) {
        stats.errors += updates.length;
        console.error("[backfill:user] batch failed", e);
      }
    }

    cursor = rows[rows.length - 1]!.id;
    process.stdout.write(
      `[user] scanned=${stats.scanned} encrypted=${stats.encrypted} already=${stats.alreadyEncrypted} skipped=${stats.skippedNull}\r`,
    );
  }
  process.stdout.write("\n");
  return stats;
}

async function backfillClinics(
  prisma: PrismaClient,
  dryRun: boolean,
): Promise<Stats> {
  const stats = newStats();
  let cursor: string | undefined = undefined;
  for (;;) {
    const rows: { id: string; slug: string; tgBotToken: string | null }[] =
      await prisma.clinic.findMany({
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
        select: { id: true, slug: true, tgBotToken: true },
      });
    if (rows.length === 0) break;
    stats.scanned += rows.length;

    const updates: { id: string; slug: string; tgBotToken: string | null }[] = [];
    for (const r of rows) {
      const v = reencryptSecretValue(r.tgBotToken, stats);
      if (v.write) updates.push({ id: r.id, slug: r.slug, tgBotToken: v.next });
    }

    if (updates.length > 0) {
      // Clinics are few — name them so the operator sees exactly which bots
      // were touched (useful when verifying the Mini App right after).
      for (const u of updates) {
        console.info(
          `[backfill:clinic] ${dryRun ? "would encrypt" : "encrypting"} tgBotToken for '${u.slug}'`,
        );
      }
    }

    if (updates.length > 0 && !dryRun) {
      try {
        // `updateMany` for the same schema-drift resilience as the user walk.
        await prisma.$transaction(
          updates.map((u) =>
            prisma.clinic.updateMany({
              where: { id: u.id },
              data: { tgBotToken: u.tgBotToken } as never,
            }),
          ),
        );
      } catch (e) {
        stats.errors += updates.length;
        console.error("[backfill:clinic] batch failed", e);
      }
    }

    cursor = rows[rows.length - 1]!.id;
  }
  console.info(
    `[clinic] scanned=${stats.scanned} encrypted=${stats.encrypted} already=${stats.alreadyEncrypted} skipped=${stats.skippedNull}`,
  );
  return stats;
}

/** Newest ciphertext per column: what the app wrote most recently. */
const SAMPLE_PER_COLUMN = 20;

export type AuthSecretSampleRows = {
  users: Array<{ id: string; totpSecret: string | null }>;
  clinics: Array<{ slug: string; tgBotToken: string | null }>;
};

export function authSecretSamples(rows: AuthSecretSampleRows): CipherSample[] {
  const out: CipherSample[] = [];
  for (const u of rows.users) {
    if (looksLikeCiphertext(u.totpSecret)) {
      out.push({ where: `User.totpSecret ${u.id}`, value: u.totpSecret });
    }
  }
  for (const c of rows.clinics) {
    if (looksLikeCiphertext(c.tgBotToken)) {
      out.push({ where: `Clinic.tgBotToken ${c.slug}`, value: c.tgBotToken });
    }
  }
  return out;
}

async function readAuthSecretSamples(
  prisma: PrismaClient,
): Promise<AuthSecretSampleRows> {
  const [users, clinics] = await Promise.all([
    prisma.user.findMany({
      where: { totpSecret: { startsWith: "v" } },
      select: { id: true, totpSecret: true },
      orderBy: { id: "desc" },
      take: SAMPLE_PER_COLUMN,
    }),
    prisma.clinic.findMany({
      where: { tgBotToken: { startsWith: "v" } },
      select: { slug: true, tgBotToken: true },
      orderBy: { id: "desc" },
      take: SAMPLE_PER_COLUMN,
    }),
  ]);
  return { users, clinics };
}

/**
 * The pre-write check (audit G2-11). Pure over the sampled rows so the unit
 * test drives it without a database.
 */
export function checkAuthSecretKey(
  rows: AuthSecretSampleRows,
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv.slice(2),
) {
  const secret = describeAppSecret();
  const decision = decideKeyCheck({
    script: "encrypt-auth-secrets",
    isPlaceholderSecret: secret.isPlaceholder,
    samples: authSecretSamples(rows),
    decrypt: (v) => decrypt(v),
    env,
    argv,
  });
  return { secret, decision };
}

function parseArgs(): {
  dryRun: boolean;
  only: TableKey | null;
  envFile: string | null;
} {
  const args = process.argv.slice(2);
  let dryRun = false;
  let only: TableKey | null = null;
  let envFile: string | null = null;
  for (const a of args) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--table=")) {
      const v = a.slice("--table=".length);
      if (v === "user" || v === "clinic") only = v;
      else throw new Error(`Unknown --table value: ${v}`);
    } else if (a.startsWith("--env-file=")) {
      envFile = a.slice("--env-file=".length) || null;
    }
  }
  return { dryRun, only, envFile };
}

async function main(): Promise<void> {
  const { dryRun, only, envFile } = parseArgs();
  if (envFile) {
    // Explicit only: dotenv never overrides variables already exported, so
    // an implicit load silently mixed a local secret with a remote database.
    const dotenv = await import("dotenv");
    const loaded = dotenv.config({ path: envFile });
    if (loaded.error) throw loaded.error;
  }
  const dburl = process.env.DATABASE_URL;
  if (!dburl) throw new Error("DATABASE_URL is required");
  // Fail fast on a missing key: encrypting under an accidental/absent secret
  // would brick 2FA logins and the Mini App the moment the app tries to
  // decrypt with its own key.
  if (!process.env.APP_SECRET && !process.env.AUTH_SECRET) {
    throw new Error(
      "APP_SECRET (or AUTH_SECRET) must be set to the SAME value the app uses. Refusing to backfill.",
    );
  }

  const adapter = new PrismaPg({ connectionString: dburl });
  const prisma = new PrismaClient({ adapter });

  const { secret, decision } = checkAuthSecretKey(
    await readAuthSecretSamples(prisma),
  );
  console.info(
    `[backfill] auth-secrets: dryRun=${dryRun}, only=${only ?? "ALL"}, key=${
      secret.source === "APP_SECRET" ? "APP_SECRET" : "AUTH_SECRET (fallback)"
    } fingerprint=${secret.fingerprint}`,
  );
  if (!decision.ok) {
    console.error(decision.message);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.info(
    decision.firstRun
      ? "[backfill] no existing ciphertext to check the key against (--first-run)."
      : `[backfill] key check OK: ${decision.checked} existing encrypted values decrypt with this key.`,
  );

  const totals: Record<string, Stats> = {};
  if (!only || only === "user") {
    console.info("[backfill] user.totpSecret + user.pendingTotpSecret");
    totals["user"] = await backfillUsers(prisma, dryRun);
  }
  if (!only || only === "clinic") {
    console.info("[backfill] clinic.tgBotToken");
    totals["clinic"] = await backfillClinics(prisma, dryRun);
  }

  console.info("");
  console.info("[backfill] === Summary ===");
  for (const [name, s] of Object.entries(totals)) {
    console.info(
      `  ${name.padEnd(8)} scanned=${s.scanned}  encrypted=${s.encrypted}  alreadyEncrypted=${s.alreadyEncrypted}  skipped(null/empty)=${s.skippedNull}  errors=${s.errors}`,
    );
  }
  if (dryRun) {
    console.info("[backfill] DRY RUN — no rows written.");
  }
  await prisma.$disconnect();
}

// Only auto-run when invoked as a script — the unit test imports
// `reencryptSecretValue` without touching the DB.
if (process.argv[1] && process.argv[1].includes("encrypt-auth-secrets")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { reencryptSecretValue };
