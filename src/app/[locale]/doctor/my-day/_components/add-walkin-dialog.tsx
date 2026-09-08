"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, SearchIcon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";

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

import { doctorTodayKey } from "../_hooks/use-doctor-today";

/**
 * Lets the doctor put a patient into their OWN live queue without routing them
 * through the front desk — returning patients routinely walk straight to the
 * office ("система новая, я сам их добавлю").
 *
 * Two ways in, matching what `/api/crm/appointments/walkin` accepts: pick an
 * existing patient (the common case — the doctor's own long-standing patients
 * are already in the base) or create one inline from name + phone. The route
 * ignores any doctorId but the caller's own, so this cannot fill a colleague's
 * queue.
 */
interface PatientHit {
  id: string;
  fullName: string;
  phone: string | null;
  patientNumber: number | null;
}

export function AddWalkinDialog({
  open,
  onOpenChange,
  doctorId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  doctorId: string;
}) {
  const t = useTranslations("doctor.myDay.addWalkin");
  const qc = useQueryClient();

  const [term, setTerm] = React.useState("");
  const [picked, setPicked] = React.useState<PatientHit | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newPhone, setNewPhone] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setTerm("");
      setPicked(null);
      setCreating(false);
      setNewName("");
      setNewPhone("");
    }
  }, [open]);

  // Debounce so typing a name doesn't fire a request per keystroke.
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  const search = useQuery<PatientHit[], Error>({
    queryKey: ["doctor", "walkin-patient-search", debounced],
    enabled: open && !creating && debounced.length >= 2,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/patients?q=${encodeURIComponent(debounced)}&limit=8`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows?: PatientHit[] };
      return j.rows ?? [];
    },
    staleTime: 10_000,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const body = picked
        ? { doctorId, patientId: picked.id }
        : {
            doctorId,
            newPatient: {
              fullName: newName.trim(),
              phone: newPhone.trim(),
            },
          };
      const res = await fetch("/api/crm/appointments/walkin", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (j?.error === "bad_phone") throw new Error(t("badPhone"));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { ticketNumber?: string };
    },
    onSuccess: (r) => {
      toast.success(
        r.ticketNumber ? t("addedWithTicket", { ticket: r.ticketNumber }) : t("added"),
      );
      void qc.invalidateQueries({ queryKey: doctorTodayKey });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || t("failed")),
  });

  const canSubmit = creating
    ? newName.trim().length >= 2 && newPhone.trim().length >= 3
    : Boolean(picked);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {creating ? (
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("fullName")}
              </label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("fullNamePlaceholder")}
                autoFocus
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("phone")}
              </label>
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+998 90 123 45 67"
                inputMode="tel"
              />
            </div>
            <button
              type="button"
              className="justify-self-start text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => setCreating(false)}
            >
              {t("backToSearch")}
            </button>
          </div>
        ) : (
          <div className="grid gap-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setPicked(null);
                }}
                placeholder={t("searchPlaceholder")}
                className="pl-8"
                autoFocus
              />
            </div>

            <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
              {debounced.length < 2 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("searchHint")}
                </p>
              ) : search.isLoading ? (
                <p className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {t("searching")}
                </p>
              ) : (search.data ?? []).length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("nothingFound")}
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {(search.data ?? []).map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(p)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 ${
                          picked?.id === p.id ? "bg-primary/10" : ""
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {p.fullName}
                          </span>
                          {p.phone ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {p.phone}
                            </span>
                          ) : null}
                        </span>
                        {p.patientNumber ? (
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            №{p.patientNumber}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              type="button"
              className="justify-self-start text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => {
                setCreating(true);
                setNewName(term.trim());
              }}
            >
              {t("createNew")}
            </button>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submit.isPending}
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={!canSubmit || submit.isPending}
          >
            {submit.isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <UserPlusIcon className="size-4" />
            )}
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
