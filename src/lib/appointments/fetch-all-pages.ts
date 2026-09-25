/**
 * Read every page of `GET /api/crm/appointments` for a filter.
 *
 * The endpoint caps `limit` at `APPOINTMENTS_LIST_MAX_LIMIT` and answers 400
 * above it. The doctors page and the doctor profile tabs asked for 500 in one
 * request, got a 400 on every load, and rendered the failure as zeros:
 * revenue 0, load 0 %, an empty heat grid, no patients (audit DR-01). Callers
 * that need the whole range page through `nextCursor` here instead.
 */

/** Must equal `QueryAppointmentSchema.limit.max` (server/schemas/appointment). */
export const APPOINTMENTS_LIST_MAX_LIMIT = 200;

/**
 * Safety valve: 25 pages × 200 rows. Past it the rows are returned with
 * `truncated: true` rather than hammering the API for an unbounded range.
 */
export const APPOINTMENTS_MAX_PAGES = 25;

export type AllPagesResult<T> = { rows: T[]; truncated: boolean };

export async function fetchAllAppointmentPages<T>(
  params: Record<string, string>,
  opts: {
    signal?: AbortSignal;
    maxPages?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<AllPagesResult<T>> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxPages = opts.maxPages ?? APPOINTMENTS_MAX_PAGES;
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const qs = new URLSearchParams({
      ...params,
      limit: String(APPOINTMENTS_LIST_MAX_LIMIT),
    });
    if (cursor) qs.set("cursor", cursor);
    const res = await doFetch(`/api/crm/appointments?${qs.toString()}`, {
      credentials: "include",
      signal: opts.signal,
    });
    // Any failed page fails the whole read: a half-loaded range would show
    // numbers that look real and are not.
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { rows: T[]; nextCursor: string | null };
    rows.push(...body.rows);
    if (!body.nextCursor) return { rows, truncated: false };
    cursor = body.nextCursor;
  }
  return { rows, truncated: true };
}
