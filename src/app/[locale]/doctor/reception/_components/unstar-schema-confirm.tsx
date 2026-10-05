"use client";

/**
 * «Убрать из «Мои»?» under a starred drug whose pin carries the schema he
 * set on «Мой арсенал»: the unstar deletes the pin and the schema with it
 * (see `unstarDropsSchema`). Inline, two buttons, never `window.confirm`:
 * the question stays next to the star he clicked, and Esc or «Оставить»
 * leaves everything as it was.
 */
import * as React from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function UnstarSchemaConfirm({
  onConfirm,
  onCancel,
  className,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const t = useTranslations("doctor.receptionDialogs.favorites");
  const keepRef = React.useRef<HTMLButtonElement>(null);
  // The safe answer takes the focus, so Enter or a second click on the
  // keyboard never deletes the schema by accident.
  React.useEffect(() => {
    keepRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      role="group"
      aria-label={t("unstarSchemaQuestion")}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      className={cn("rounded-lg border border-warning/50 bg-warning/10 p-2", className)}
    >
      <p className="break-words text-[13px] leading-snug text-foreground">
        {t("unstarSchemaQuestion")}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Button type="button" variant="destructive" size="sm" onClick={onConfirm}>
          {t("unstarConfirm")}
        </Button>
        <Button ref={keepRef} type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("unstarKeep")}
        </Button>
      </div>
    </div>
  );
}
