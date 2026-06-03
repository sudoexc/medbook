"use client";

/**
 * Phase M4 — Mini App skeleton atoms.
 *
 * One source of truth for "loading row" placeholders across every list
 * screen (appointments / documents / inbox / medications / family / nps /
 * pre-visit). Two primitives:
 *
 *   • `<SkeletonBlock />` — a single rounded rectangle with the pulse
 *     keyframes defined in `mini-app-shell.tsx` (`@keyframes ma-pulse`).
 *   • `<SkeletonList rows={N} variant="card|line" />` — renders 3-5
 *     `SkeletonBlock`s stacked.
 *
 * Why not Suspense — per TZ §5.7, React Query's `isPending` is more
 * predictable on the client (Suspense fires on every refetch and creates
 * jank). Screens render this skeleton when `isPending && !data`, and keep
 * showing existing `data` when `isFetching && data` — that gives the
 * "background refresh" feel without re-mounting the list.
 *
 * Visual tuning: lifted into a single config block so the "капризный" round
 * (per TZ §M4.8) can re-time / re-shape skeletons without grepping the
 * codebase.
 */
import * as React from "react";

type Tunables = {
  // Total pulse duration in seconds. 1.4s ≈ "thoughtful but not slow".
  pulseSeconds: number;
  // Rounded corner radius for the block — matches the screen card radius.
  radiusPx: number;
  // Default skeleton row gap (matches the typical card spacing).
  gapPx: number;
};

export const SKELETON_TUNABLES: Tunables = {
  pulseSeconds: 1.4,
  radiusPx: 14,
  gapPx: 10,
};

export function SkeletonBlock({
  height = 16,
  width = "100%",
  radius = SKELETON_TUNABLES.radiusPx,
  className,
  style,
}: {
  height?: number | string;
  width?: number | string;
  radius?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={`ma-skeleton ${className ?? ""}`}
      style={{
        width,
        height,
        borderRadius: radius,
        animationDuration: `${SKELETON_TUNABLES.pulseSeconds}s`,
        ...style,
      }}
    />
  );
}

type Variant = "card" | "line" | "inbox" | "appointment";

/**
 * A vertical stack of skeleton blocks. `variant` picks a shape preset that
 * matches the corresponding real list (so the layout doesn't visibly shift
 * once data arrives).
 */
export function SkeletonList({
  rows = 4,
  variant = "card",
  className,
}: {
  rows?: number;
  variant?: Variant;
  className?: string;
}) {
  const items = Array.from({ length: rows }, (_, i) => i);
  return (
    <div
      className={`flex flex-col ${className ?? ""}`}
      style={{ gap: SKELETON_TUNABLES.gapPx }}
    >
      {items.map((i) => (
        <SkeletonRow key={i} variant={variant} index={i} />
      ))}
    </div>
  );
}

function SkeletonRow({ variant, index }: { variant: Variant; index: number }) {
  switch (variant) {
    case "line":
      return (
        <SkeletonBlock
          height={14}
          width={`${68 + ((index * 7) % 25)}%`}
          radius={6}
        />
      );
    case "inbox":
      return (
        <div className="flex items-center gap-3 rounded-2xl bg-[var(--tg-section-bg)] p-3">
          <SkeletonBlock height={36} width={36} radius={18} />
          <div className="flex flex-1 flex-col gap-2">
            <SkeletonBlock height={12} width="60%" radius={4} />
            <SkeletonBlock height={10} width="90%" radius={4} />
          </div>
        </div>
      );
    case "appointment":
      return (
        <div className="flex flex-col gap-3 rounded-2xl bg-[var(--tg-section-bg)] p-4">
          <div className="flex items-center gap-3">
            <SkeletonBlock height={44} width={44} radius={22} />
            <div className="flex flex-1 flex-col gap-2">
              <SkeletonBlock height={14} width="55%" radius={4} />
              <SkeletonBlock height={11} width="35%" radius={4} />
            </div>
          </div>
          <SkeletonBlock height={1} width="100%" radius={0} />
          <SkeletonBlock height={11} width="75%" radius={4} />
        </div>
      );
    case "card":
    default:
      return (
        <div className="flex flex-col gap-3 rounded-2xl bg-[var(--tg-section-bg)] p-4">
          <SkeletonBlock height={14} width="65%" radius={4} />
          <SkeletonBlock height={11} width="40%" radius={4} />
          <SkeletonBlock height={11} width="85%" radius={4} />
        </div>
      );
  }
}
