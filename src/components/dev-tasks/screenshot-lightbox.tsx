"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, ImageIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { isHeicFile, type DevTaskAttachmentDto } from "@/lib/dev-tasks";
import { cn } from "@/lib/utils";

/**
 * A screenshot at full size. Arrows (and ← → on a keyboard) step through
 * the task's screenshots; «Открыть оригинал» opens the file in a new tab
 * for zooming on a phone. A file this browser cannot draw (a HEIC from an
 * iPhone, in Chrome) shows a card saying so with «Открыть оригинал»
 * instead of a broken image.
 */
export function ScreenshotLightbox({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  items: DevTaskAttachmentDto[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations("devTasks.detail");
  const open = index !== null && items.length > 0;
  const current = open ? items[Math.min(index, items.length - 1)] : null;
  const total = items.length;
  const at = index ?? 0;
  const [broken, setBroken] = React.useState<Record<string, true>>({});

  const step = React.useCallback(
    (delta: number) => {
      if (total < 2) return;
      onIndexChange((at + delta + total) % total);
    },
    [at, total, onIndexChange],
  );

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-3 p-3 sm:max-w-4xl">
        <DialogTitle className="pr-10 text-sm text-muted-foreground">
          {t("screenshotAlt", { index: at + 1, total })}
        </DialogTitle>
        {current ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-muted/40">
            {broken[current.id] ? (
              <div className="flex max-w-sm flex-col items-center gap-3 px-6 py-10 text-center">
                <ImageIcon className="size-10 text-muted-foreground" aria-hidden />
                <p className="text-sm text-foreground">
                  {isHeicFile({ type: current.mimeType }) ? t("heicCannotShow") : t("cannotShow")}
                </p>
                <a
                  href={current.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants(), "h-11 px-4 md:h-9")}
                >
                  <ExternalLinkIcon />
                  {t("openOriginal")}
                </a>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- a session-gated stream, not a static asset
              <img
                key={current.id}
                src={current.url}
                alt={t("screenshotAlt", { index: at + 1, total })}
                onError={() => setBroken((prev) => ({ ...prev, [current.id]: true }))}
                className="max-h-[calc(100dvh-9rem)] w-auto max-w-full object-contain"
              />
            )}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              onClick={() => step(-1)}
              disabled={total < 2}
              aria-label={t("prev")}
              className="size-11 md:size-9"
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              onClick={() => step(1)}
              disabled={total < 2}
              aria-label={t("next")}
              className="size-11 md:size-9"
            >
              <ChevronRightIcon />
            </Button>
          </div>
          {current ? (
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary hover:bg-muted md:h-9"
            >
              <ExternalLinkIcon className="size-4" />
              {t("openOriginal")}
            </a>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
