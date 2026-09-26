/**
 * Which day the reception doctors panel shows (audit AP-12).
 *
 * The rest of the page always shows today; only the panel can look at another
 * day, and a pick holds for the clinic day it was made on. «Завтра» looked at
 * last night must not greet the desk in the morning as the day on screen.
 *
 * Client-safe: pure.
 */

/** A day picked on the panel, and the clinic day it was picked on. */
export interface PanelDayPick {
  day: string;
  madeOn: string;
}

export function panelDayFor(
  pick: PanelDayPick | null,
  clinicToday: string,
): string {
  return pick && pick.madeOn === clinicToday ? pick.day : clinicToday;
}

/** The pick to store for a day chosen in the picker; today means follow. */
export function pickPanelDay(
  day: string,
  clinicToday: string,
): PanelDayPick | null {
  return day === clinicToday ? null : { day, madeOn: clinicToday };
}
