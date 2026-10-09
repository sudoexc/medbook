"use client";

/**
 * Shared signage pieces for the two TV surfaces (`/tv` clinic-wide board,
 * `/tv/d/[token]` per-doctor board). The call takeover is the one mechanism
 * both screens must keep behaviorally identical — same chime, same voice
 * phrasing, same flat green board — so it lives here, not in each page.
 */

import { useEffect } from "react";

import {
  announcementText,
  planAnnouncement,
  type BoardLang,
} from "@/lib/tv-announce";

import { Bi, type TvTranslators } from "./_i18n";

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
    // The voice list loads asynchronously; asking once now means it is ready
    // by the first call, when the board picks an Uzbek voice (UX-06).
    try {
      window.speechSynthesis?.getVoices();
    } catch {
      // No speech synthesis on this box; calls stay visual.
    }
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

/**
 * Voice announcement, delayed so the chime lands first. Spoken in the called
 * patient's language when the box has a voice for it, in Russian otherwise
 * (UX-06, see `planAnnouncement`).
 */
export function announce(
  patientName: string,
  cabinet: string,
  ticketNumber: string,
  opts: {
    translators: TvTranslators;
    /** The called patient's language, from the `queue.called` signal. */
    lang: BoardLang | null;
    delayMs?: number;
  },
) {
  const call = { patientName, cabinet, ticketNumber };
  const texts = {
    ru: announcementText(opts.translators.ru, call),
    uz: announcementText(opts.translators.uz, call),
  };
  setTimeout(() => {
    try {
      const voices = speechSynthesis.getVoices();
      const plan = planAnnouncement(texts, opts.lang, voices);
      const u = new SpeechSynthesisUtterance(plan.text);
      u.lang = plan.lang;
      if (plan.voice) u.voice = plan.voice as SpeechSynthesisVoice;
      u.rate = 0.85;
      u.volume = 1;
      u.pitch = 1.1;
      speechSynthesis.speak(u);
    } catch {
      // Speech synthesis unavailable — the visual takeover still shows.
    }
  }, opts.delayMs ?? 1200);
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
      data-call-takeover
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center px-10 text-center ${className}`}
      style={{ background: CALL_GREEN, color: "#FFFFFF" }}
    >
      {/* Both languages: the whole hall reads this board (UX-06). */}
      <p className="text-4xl font-bold uppercase tracking-widest">
        <Bi
          k={cabinet ? "call.goToCabinet" : "call.goIn"}
          stacked
          uzClassName="mt-1 text-3xl opacity-90"
        />
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
          <span className="tabular-nums">
            <Bi k="call.ticket" uzStyle={{ opacity: 1 }} />{" "}
            <span className="font-mono">{ticketNumber}</span>
          </span>
        )}
      </div>
    </div>
  );
}
