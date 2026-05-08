/**
 * Server-component audit helper.
 *
 * `audit(request, ...)` lives in `src/lib/audit.ts` and was originally built
 * for API route handlers, where the framework hands us a real `Request`.
 * Server pages don't get one — they read headers via `headers()` instead.
 *
 * This helper bridges that gap: it builds a minimal `Request` from the
 * incoming page request's headers so `audit()` can extract `x-forwarded-for`,
 * `x-real-ip`, and `user-agent` exactly as it does for API routes.
 *
 * Pages call this once, after `auth()` / role gates have passed, with the
 * usual `{ action, entityType, entityId, meta }` payload. Failures are still
 * swallowed by the underlying `audit()` (we never want a flaky audit row to
 * break a dashboard render).
 */
import { headers } from "next/headers";

import { audit } from "./audit";

export interface ServerAuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: unknown;
}

/**
 * Build a synthetic Request from the current page's headers and emit one
 * AuditLog row. The URL is a placeholder — the audit table doesn't store it,
 * we only need a constructable Request shell so the helper's IP / UA
 * extraction works.
 */
export async function auditServerPage(input: ServerAuditInput): Promise<void> {
  const h = await headers();
  // Mirror the headers we actually inspect inside audit().
  const init: HeadersInit = {};
  const xff = h.get("x-forwarded-for");
  const xri = h.get("x-real-ip");
  const ua = h.get("user-agent");
  if (xff) (init as Record<string, string>)["x-forwarded-for"] = xff;
  if (xri) (init as Record<string, string>)["x-real-ip"] = xri;
  if (ua) (init as Record<string, string>)["user-agent"] = ua;
  const synthetic = new Request("https://internal/server-page-audit", {
    headers: init,
  });
  await audit(synthetic, input);
}
