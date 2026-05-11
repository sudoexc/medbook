"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CopyIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type MintSuccess = {
  url: string;
  token: string;
  expiresAt: string;
  botUsername: string;
  isFreshlyMinted: boolean;
};

type MintErrorBody =
  | { error: "bot_not_configured" }
  | {
      error: "already_linked";
      telegramId: string;
      telegramUsername?: string | null;
    }
  | { error: string };

type MintResult =
  | { kind: "ok"; data: MintSuccess }
  | {
      kind: "already_linked";
      telegramId: string;
      telegramUsername: string | null;
    }
  | { kind: "bot_not_configured" }
  | { kind: "error"; message: string };

export interface TelegramInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}

/**
 * Mint a `t.me/<bot>?start=<token>` invite link for a patient who isn't
 * linked to Telegram yet and surface it for the receptionist to share.
 *
 * Behaviour:
 *  - Auto-mints on open (idempotent within 24h, the API reuses an active row).
 *  - Re-mint button: forces a fresh token (server still respects the 24h
 *    reuse window, so the result may be the same row).
 *  - 409 already_linked: render the existing link instead of the URL.
 *  - 412 bot_not_configured: render an explanatory note.
 */
export function TelegramInviteDialog({
  open,
  onOpenChange,
  patientId,
}: TelegramInviteDialogProps) {
  const t = useTranslations("patientCard.telegramInviteDialog");
  const qc = useQueryClient();
  const [result, setResult] = React.useState<MintResult | null>(null);

  const mint = useMutation<MintResult, Error, void>({
    mutationFn: async () => {
      const res = await fetch(
        `/api/crm/patients/${encodeURIComponent(patientId)}/telegram-invite`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        },
      );
      const body = (await res.json().catch(() => ({}))) as
        | MintSuccess
        | MintErrorBody;
      if (res.status === 409 && "error" in body && body.error === "already_linked") {
        const tg = body as Extract<MintErrorBody, { error: "already_linked" }>;
        return {
          kind: "already_linked",
          telegramId: tg.telegramId,
          telegramUsername: tg.telegramUsername ?? null,
        };
      }
      if (
        res.status === 412 &&
        "error" in body &&
        body.error === "bot_not_configured"
      ) {
        return { kind: "bot_not_configured" };
      }
      if (!res.ok) {
        const message =
          ("error" in body && typeof body.error === "string" && body.error) ||
          `HTTP ${res.status}`;
        return { kind: "error", message };
      }
      return { kind: "ok", data: body as MintSuccess };
    },
    onSuccess: (r) => {
      setResult(r);
      // Refresh patient query so any newly-stamped telegramId shows up
      // immediately if the patient happens to consume the link while the
      // dialog stays open.
      void qc.invalidateQueries({ queryKey: ["patient", patientId] });
    },
    onError: (e) => {
      setResult({ kind: "error", message: e.message });
    },
  });

  React.useEffect(() => {
    if (open) {
      setResult(null);
      mint.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientId]);

  const onCopy = React.useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t("copied"));
      } catch {
        toast.error(t("copyFailed"));
      }
    },
    [t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {mint.isPending && !result ? (
            <p className="text-sm text-muted-foreground">{t("minting")}</p>
          ) : null}

          {result?.kind === "ok" ? (
            <>
              <div className="grid gap-1">
                <label
                  htmlFor="tg-invite-url"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("linkLabel")}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tg-invite-url"
                    readOnly
                    value={result.data.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    aria-label={t("copy")}
                    onClick={() => onCopy(result.data.url)}
                  >
                    <CopyIcon className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <p>
                  {t("botLabel")}:{" "}
                  <span className="font-mono">@{result.data.botUsername}</span>
                </p>
                <p>
                  {t("expiresAt")}:{" "}
                  <span className="tabular-nums">
                    {new Date(result.data.expiresAt).toLocaleString()}
                  </span>
                </p>
                <p className="mt-1">{t("hint")}</p>
              </div>
            </>
          ) : null}

          {result?.kind === "already_linked" ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{t("alreadyLinkedTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {result.telegramUsername
                  ? `@${result.telegramUsername}`
                  : `ID ${result.telegramId}`}
              </p>
            </div>
          ) : null}

          {result?.kind === "bot_not_configured" ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {t("botNotConfigured")}
            </div>
          ) : null}

          {result?.kind === "error" ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {result.message}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mint.isPending}
          >
            {t("close")}
          </Button>
          {result?.kind === "ok" ? (
            <>
              <Button
                variant="outline"
                onClick={() => mint.mutate()}
                disabled={mint.isPending}
              >
                <RefreshCwIcon className="size-4" />
                {t("remint")}
              </Button>
              <a
                href={result.data.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "default" }))}
              >
                <ExternalLinkIcon className="size-4" />
                {t("openInTelegram")}
              </a>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
