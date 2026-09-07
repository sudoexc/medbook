"use client";

/**
 * Shared signage pieces for the two TV surfaces (`/tv` clinic-wide board,
 * `/tv/d/[token]` per-doctor board). The call takeover is the one mechanism
 * both screens must keep behaviorally identical — same chime, same voice
 * phrasing, same flat green board — so it lives here, not in each page.
 */

import { useEffect } from "react";

/**
 * One AudioContext for the whole screen, created lazily.
 *
 * Previously every chime constructed its own context. A context created
 * without a user gesture starts `suspended`, so each call silently built a
 * dead context and the board needed a full-screen "tap to start" splash
 * before it would show anything. Signage must never withhold the queue to
 * bargain for sound: we keep a single context, unlock it on the first stray
 * interaction (see `useAudioUnlock`), and let the visuals run regardless.
 */
let sharedCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    sharedCtx ??= new AudioContext();
    return sharedCtx;
  } catch {
    return null;
  }
}

/**
 * Resume the shared context. Safe to call at any time — a no-op once running.
 * Autoplay policy only lets this succeed inside a user gesture, hence the
 * listeners in `useAudioUnlock`; kiosk browsers that grant autoplay resume on
 * the very first attempt instead.
 */
export function unlockAudio() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

/**
 * Arms audio without blocking the screen: the first pointer/key/touch event
 * anywhere on the page resumes the context, then the listeners remove
 * themselves. On a TV box that is one press of the remote — and until it
 * happens the board is already live, just mute.
 */
export function useAudioUnlock() {
  useEffect(() => {
    unlockAudio(); // kiosk browsers with autoplay enabled need nothing more
    const arm = () => {
      unlockAudio();
      for (const evt of ["pointerdown", "keydown", "touchstart"] as const) {
        window.removeEventListener(evt, arm);
      }
    };
    for (const evt of ["pointerdown", "keydown", "touchstart"] as const) {
      window.addEventListener(evt, arm, { passive: true });
    }
    return () => {
      for (const evt of ["pointerdown", "keydown", "touchstart"] as const) {
        window.removeEventListener(evt, arm);
      }
    };
  }, []);
}

/** Three-tone ascending chime (G5 → C6 → E6). */
export function playChime() {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    // A context can fall back to `suspended` (tab backgrounded, HDMI input
    // switched away). Retry here so the next call isn't silently lost.
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
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
    // Audio still locked (no interaction yet on a policy-strict browser).
    // The visual call takeover carries the message on its own.
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
