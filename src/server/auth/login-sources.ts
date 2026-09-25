/**
 * Where each staff account has signed in from (audit SEC-02, review of the
 * login throttle).
 *
 * The throttle's account-wide and per-address failure buckets are meant for
 * strangers: an address spraying many accounts, or many addresses guessing
 * one. Without an exception they also lock out the real owner: an outsider
 * fails 50 logins in a doctor's name and she cannot sign in at the clinic PC
 * with the right password, and one guest on the clinic's Wi-Fi fills the
 * per-address bucket for every colleague behind the same NAT address. A pair
 * (account, address) seen in a successful sign-in within the last 30 days is
 * therefore exempt from those two buckets. It still gets only 5 wrong
 * passwords per 15 minutes of its own.
 *
 * Kept in the database, not in memory: a restart would otherwise forget every
 * trusted address while an attacker simply fills the buckets again.
 * Only a COMPLETE sign-in (password and, when enrolled, the second factor)
 * makes an address known; a right password at the 2FA pre-flight does not.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ipBucket } from "@/lib/client-ip";

export const KNOWN_SOURCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Under attack every refused request would otherwise ask the database; one
// answer per (email, address) a minute is plenty.
const MEMO_TTL_MS = 60_000;
const MEMO_MAX = 5_000;
const MEMO_KEY = Symbol.for("medbook.login-sources.memo");

type Memo = Map<string, { known: boolean; at: number }>;

function memo(): Memo {
  const g = globalThis as unknown as Record<symbol, Memo | undefined>;
  let m = g[MEMO_KEY];
  if (!m) {
    m = new Map();
    g[MEMO_KEY] = m;
  }
  return m;
}

function remember(key: string, known: boolean, at: number): void {
  const m = memo();
  m.delete(key);
  m.set(key, { known, at });
  if (m.size > MEMO_MAX) {
    for (const k of m.keys()) {
      if (m.size <= MEMO_MAX) break;
      m.delete(k);
    }
  }
}

/** A real address to remember, or null ("unknown" when nginx sent none). */
function sourceOf(ip: string): string | null {
  const s = ipBucket(ip);
  // Without a peer address every request would share one "unknown" source;
  // trusting it would exempt everybody.
  return s && s !== "unknown" ? s : null;
}

/**
 * Has `email` completed a sign-in from `ip` (its /64 for IPv6) within the
 * last 30 days? False when unsure.
 */
export async function isKnownLoginSource(
  email: string | null | undefined,
  ip: string,
  now = Date.now(),
): Promise<boolean> {
  const source = sourceOf(ip);
  if (!email || !source) return false;
  const key = `${email}|${source}`;
  const hit = memo().get(key);
  if (hit && now - hit.at < MEMO_TTL_MS) return hit.known;
  try {
    const row = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.staffLoginSource.findFirst({
        where: {
          source,
          lastSuccessAt: { gte: new Date(now - KNOWN_SOURCE_TTL_MS) },
          user: { email, active: true },
        },
        select: { userId: true },
      }),
    );
    const known = row !== null;
    remember(key, known, now);
    return known;
  } catch (err) {
    console.error("[login-sources] lookup failed", err);
    return false;
  }
}

/**
 * Note a completed sign-in. Never throws: failing to remember an address must
 * not fail the sign-in.
 */
export async function rememberLoginSource(args: {
  userId: string;
  email: string;
  ip: string;
  now?: Date;
}): Promise<void> {
  const source = sourceOf(args.ip);
  if (!source) return;
  const now = args.now ?? new Date();
  remember(`${args.email}|${source}`, true, now.getTime());
  try {
    await runWithTenant({ kind: "SYSTEM" }, async () => {
      await prisma.staffLoginSource.upsert({
        where: { userId_source: { userId: args.userId, source } },
        create: { userId: args.userId, source, firstSeenAt: now, lastSuccessAt: now },
        update: { lastSuccessAt: now },
      });
      // Addresses not used for a month (a changed home IP, a phone on mobile
      // data) no longer count; drop them so the table stays small.
      await prisma.staffLoginSource.deleteMany({
        where: {
          userId: args.userId,
          lastSuccessAt: { lt: new Date(now.getTime() - KNOWN_SOURCE_TTL_MS) },
        },
      });
    });
  } catch (err) {
    console.error("[login-sources] could not remember sign-in source", err);
  }
}

/** Test hook. */
export function __resetLoginSourceMemoForTests(): void {
  memo().clear();
}
