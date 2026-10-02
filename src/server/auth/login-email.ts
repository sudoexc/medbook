/**
 * Staff email addresses, whatever case they are typed in (audit ST-15).
 *
 * `User.email` is unique as stored, and the login looked it up exactly: a
 * doctor whose tablet capitalised «Nodira@neurofax.uz» got «Неверный email
 * или пароль» and went to the admin for a password reset. Lower-casing the
 * typed address alone would lock out the accounts already stored in mixed
 * case (the CRM form lower-cases, the API and the other ways in did not), so
 * the lookup ignores case instead, and new or edited addresses are stored in
 * lower case.
 *
 * Postgres compares `mode: "insensitive"` with ILIKE, where `_` and `%` are
 * wildcards, so every any-case search is filtered again here.
 */

/** Prisma `where.email` for an any-case search (re-filter the rows). */
export function anyCaseEmail(email: string) {
  return { equals: email.trim(), mode: "insensitive" as const };
}

/** Rows that really are `email`, ignoring case and surrounding spaces. */
export function sameEmailIgnoringCase<T extends { email: string }>(
  email: string,
  rows: readonly T[],
): T[] {
  const want = email.trim().toLowerCase();
  return rows.filter((r) => r.email.toLowerCase() === want);
}

/**
 * Pure: the account a typed address signs in to. The exact spelling wins;
 * otherwise exactly one account must match ignoring case. Two accounts that
 * differ only in case (the unique index allows it) are ambiguous, and an
 * ambiguous address signs in nobody rather than a guess.
 */
export function pickLoginAccount<T extends { email: string }>(
  typed: string,
  rows: readonly T[],
): T | null {
  const want = typed.trim();
  const exact = rows.find((r) => r.email === want);
  if (exact) return exact;
  const same = sameEmailIgnoringCase(want, rows);
  return same.length === 1 ? same[0]! : null;
}

/** How many any-case rows to fetch: enough to see an ambiguity. */
export const LOGIN_LOOKUP_LIMIT = 10;

/**
 * Find the account for a typed login address. The unique index answers the
 * usual case (typed as stored) in one probe; only a miss pays for the
 * any-case search.
 */
export async function findLoginAccount<T extends { email: string }>(
  typed: string,
  lookup: {
    exact: (email: string) => Promise<T | null>;
    anyCase: (email: string) => Promise<T[]>;
  },
): Promise<T | null> {
  const email = typed.trim();
  if (!email) return null;
  const exact = await lookup.exact(email);
  if (exact) return exact;
  return pickLoginAccount(email, await lookup.anyCase(email));
}
