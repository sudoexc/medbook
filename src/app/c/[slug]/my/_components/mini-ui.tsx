"use client";

import * as React from "react";

/**
 * Mini-App atoms. Tiny and theme-aware — they read `--tg-*` CSS variables
 * from the shell so they look consistent in both light and dark Telegram
 * themes without re-implementing a full shadcn stack for mobile.
 */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  block?: boolean;
};

export function MButton({
  variant = "primary",
  block,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100";
  const variants = {
    primary: "text-white",
    secondary: "border text-[var(--tg-text)]",
    ghost: "text-[var(--tg-accent)]",
    danger: "text-white bg-red-500",
  } as const;
  const style: React.CSSProperties = {};
  if (variant === "primary") {
    style.backgroundColor = "var(--tg-accent)";
  } else if (variant === "secondary") {
    style.borderColor = "color-mix(in oklch, var(--tg-hint) 40%, transparent)";
    style.backgroundColor = "var(--tg-section-bg)";
  }
  return (
    <button
      {...rest}
      className={`${base} ${variants[variant]} ${block ? "w-full" : ""} ${className}`}
      style={{ ...style, ...(rest.style ?? {}) }}
    >
      {children}
    </button>
  );
}

export function MCard({
  className = "",
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={`rounded-2xl p-4 shadow-sm ${className}`}
      style={{
        backgroundColor: "var(--tg-section-bg)",
        color: "var(--tg-text)",
        ...(rest.style ?? {}),
      }}
    >
      {children}
    </div>
  );
}

export function MListItem({
  children,
  onClick,
  disabled,
  active,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition active:scale-[0.99] disabled:opacity-50 ${
        active ? "ring-2 ring-offset-0" : ""
      } ${className}`}
      style={{
        backgroundColor: "var(--tg-section-bg)",
        color: "var(--tg-text)",
        ...(active
          ? ({ "--tw-ring-color": "var(--tg-accent)" } as React.CSSProperties)
          : {}),
      }}
    >
      {children}
    </button>
  );
}

export function MHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed" style={{ color: "var(--tg-hint)" }}>
      {children}
    </p>
  );
}

export function MSpinner({ label }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-3 py-10 text-sm"
      style={{ color: "var(--tg-hint)" }}
    >
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden
      />
      {label ?? "…"}
    </div>
  );
}

export function MSection({
  title,
  children,
  action,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      {title || action ? (
        <div className="mb-2 flex items-center justify-between px-1">
          {title ? (
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--tg-hint)" }}>
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function MEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl border px-4 py-10 text-center text-sm"
      style={{
        backgroundColor: "var(--tg-section-bg)",
        color: "var(--tg-hint)",
        borderColor: "color-mix(in oklch, var(--tg-hint) 25%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

export function formatSum(amount: number | null | undefined, currencyLabel: string): string {
  if (amount == null) return "—";
  const formatted = new Intl.NumberFormat("ru-RU").format(amount);
  return `${formatted} ${currencyLabel}`;
}

export function formatDateISO(iso: string, lang: "RU" | "UZ"): string {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "UZ" ? "uz-Latn-UZ" : "ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatTimeISO(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
