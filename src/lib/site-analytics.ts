/**
 * Landing goals reported to Yandex Metrika. A no-op when the counter is not
 * configured (no `window.ym`), so callers never need to check.
 *
 * Goal ids, to be created as «JavaScript-событие» goals in Metrika:
 *   call          — tap on any phone number
 *   route         — «Проложить маршрут» under the map
 *   booking-open  — the booking form was opened
 *   booking-sent  — the booking form was sent successfully
 */
type Ym = (id: number, method: "reachGoal", goal: string) => void;

export function reachGoal(goal: string): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { ym?: Ym; __ymId?: number };
  if (!w.ym || !w.__ymId) return;
  try {
    w.ym(w.__ymId, "reachGoal", goal);
  } catch {
    // Analytics must never break the page.
  }
}
