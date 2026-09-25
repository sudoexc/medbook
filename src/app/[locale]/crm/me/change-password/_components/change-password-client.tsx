"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { KeyRoundIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";

interface PostBody {
  currentPassword?: string;
  newPassword: string;
}

async function postPassword(body: PostBody): Promise<void> {
  const r = await fetch("/api/crm/me/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const data = (await r.json().catch(() => null)) as
      | { error?: string; reason?: string }
      | null;
    throw new Error(data?.reason ?? data?.error ?? `HTTP ${r.status}`);
  }
}

export function ChangePasswordClient({
  forced,
  requireCurrent,
  homeHref,
}: {
  forced: boolean;
  /** Ask for the current password. Only a session freshly opened with a
   *  temporary password may skip it (the server enforces the same rule). */
  requireCurrent: boolean;
  /** Where to go once the new password is saved (the user's own surface). */
  homeHref: string;
}) {
  const t = useTranslations("meChangePassword");
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [mismatch, setMismatch] = React.useState(false);

  const mut = useMutation({
    mutationFn: () =>
      postPassword({
        currentPassword: requireCurrent ? current : undefined,
        newPassword: next,
      }),
    onSuccess: () => {
      toast.success(t("updated"));
      // No session refresh dance needed: the jwt callback re-reads
      // mustChangePassword from the database on every request, so the proxy
      // releases the forced redirect on this very navigation. (The old POST
      // to /api/auth/session carried no CSRF token and never ran.)
      window.location.assign(homeHref);
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Error";
      if (msg === "invalid_current") {
        toast.error(t("invalidCurrent"));
      } else if (msg === "current_required") {
        toast.error(t("currentRequired"));
      } else {
        toast.error(msg);
      }
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    mut.mutate();
  };

  const canSubmit =
    next.length >= 8 &&
    confirm.length >= 8 &&
    (!requireCurrent || current.length > 0) &&
    !mut.isPending;

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRoundIcon className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-none">
              {forced ? t("headingForced") : t("headingChange")}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {forced ? t("subtitleForced") : t("subtitleChange")}
            </p>
          </div>
        </div>

        {requireCurrent && (
          <div className="grid gap-1.5">
            <Label htmlFor="current">{t("currentLabel")}</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="next">{t("newLabel")}</Label>
          <Input
            id="next"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              if (mismatch) setMismatch(false);
            }}
            minLength={8}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="confirm">{t("confirmLabel")}</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (mismatch) setMismatch(false);
            }}
            aria-invalid={mismatch ? true : undefined}
          />
          {mismatch && (
            <p className="text-xs text-destructive">{t("mismatch")}</p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {mut.isPending ? t("saving") : t("submit")}
        </Button>
      </form>
    </div>
  );
}
