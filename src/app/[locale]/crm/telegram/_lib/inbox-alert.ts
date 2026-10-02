/**
 * Which live inbox event alerts the operator (audit TG-36).
 *
 * The webhook publishes `tg.message.new` for every patient message and,
 * while the bot does not answer (auto-reply off or the operator's mode),
 * `tg.takeover.incoming` for the same message. Both toasted, so each
 * message popped up twice, the second time as a nameless «Пациент» with no
 * text. Only `tg.message.new` carries the name and the preview: it is the
 * one alert. Every tg.* event still refreshes the list.
 */
export function isMessageAlert<E extends { type: string }>(
  event: E,
): event is Extract<E, { type: "tg.message.new" }> {
  return event.type === "tg.message.new";
}
