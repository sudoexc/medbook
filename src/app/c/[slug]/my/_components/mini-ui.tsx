"use client";

import * as React from "react";

import { formatMoney } from "@/lib/format";

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
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ma-press active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100";
  const variants = {
    primary: "text-white",
    secondary: "border text-[var(--tg-text)]",
    ghost: "text-[var(--tg-accent)]",
    danger: "text-white",
  } as const;
  const style: React.CSSProperties = {};
  if (variant === "primary") {
    style.backgroundColor = "var(--tg-accent)";
  } else if (variant === "secondary") {
    style.borderColor = "color-mix(in oklch, var(--tg-hint) 40%, transparent)";
    style.backgroundColor = "var(--tg-section-bg)";
  } else if (variant === "danger") {
    style.backgroundColor = "var(--ma-danger-solid)";
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
      className={`rounded-2xl p-4 transition-transform duration-150 ${className}`}
      style={{
        backgroundColor: "var(--tg-section-bg)",
        color: "var(--tg-text)",
        boxShadow:
          "var(--ma-card-shadow, 0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.05))",
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
      className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl px-4 py-3 text-left ma-press active:scale-[0.99] disabled:opacity-50 ${
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

/**
 * Bottom sheet with animated enter/exit. Children may be a render-prop that
 * receives `requestClose` — call it instead of the parent's `onClose` so the
 * slide-down animation plays before the sheet unmounts. Plain `onClose`
 * still works for programmatic closes after a mutation (instant unmount).
 */
export function MSheet({
  onClose,
  ariaLabel,
  children,
}: {
  onClose: () => void;
  ariaLabel?: string;
  children: React.ReactNode | ((requestClose: () => void) => React.ReactNode);
}) {
  const [closing, setClosing] = React.useState(false);
  const requestClose = React.useCallback(() => setClosing(true), []);

  React.useEffect(() => {
    if (!closing) return;
    const t = setTimeout(onClose, 240);
    return () => clearTimeout(t);
  }, [closing, onClose]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="presentation"
      onClick={requestClose}
    >
      <div
        aria-hidden
        className={`absolute inset-0 bg-black/45 backdrop-blur-sm ${
          closing ? "ma-backdrop-out" : "ma-backdrop-in"
        }`}
      />
      <div
        role="dialog"
        aria-modal
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-[430px] rounded-t-2xl px-4 pt-3 ${
          closing ? "ma-sheet-out" : "ma-sheet-in"
        }`}
        style={{
          backgroundColor: "var(--tg-bg)",
          color: "var(--tg-text)",
          paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)",
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-1 w-10 rounded-full"
          style={{
            backgroundColor:
              "color-mix(in oklch, var(--tg-hint) 40%, transparent)",
          }}
        />
        {typeof children === "function" ? children(requestClose) : children}
      </div>
    </div>
  );
}

export function MEmpty({
  icon: Icon,
  children,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-2xl border px-4 py-10 text-center text-sm"
      style={{
        backgroundColor: "var(--tg-section-bg)",
        color: "var(--tg-hint)",
        borderColor: "color-mix(in oklch, var(--tg-hint) 25%, transparent)",
      }}
    >
      {Icon ? (
        <Icon className="h-16 w-16 opacity-25" aria-hidden />
      ) : null}
      <div className="max-w-[260px]">{children}</div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

// `amount` is in tiins (UZS minor units). The patient's `preferredLang`
// selects the localised unit suffix (so'm / сум) via `formatMoney`.
export function formatSum(
  amount: number | null | undefined,
  lang: "RU" | "UZ",
): string {
  if (amount == null) return "—";
  return formatMoney(amount, "UZS", lang === "UZ" ? "uz" : "ru");
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
