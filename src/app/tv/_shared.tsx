"use client";

/**
 * Shared signage pieces for the two TV surfaces (`/tv` clinic-wide board,
 * `/tv/d/[token]` per-doctor board). The call takeover is the one mechanism
 * both screens must keep behaviorally identical — same chime, same voice
 * phrasing, same flat green board — so it lives here, not in each page.
 */

/** Three-tone ascending chime (G5 → C6 → E6). */
export function playChime() {
  try {
    const ctx = new AudioContext();
    const tone = (freq: number, delay: number, dur: number, vol: number) => {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.value = vol;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
        osc.stop(ctx.currentTime + dur);
      }, delay);
    };
    tone(784, 0, 0.6, 0.4); // G5
    tone(1047, 250, 0.6, 0.4); // C6
    tone(1319, 500, 0.8, 0.35); // E6
  } catch {
    // AudioContext blocked until the screen is tapped — the activation
    // splash handles that.
  }
}

/** RU voice announcement, delayed so the chime lands first. */
export function announce(
  patientName: string,
  cabinet: string,
  ticketNumber: string,
  delayMs = 1200,
) {
  setTimeout(() => {
    try {
      const who = patientName
        ? patientName
        : ticketNumber
          ? `Талон ${ticketNumber}`
          : "Следующий пациент";
      const u = new SpeechSynthesisUtterance(
        cabinet ? `${who}, пройдите в кабинет ${cabinet}` : `${who}, проходите`,
      );
      u.lang = "ru-RU";
      u.rate = 0.85;
      u.volume = 1;
      u.pitch = 1.1;
      speechSynthesis.speak(u);
    } catch {
      // Speech synthesis unavailable — the visual takeover still shows.
    }
  }, delayMs);
}

export const CALL_GREEN = "#16C784";

/**
 * Flat solid-green call takeover — the way real clinic signage flips. Color
 * and size carry the message across the room; nothing else moves. Consumers
 * provide the `.animate-fade-in`/`.board-in` keyframes (both pages define an
 * equivalent 0.25s fade).
 */
export function CallTakeover({
  cabinet,
  patientName,
  ticketNumber,
  doctorName,
  className = "",
}: {
  cabinet: string;
  patientName: string;
  ticketNumber: string;
  doctorName?: string;
  className?: string;
}) {
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center px-10 text-center ${className}`}
      style={{ background: CALL_GREEN, color: "#FFFFFF" }}
    >
      <p className="text-4xl font-bold uppercase tracking-widest">
        Пройдите{cabinet ? " в кабинет" : ""}
      </p>
      {cabinet && (
        <p className="mt-2 font-mono text-[11rem] font-bold leading-none tabular-nums">
          {cabinet}
        </p>
      )}
      <p className="mt-8 max-w-full truncate text-7xl font-bold">
        {patientName || ticketNumber || ""}
      </p>
      <div className="mt-6 flex items-center justify-center gap-6 text-3xl font-semibold opacity-85">
        {doctorName && <span>{doctorName}</span>}
        {ticketNumber && patientName && (
          <span className="font-mono tabular-nums">Талон {ticketNumber}</span>
        )}
      </div>
    </div>
  );
}
