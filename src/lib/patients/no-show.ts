/**
 * A patient's no-show rate (audit G6-12). One rule for the patient card's
 * hero, its right rail and the Telegram rail (via the stats API), which all
 * divided by every appointment on the card.
 *
 * Only visits that have happened, one way or the other, count: the ones he
 * came to (COMPLETED) and the ones he missed (NO_SHOW). Visits still ahead
 * and cancelled ones say nothing about whether he turns up, and they diluted
 * the rate: 1 missed of 2 past visits, with 2 booked and 4 cancelled, read
 * 13% «Средний» instead of 50% «Высокий».
 */
export type NoShowFigures = {
  /** COMPLETED + NO_SHOW: the denominator. */
  settled: number;
  noShow: number;
  /** Whole percent, 0 when nothing has settled yet. */
  pct: number;
};

export function noShowFigures(counts: {
  completed: number;
  noShow: number;
}): NoShowFigures {
  const settled = counts.completed + counts.noShow;
  return {
    settled,
    noShow: counts.noShow,
    pct: settled > 0 ? Math.round((counts.noShow / settled) * 100) : 0,
  };
}

/** The same figures from a list of appointments (the patient card's). */
export function noShowFiguresOf(
  appointments: ReadonlyArray<{ status: string }>,
): NoShowFigures {
  let completed = 0;
  let noShow = 0;
  for (const a of appointments) {
    if (a.status === "COMPLETED") completed += 1;
    else if (a.status === "NO_SHOW") noShow += 1;
  }
  return noShowFigures({ completed, noShow });
}
