"use client";

/**
 * A short, soft two-tone ping for incoming-message toasts.
 *
 * Same architecture as the TV chime (`src/app/tv/_shared.tsx`) and for the
 * same reason: one lazily-created AudioContext per page, resumed on the first
 * user gesture, retried on every play. A context constructed outside a
 * gesture starts `suspended`, and a per-play `new AudioContext()` therefore
 * NEVER sounds — which is exactly how the desk ended up with silent
 * notifications.
 *
 * Deliberately quieter and shorter than the TV chime: this rings on a staffed
 * workstation every few minutes, not across a waiting room.
 */

let ctx: AudioContext | null = null;
let unlockInstalled = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

/** Resume on the first stray interaction; listeners remove themselves. */
export function installNotificationSoundUnlock(): void {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const arm = () => {
    const c = getCtx();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
    for (const evt of ["pointerdown", "keydown", "touchstart"] as const) {
      window.removeEventListener(evt, arm);
    }
  };
  for (const evt of ["pointerdown", "keydown", "touchstart"] as const) {
    window.addEventListener(evt, arm, { passive: true });
  }
}

export function playNotificationSound(): void {
  try {
    const c = getCtx();
    if (!c) return;
    if (c.state === "suspended") void c.resume().catch(() => {});
    const tone = (freq: number, delay: number, dur: number, vol: number) => {
      setTimeout(() => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.connect(gain);
        gain.connect(c.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.value = vol;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.01, c.currentTime + dur);
        osc.stop(c.currentTime + dur);
      }, delay);
    };
    tone(880, 0, 0.18, 0.12); // A5
    tone(1175, 140, 0.22, 0.1); // D6
  } catch {
    // Audio still locked — the toast carries the message on its own.
  }
}
