/**
 * Small HTTP helpers shared across /api/crm route handlers.
 *
 * Response envelope conventions:
 *   ok(data, status?)   → `Response.json(data, { status })`
 *   err(message, status, extra?) → `{ error: message, ...extra }`
 *
 * `parseQuery` parses a Zod schema against URL searchParams (supports
 * repeated keys → string[]).
 */
import type { ZodSchema } from "zod";

export function ok(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function err(
  message: string,
  status = 400,
  extra?: Record<string, unknown>
): Response {
  return Response.json({ error: message, ...extra }, { status });
}

export function notFound(): Response {
  return err("NotFound", 404);
}

export function forbidden(): Response {
  return err("Forbidden", 403);
}

export function conflict(
  reason: string,
  extra?: Record<string, unknown>
): Response {
  return err("conflict", 409, { reason, ...extra });
}

/**
 * Collapse URLSearchParams to a plain object; repeated keys become arrays.
 */
export function searchParamsToObject(
  params: URLSearchParams
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of params.keys()) {
    const all = params.getAll(key);
    out[key] = all.length > 1 ? all : (all[0] ?? "");
  }
  return out;
}

export function parseQuery<T>(
  request: Request,
  schema: ZodSchema<T>
):
  | { ok: true; value: T }
  | { ok: false; response: Response } {
  const params = new URL(request.url).searchParams;
  const raw = searchParamsToObject(params);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: err("ValidationError", 400, { issues: parsed.error.issues }),
    };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Compute a shallow diff between `before` and `after` — returns only keys
 * whose values differ. Used for audit-log `meta` so we don't store full
 * snapshots on every update.
 */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>
): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    const bv = before[key];
    const av = after[key];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[key] = bv as T[keyof T];
      a[key] = av as T[keyof T];
    }
  }
  return { before: b, after: a };
}
