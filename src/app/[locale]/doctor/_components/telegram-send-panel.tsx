"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { CheckIcon, CopyIcon, Loader2Icon, SendIcon } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * One button that closes the visit's paperwork loop over Telegram.
 *
 * The clinic's real flow: the patient is standing in the cabinet, the visit
 * is done, and the doctor wants the conclusion and any attachments in the
 * patient's Telegram before they walk out. Two states:
 *
 *  - linked → «Отправить в Telegram»: POST send-telegram pushes every document
 *    of this visit as a real file upload (no links — the bucket is private).
 *  - not linked → «Привязать Telegram»: a dialog with a QR of the per-patient
 *    deep link (existing invite-token machinery). The patient scans it with a
 *    phone camera, presses /start, and the panel — which polls the link
 *    status while the dialog is open — flips to the send button by itself.
 *
 * The auto-delivery worker still exists; this is for the case it cannot
 *  cover — a patient who linked up only after the conclusion was signed.
 */
export function TelegramSendPanel({
  patientId,
  visitNoteId,
}: {
  patientId: string;
  visitNoteId: string;
}) {
  const t = useTranslations("doctor.tgSend");
  const qc = useQueryClient();
  const [qrOpen, setQrOpen] = React.useState(false);

  const statusKey = ["doctor", "tg-status", patientId] as const;
  const status = useQuery<{ linked: boolean; username: string | null }, Error>({
    queryKey: statusKey,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/patients/${patientId}/telegram-invite`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { linked: boolean; username: string | null };
    },
    // While the QR dialog is up the patient is mid-scan — poll so the flip to
    // «linked» happens in front of both of them, no reload.
    refetchInterval: qrOpen ? 3000 : false,
    staleTime: 30_000,
  });

  const linked = status.data?.linked ?? false;

  // Close the dialog on our own success moment, not on a render surprise.
  React.useEffect(() => {
    if (qrOpen && linked) {
      setQrOpen(false);
      toast.success(t("linkedNow"));
    }
  }, [qrOpen, linked, t]);

  const send = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/visit-notes/${visitNoteId}/send-telegram`, {
        method: "POST",
        credentials: "include",
      });
      const j = (await res.json().catch(() => null)) as {
        sent?: number;
        reason?: string;
      } | null;
      if (!res.ok) {
        throw Object.assign(new Error(j?.reason ?? `HTTP ${res.status}`), {
          reason: j?.reason,
        });
      }
      return j as { sent: number; failed: number };
    },
    onSuccess: (r) => {
      toast.success(
        r.failed > 0
          ? t("sentPartial", { n: r.sent, failed: r.failed })
          : t("sent", { n: r.sent }),
      );
    },
    onError: (e: Error & { reason?: string }) => {
      if (e.reason === "not_linked") {
        // The patient unlinked (or was never linked) — flow into the QR
        // dialog instead of презенting a dead error.
        void qc.invalidateQueries({ queryKey: statusKey });
        setQrOpen(true);
        return;
      }
      if (e.reason === "nothing_to_send") {
        toast.error(t("nothingToSend"));
        return;
      }
      if (e.reason === "bot_not_configured") {
        toast.error(t("botNotConfigured"));
        return;
      }
      toast.error(t("sendFailed"));
    },
  });

  return (
    <>
      {linked ? (
        <Button
          variant="outline"
          disabled={send.isPending}
          onClick={() => send.mutate()}
          className="gap-2"
        >
          {send.isPending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <SendIcon className="size-4" />
          )}
          {t("send")}
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() => setQrOpen(true)}
          className="gap-2"
        >
          <SendIcon className="size-4" />
          {t("link")}
        </Button>
      )}

      <TelegramLinkDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        patientId={patientId}
      />
    </>
  );
}

/**
 * QR of the patient's personal deep link, big enough to scan across a desk.
 * The invite is minted lazily on open and reused within the server's 24h
 * window, so reopening the dialog does not churn tokens.
 */
function TelegramLinkDialog({
  open,
  onOpenChange,
  patientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
}) {
  const t = useTranslations("doctor.tgSend");
  const [copied, setCopied] = React.useState(false);

  const invite = useQuery<{ url: string; botUsername: string | null }, Error>({
    queryKey: ["doctor", "tg-invite", patientId],
    enabled: open,
    queryFn: async () => {
      const res = await fetch(`/api/crm/patients/${patientId}/telegram-invite`, {
        method: "POST",
        credentials: "include",
      });
      const j = (await res.json().catch(() => null)) as {
        url?: string;
        botUsername?: string | null;
        reason?: string;
      } | null;
      if (!res.ok) throw new Error(j?.reason ?? `HTTP ${res.status}`);
      return { url: j!.url!, botUsername: j?.botUsername ?? null };
    },
    staleTime: 5 * 60_000,
  });

  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    if (!invite.data?.url) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(invite.data.url, { width: 320, margin: 1 })
      .then((d) => {
        if (!cancelled) setQrDataUrl(d);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [invite.data?.url]);

  const copy = async () => {
    if (!invite.data?.url) return;
    try {
      await navigator.clipboard.writeText(invite.data.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("linkTitle")}</DialogTitle>
          <DialogDescription>{t("linkHint")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          {invite.isLoading || (!qrDataUrl && !invite.isError) ? (
            <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-border bg-muted/30">
              <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : invite.isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              {t("inviteFailed")}
            </p>
          ) : (
            // A plain img: the QR is a data URL, next/image adds nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl!}
              alt={t("qrAlt")}
              className="h-64 w-64 rounded-xl border border-border"
            />
          )}

          {invite.data?.botUsername ? (
            <p className="text-xs text-muted-foreground">
              @{invite.data.botUsername}
            </p>
          ) : null}

          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            {copied ? (
              <CheckIcon className="size-3.5" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
            {t("copyLink")}
          </button>

          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            {t("waiting")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
