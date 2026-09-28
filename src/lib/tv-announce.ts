/**
 * What the waiting-room TVs say out loud when a patient is called, and in
 * which voice (audit UX-06).
 *
 * The call used to be Russian only (`lang = "ru-RU"`, «Талон X, пройдите в
 * кабинет N»): an elderly Uzbek-speaking patient who chose Uzbek at the
 * kiosk did not understand he was the one being called. The `queue.called`
 * signal now carries the patient's language, and the board speaks Uzbek to
 * an Uzbek-speaking patient when the TV box has an Uzbek voice. Without one
 * it falls back to the Russian phrase: a Russian voice reading Uzbek text is
 * worse than a Russian call, and the takeover on screen is bilingual anyway.
 *
 * Pure and client-safe; the pages hand in their translators and the
 * browser's voice list.
 */

export type BoardLang = "ru" | "uz";

/** Translator over the `tvBoard` namespace (next-intl shape). */
export type BoardTranslator = (
  key: string,
  values?: Record<string, string>,
) => string;

/** What the screen knows about the call (see `resolveCallDisplay`). */
export interface AnnouncedCall {
  patientName: string;
  cabinet: string;
  ticketNumber: string;
}

/** The spoken line in one language. */
export function announcementText(t: BoardTranslator, call: AnnouncedCall): string {
  const who = call.patientName
    ? call.patientName
    : call.ticketNumber
      ? t("announce.ticket", { number: call.ticketNumber })
      : t("announce.next");
  return call.cabinet
    ? t("announce.toCabinet", { who, cabinet: call.cabinet })
    : t("announce.come", { who });
}

/** The subset of `SpeechSynthesisVoice` the choice needs. */
export interface VoiceLike {
  lang: string;
  name?: string;
}

export interface AnnouncementPlan {
  text: string;
  /** BCP 47 tag set on the utterance. */
  lang: "ru-RU" | "uz-UZ";
  /** A matching installed voice, when the box has one. */
  voice: VoiceLike | null;
}

function voiceFor(voices: readonly VoiceLike[], prefix: BoardLang): VoiceLike | null {
  return (
    voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(prefix)) ??
    null
  );
}

/**
 * Pick the language and voice for a call. The patient's language wins when
 * the box can speak it; otherwise Russian, as before.
 */
export function planAnnouncement(
  texts: Record<BoardLang, string>,
  patientLang: BoardLang | null | undefined,
  voices: readonly VoiceLike[],
): AnnouncementPlan {
  if (patientLang === "uz") {
    const uz = voiceFor(voices, "uz");
    if (uz) return { text: texts.uz, lang: "uz-UZ", voice: uz };
  }
  return { text: texts.ru, lang: "ru-RU", voice: voiceFor(voices, "ru") };
}
