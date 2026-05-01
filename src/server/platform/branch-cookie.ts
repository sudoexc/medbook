/**
 * Active-branch cookie (Phase 9c).
 *
 * Stores the user's currently selected branch within their own clinic. Unlike
 * the SUPER_ADMIN clinic-override cookie, this cookie is NOT signed: every
 * tenant can only switch among branches that already belong to their own
 * `clinicId`, and the API endpoint that writes the cookie validates that the
 * selected branchId is owned by the active clinic. A forged value can at
 * worst pin the user to a non-existent branch — in which case Prisma reads
 * return empty results, and writes fail with a foreign-key violation.
 *
 * Empty value (cookie missing or `""`) means "All branches" — the tenant
 * context omits `branchId`, and queries stay clinic-wide (legacy behaviour).
 */
export const ACTIVE_BRANCH_COOKIE_NAME = "active_branch_id";

/**
 * Parse a `Cookie:` request header and return the raw branchId value, or
 * `null` if the cookie is missing or empty.
 */
export function readActiveBranchFromCookieHeader(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;
  const needle = `${ACTIVE_BRANCH_COOKIE_NAME}=`;
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (trimmed.startsWith(needle)) {
      const value = trimmed.slice(needle.length);
      if (!value) return null;
      // Cookies are URL-encoded; decode just in case downstream sets it
      // through `document.cookie`. Server-side we always set raw cuid.
      try {
        return decodeURIComponent(value) || null;
      } catch {
        return value || null;
      }
    }
  }
  return null;
}

/**
 * Build the Set-Cookie header value for setting (or clearing) the active
 * branch cookie. `null` clears it.
 */
export function buildActiveBranchSetCookie(
  branchId: string | null,
  opts: { secure?: boolean } = {},
): string {
  const secure = opts.secure ?? process.env.NODE_ENV === "production";
  const parts = [
    `${ACTIVE_BRANCH_COOKIE_NAME}=${branchId ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    branchId ? `Max-Age=${60 * 60 * 24 * 30}` : "Max-Age=0", // 30d on set, expire on clear
  ];
  return parts.filter(Boolean).join("; ");
}
