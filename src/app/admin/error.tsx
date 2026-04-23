"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangleIcon, HomeIcon, RotateCwIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Top-level SUPER_ADMIN platform error boundary. Mirrors `/[locale]/crm/error.tsx`
 * but the admin shell is outside the `[locale]` tree, so we keep labels in
 * Russian (this surface is only seen by platform operators).
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[admin/error-boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangleIcon className="size-7" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">
        Что-то пошло не так
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Попробуйте повторить действие. Если ошибка повторяется — проверьте
        серверные логи и обратитесь к администратору платформы.
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
          Повторить
        </Button>
        <Link
          href="/admin"
          className={buttonVariants({ variant: "outline" })}
        >
          <HomeIcon className="size-4" />
          Вернуться
        </Link>
      </div>
    </div>
  );
}
