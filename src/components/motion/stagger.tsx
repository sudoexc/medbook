"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Wrap a list to give each direct child a staggered entrance animation.
 * Pairs with `.motion-stagger` + `.motion-rise-in` (or any motion-*) class
 * defined in `globals.css`. The stagger step is configurable via the
 * `--motion-stagger-step` CSS var on `:root`.
 *
 * Stagger only fires once on mount (children get the entrance class). If
 * you need re-animation on data swaps, change `key` on the wrapper.
 */
export function Stagger({
  children,
  className,
  itemClassName = "motion-rise-in",
  stepMs,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  /** Animation class applied to each child (defaults to `motion-rise-in`). */
  itemClassName?: string;
  /** Override per-step delay in ms. */
  stepMs?: number;
  as?: keyof React.JSX.IntrinsicElements;
}) {
  const style: React.CSSProperties | undefined = stepMs
    ? ({ ["--motion-stagger-step" as never]: `${stepMs}ms` } as React.CSSProperties)
    : undefined;
  // Apply itemClassName to each direct child so we don't require the
  // caller to remember the class on every list item.
  const wrapped = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    const existing = (child.props as { className?: string }).className ?? "";
    return React.cloneElement(child as React.ReactElement<{ className?: string }>, {
      className: cn(existing, itemClassName),
    });
  });
  return (
    <Tag className={cn("motion-stagger", className)} style={style}>
      {wrapped}
    </Tag>
  );
}
