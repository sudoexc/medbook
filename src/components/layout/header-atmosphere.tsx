"use client";

import * as React from "react";

/**
 * Decorative falling-petal layer for the CRM topbar.
 *
 * Pure CSS — animation params are pre-baked into a deterministic array so
 * SSR and client renders match (no `Math.random()` during render). The layer
 * is `position: absolute` inside the 72px header with `overflow-hidden`, so
 * petals enter from above and exit just below the bottom edge.
 *
 * Honors `prefers-reduced-motion` via Tailwind's `motion-reduce:hidden`.
 */

type Petal = {
  left: number;
  delay: number;
  duration: number;
  size: number;
  sway: number;
  rotate: number;
  hue: "primary" | "info" | "success";
};

const PETALS: Petal[] = Array.from({ length: 22 }, (_, i) => {
  const left = (i * 91) % 100;
  const delay = (i * 0.85) % 14;
  const duration = 13 + ((i * 1.7) % 7);
  const size = 9 + (i % 5) * 2;
  const sway = (i % 2 === 0 ? 1 : -1) * (22 + (i % 3) * 12);
  const rotate = (i * 47) % 360;
  const hueIdx = i % 3;
  const hue = hueIdx === 0 ? "primary" : hueIdx === 1 ? "info" : "success";
  return { left, delay, duration, size, sway, rotate, hue };
});

export function HeaderAtmosphere() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 motion-reduce:hidden"
    >
      {PETALS.map((p, i) => (
        <span
          key={i}
          data-hue={p.hue}
          className="header-petal"
          style={
            {
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              animationDelay: `-${p.delay}s`,
              animationDuration: `${p.duration}s`,
              "--petal-sway": `${p.sway}px`,
              "--petal-rotate": `${p.rotate}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
