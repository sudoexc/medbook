"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PrinterIcon, PlusIcon, MapPinIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { DoctorPicker } from "@/components/appointments/new-appointment-dialog/doctor-picker";
import { PatientPicker } from "@/components/appointments/new-appointment-dialog/patient-picker";
import {
  EMPTY,
  type NewPatientForm,
  type PatientHit,
} from "@/components/appointments/new-appointment-dialog/types";

import { useActiveDoctors } from "../_hooks/use-reception-live";

interface WalkinTicket {
  appointmentId: string;
  ticketNumber: string;
  queueOrder: number;
  patient: { id: string; fullName: string };
  doctor: { id: string; nameRu: string; nameUz: string; color: string | null };
  cabinet: string | null;
}

export interface WalkinTicketDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Pre-select a doctor when opened from a doctor card. */
  initialDoctorId?: string | null;
  /** Called after a ticket is issued so the host can refresh / highlight. */
  onIssued?: (ticket: WalkinTicket) => void;
}

/**
 * Reception walk-in: issue a live-queue ticket for a patient at the front desk.
 * Pick a patient (existing or new) and a doctor → POST /api/crm/appointments/
 * walkin → the patient lands in the doctor's WAITING queue and the printable
 * ticket appears. Mirrors the kiosk flow but staff-driven.
 */
export function WalkinTicketDialog({
  open,
  onOpenChange,
  initialDoctorId,
  onIssued,
}: WalkinTicketDialogProps) {
  const t = useTranslations("reception.walkin");
  const qc = useQueryClient();

  const [patient, setPatient] = React.useState<PatientHit | null>(null);
  const [newPatient, setNewPatient] = React.useState(false);
  const [newPatientForm, setNewPatientForm] = React.useState<NewPatientForm>(
    EMPTY.newPatientForm,
  );
  const [doctorId, setDoctorId] = React.useState<string | null>(null);
  const [ticket, setTicket] = React.useState<WalkinTicket | null>(null);

  const reset = React.useCallback(() => {
    setPatient(null);
    setNewPatient(false);
    setNewPatientForm(EMPTY.newPatientForm);
    setDoctorId(initialDoctorId ?? null);
    setTicket(null);
  }, [initialDoctorId]);

  React.useEffect(() => {
    if (open) {
      setDoctorId(initialDoctorId ?? null);
      setTicket(null);
    }
  }, [open, initialDoctorId]);

  const doctorsQuery = useActiveDoctors();

  const issueMutation = useMutation<WalkinTicket, Error, void>({
    mutationFn: async () => {
      if (!doctorId) throw new Error("DOCTOR_REQUIRED");

      let body: Record<string, unknown>;
      if (patient && !newPatient) {
        body = { doctorId, patientId: patient.id };
      } else if (newPatient) {
        const fullName = newPatientForm.fullName.trim();
        const phone = newPatientForm.phone.trim();
        if (!fullName) throw new Error("PATIENT_NAME_REQUIRED");
        if (!phone) throw new Error("PATIENT_PHONE_REQUIRED");
        body = { doctorId, newPatient: { fullName, phone } };
      } else {
        throw new Error("PATIENT_REQUIRED");
      }

      const res = await fetch(`/api/crm/appointments/walkin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as WalkinTicket;
    },
    onSuccess: (issued) => {
      setTicket(issued);
      const opts = { refetchType: "active" } as const;
      qc.invalidateQueries({ queryKey: ["appointments", "list"], ...opts });
      qc.invalidateQueries({ queryKey: ["reception"], ...opts });
      qc.invalidateQueries({ queryKey: ["crm", "shell-summary"], ...opts });
      qc.invalidateQueries({ queryKey: ["calendar", "appointments"], ...opts });
      toast.success(t("toastIssued", { number: issued.ticketNumber }));
      onIssued?.(issued);
    },
    onError: (err) => {
      if (err.message === "DOCTOR_REQUIRED") toast.error(t("errDoctor"));
      else if (
        err.message === "PATIENT_REQUIRED" ||
        err.message === "PATIENT_NAME_REQUIRED" ||
        err.message === "PATIENT_PHONE_REQUIRED"
      )
        toast.error(t("errPatient"));
      else toast.error(err.message);
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    issueMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {ticket ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("result.title")}</DialogTitle>
            </DialogHeader>

            <div className="rounded-2xl border border-success/30 bg-success/5 px-6 py-7 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t("result.number")}
              </p>
              <p className="mt-1 font-mono text-6xl font-bold tracking-wider text-success">
                {ticket.ticketNumber}
              </p>
              <p className="mt-3 text-sm font-medium text-foreground">
                {ticket.patient.fullName}
              </p>
              <p className="mt-0.5 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                <span>{ticket.doctor.nameRu}</span>
                {ticket.cabinet ? (
                  <>
                    <span aria-hidden>·</span>
                    <MapPinIcon className="size-3.5" />
                    <span>{t("result.cabinet", { number: ticket.cabinet })}</span>
                  </>
                ) : null}
              </p>
            </div>

            <DialogFooter className="mt-1 flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() =>
                  window.open(`/ticket/${ticket.appointmentId}`, "_blank")
                }
              >
                <PrinterIcon className="size-4" />
                {t("result.print")}
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={reset}>
                  <PlusIcon className="size-4" />
                  {t("result.another")}
                </Button>
                <Button type="button" onClick={() => onOpenChange(false)}>
                  {t("result.close")}
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <PatientPicker
                value={patient}
                newPatient={newPatient}
                newPatientForm={newPatientForm}
                onChangePatient={(p) => {
                  setPatient(p);
                  setNewPatient(false);
                }}
                onToggleNew={(on) => {
                  setNewPatient(on);
                  if (on) setPatient(null);
                }}
                onChangeNewPatient={setNewPatientForm}
              />

              <DoctorPicker
                doctors={doctorsQuery.data ?? []}
                value={doctorId}
                onChange={setDoctorId}
              />
            </div>

            <DialogFooter className="mt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={issueMutation.isPending}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={issueMutation.isPending}>
                {issueMutation.isPending ? t("issuing") : t("submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default WalkinTicketDialog;
