"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangleIcon, HomeIcon, RotateCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Top-level CRM error boundary — catches any uncaught error raised in a
 * CRM route segment (`/[locale]/crm/**`). Next.js App Router bubbles
 * errors up to the nearest `error.tsx`; without this file crashes would
 * surface the framework default white-screen.
 *
 * Offers two escapes:
 *   - "Повторить"  → `reset()` (Next.js re-renders the segment subtree).
 *   - "Вернуться"  → hard-link to `/crm/reception` (shell home).
 *
 * The `digest` prop is Next's server-side error hash; we surface it only
 * in development so it's easy to cross-reference with server logs.
 */
export default function CrmError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[crm/error-boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangleIcon className="size-7" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">
        {t("errorBoundaryTitle")}
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {t("errorBoundaryDescription")}
      </p>
      {process.env.NODE_ENV !== "production" && error?.message ? (
        <pre className="mt-4 max-w-xl overflow-x-auto rounded-md bg-muted/60 p-3 text-left text-xs text-muted-foreground">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : null}
        </pre>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset} variant="default">
          <RotateCwIcon className="size-4" />
          {t("retry")}
        </Button>
        <Link
          href="/crm/reception"
          className={buttonVariants({ variant: "outline" })}
        >
          <HomeIcon className="size-4" />
          {t("goHome")}
        </Link>
      </div>
    </div>
  );
}
