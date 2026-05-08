/**
 * Phase 19 Wave 4 — pure helpers for the VIEW_ONLY write-block.
 *
 * Lifted out of `src/lib/api-handler.ts` so unit tests can import them
 * without dragging the full NextAuth → next/server dependency chain into
 * the Vitest module graph.
 */

const VIEW_ONLY_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const VIEW_ONLY_SKIP_PATH_PREFIXES = ["/api/platform/session/"];

/**
 * True iff the request is exempt from the VIEW_ONLY block: a safe method
 * (GET/HEAD/OPTIONS) OR a path under one of the exit-lifecycle prefixes.
 *
 * Skipped paths matter because VIEW_ONLY would otherwise lock the
 * SUPER_ADMIN inside the impersonation: leaving / downgrading the session
 * itself is a POST.
 */
export function isViewOnlySafe(request: Request): boolean {
  if (VIEW_ONLY_SAFE_METHODS.has(request.method.toUpperCase())) return true;
  try {
    const url = new URL(request.url);
    return VIEW_ONLY_SKIP_PATH_PREFIXES.some((p) =>
      url.pathname.startsWith(p),
    );
  } catch {
    return false;
  }
}

/** The 403 body shape every client + test pins on. */
export function viewOnlyBlockResponse(grantId: string): Response {
  return Response.json({ error: "ViewAsReadOnly", grantId }, { status: 403 });
}
