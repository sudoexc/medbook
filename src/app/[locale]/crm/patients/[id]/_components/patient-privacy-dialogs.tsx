"use client";

/**
 * The patient's data rights, from the card (ADMIN only): a copy of their
 * data, and a request to erase it (audit PT-07, PT-09).
 *
 * Neither existed in the interface. The export was reachable only from a
 * component nothing rendered, and its password was generated in the worker
 * and kept as a bcrypt hash, so an admin without a bound Telegram got an
 * archive nobody could open. The card answered a delete of a patient with
 * history with «HTTP 409» and no way forward. Now:
 *   - «Выгрузить данные пациента» creates the export and shows its password
 *     once, here, with where the archive will be;
 *   - «Заявка на удаление данных» creates the DSAR request, saying what is
 *     erased and what medical records stay, and explains a 409.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CopyIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ExportResult = {
  passphrase: string;
  deliversToTelegram: boolean;
};

/** The card's export request; exported for tests. */
export async function requestPatientDataExport(
  patientId: string,
  fetcher: typeof fetch = fetch,
): Promise<
  | { kind: "ok"; result: ExportResult }
  | { kind: "already_active" }
  | { kind: "error" }
> {
  try {
    const res = await fetcher(
      `/api/crm/patients/${encodeURIComponent(patientId)}/data-export`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      },
    );
    if (res.status === 409) return { kind: "already_active" };
    if (!res.ok) return { kind: "error" };
    const body = (await res.json()) as Partial<ExportResult>;
    if (typeof body.passphrase !== "string") return { kind: "error" };
    return {
      kind: "ok",
      result: {
        passphrase: body.passphrase,
        deliversToTelegram: Boolean(body.deliversToTelegram),
      },
    };
  } catch {
    return { kind: "error" };
  }
}

/** The card's erasure request; exported for tests. */
export async function requestPatientErasure(
  patientId: string,
  reason: string,
  fetcher: typeof fetch = fetch,
): Promise<"ok" | "already_active" | "already_erased" | "error"> {
  try {
    const res = await fetcher("/api/crm/dsar/deletions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        patientId,
        ...(reason.trim() ? { reason: reason.trim().slice(0, 200) } : {}),
      }),
    });
    if (res.ok) return "ok";
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return body.error === "already_erased" ? "already_erased" : "already_active";
    }
    return "error";
  } catch {
    return "error";
  }
}

export function PatientDataExportDialog({
  open,
  onOpenChange,
  patientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}) {
  const t = useTranslations("patientCard.quickActions.privacy");
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<ExportResult | null>(null);

  React.useEffect(() => {
    // The password lives in this dialog only: gone once it closes.
    if (!open) {
      setResult(null);
      setPending(false);
    }
  }, [open]);

  const start = async () => {
    setPending(true);
    const out = await requestPatientDataExport(patientId);
    setPending(false);
    if (out.kind === "ok") setResult(out.result);
    else if (out.kind === "already_active") toast.message(t("exportAlreadyActive"));
    else toast.error(t("exportError"));
  };

  const copy = () => {
    if (!result) return;
    void navigator.clipboard
      ?.writeText(result.passphrase)
      .then(() => toast.success(t("copied")));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("exportTitle")}</DialogTitle>
          <DialogDescription>{t("exportBody")}</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-3 text-sm">
            <div className="grid gap-1">
              <Label htmlFor="dsar-passphrase">{t("exportPasswordLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  id="dsar-passphrase"
                  readOnly
                  value={result.passphrase}
                  className="font-mono"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={copy}>
                  <CopyIcon className="size-4" />
                  {t("copy")}
                </Button>
              </div>
            </div>
            <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-foreground">
              {t("exportPasswordOnce")}
            </p>
            <p className="text-muted-foreground">
              {result.deliversToTelegram ? t("exportWhereTelegram") : t("exportWhereDsar")}
            </p>
            <p className="text-muted-foreground">{t("exportHowToOpen")}</p>
          </div>
        ) : null}
        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>{t("close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button onClick={() => void start()} disabled={pending}>
                {pending ? t("exportStarting") : t("exportStart")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PatientErasureRequestDialog({
  open,
  onOpenChange,
  patientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}) {
  const t = useTranslations("patientCard.quickActions.privacy");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setReason("");
      setPending(false);
    }
  }, [open]);

  const submit = async () => {
    setPending(true);
    const out = await requestPatientErasure(patientId, reason);
    setPending(false);
    if (out === "ok") {
      toast.success(t("erasureSuccess"));
      onOpenChange(false);
    } else if (out === "already_active") {
      toast.message(t("erasureAlreadyActive"));
      onOpenChange(false);
    } else if (out === "already_erased") {
      toast.message(t("erasureAlreadyErased"));
      onOpenChange(false);
    } else {
      toast.error(t("erasureError"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("erasureTitle")}</DialogTitle>
          <DialogDescription>{t("erasureBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          <p className="text-foreground">{t("erasureErased")}</p>
          <p className="text-muted-foreground">{t("erasureKept")}</p>
          <div className="grid gap-1 pt-1">
            <Label htmlFor="dsar-reason">{t("erasureReasonLabel")}</Label>
            <Input
              id="dsar-reason"
              value={reason}
              maxLength={200}
              placeholder={t("erasureReasonPlaceholder")}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={pending}>
            {pending ? t("erasureSubmitting") : t("erasureSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
