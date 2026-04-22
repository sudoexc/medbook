/**
 * Channel naming conventions for the realtime bus.
 *
 * Kept in a standalone module so producers + consumers share one source of
 * truth without creating a circular dep between `publish.ts` and
 * `redis-adapter.ts`.
 */

import type { AppEvent } from "./events";

export type { AppEvent };

/** Primary per-clinic fan-out channel. SSE subscribers listen here. */
export function clinicChannel(clinicId: string): string {
  return `clinic:${clinicId}:events`;
}
