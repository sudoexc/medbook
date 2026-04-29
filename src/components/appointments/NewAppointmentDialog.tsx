"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { SlotPicker } from "./SlotPicker";
import { DoctorPicker } from "./new-appointment-dialog/doctor-picker";
import { PatientPicker } from "./new-appointment-dialog/patient-picker";
import { ServicesPicker } from "./new-appointment-dialog/services-picker";
import {
  CHANNELS,
  EMPTY,
  type CabinetHit,
  type ChannelType,
  type DoctorHit,
  type FormState,
  type PatientHit,
  type ServiceHit,
} from "./new-appointment-dialog/types";

export interface NewAppointmentDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Pre-fill patient when opened from a patient card. */
  patientId?: string | null;
  /**
   * Pre-fill via phone number (used by call-center / reception widgets).
   *
   * Behaviour when `patientId` is not provided but `initialPatientPhone` is:
   *   1. Search `/api/crm/patients?q=<phone>` for a match.
   *   2. If a single match is found, auto-select it.
   *   3. Otherwise switch to "create new" mode with the phone prefilled.
   */
  initialPatientPhone?: string | null;
  /** Pre-fill doctor + time when opened from a slot click. */
  initialDoctorId?: string | null;
  initialDate?: Date | null;
  initialTime?: string | null;
  /** Called after successful creation with the new appointment id. */
  onCreated?: (appointmentId: string) => void;
}

/**
 * Universal NewAppointmentDialog — single source of truth for creating an
 * appointment. Used from the /crm/appointments page, reception, calendar,
 * patient card and inbox.
 *
 * Flow per TZ §7.8:
 *  1. Patient — autocomplete OR inline «create new» form.
 *  2. Services — multi-select; price + duration visible.
 *  3. Doctor — options narrowed to those offering any of the selected
 *     services (via `serviceOnDoctor` include on the list endpoint).
 *  4. Slot — `<SlotPicker>` calls `/api/crm/appointments/slots/available`.
 *  5. Channel + cabinet + notes → submit. 409 conflicts render inline.
 */
export function NewAppointmentDialog({
  open,
  onOpenChange,
  patientId,
  initialPatientPhone,
  initialDoctorId,
  initialDate,
  initialTime,
  onCreated,
}: NewAppointmentDialogProps) {
  const t = useTranslations("appointments.newDialog");
  const tChannel = useTranslations("appointments.channel");
  const tConflict = useTranslations("appointments.newDialog.conflict");
  const qc = useQueryClient();

  const [state, setState] = React.useState<FormState>(EMPTY);
  const [conflict, setConflict] = React.useState<{
    reason:
      | "doctor_busy"
      | "cabinet_busy"
      | "doctor_time_off"
      | "outside_schedule";
    until?: string;
  } | null>(null);
  // Tracks which doctor we've already auto-applied (services filter +
  // default cabinet) for, so we don't re-run on every render. Reset whenever
  // the dialog opens.
  const lastDoctorRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setConflict(null);
    lastDoctorRef.current = null;
    setState((prev) => ({
      ...EMPTY,
      ...prev,
      patient: null,
      newPatient: false,
      serviceIds: [],
      doctorId: initialDoctorId ?? null,
      cabinetId: null,
      date: initialDate ?? new Date(),
      time: initialTime ?? null,
      channel: "WALKIN",
      comments: "",
    }));
  }, [open, initialDoctorId, initialDate, initialTime]);

  const preloadPatient = useQuery<PatientHit | null, Error>({
    queryKey: ["patient-preload", patientId],
    enabled: Boolean(open && patientId),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/patients/${patientId}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) return null;
      const j = (await res.json()) as PatientHit;
      return j;
    },
  });

  React.useEffect(() => {
    if (preloadPatient.data && open) {
      setState((s) => ({ ...s, patient: preloadPatient.data }));
    }
  }, [preloadPatient.data, open]);

  // Phone-based prefill: used by call-center/reception when we know the
  // caller's number but haven't linked them to a Patient yet. We search by
  // phone; if we hit exactly one match, auto-select. Otherwise flip the
  // dialog into "create new patient" mode with the phone prefilled.
  const phoneLookup = useQuery<PatientHit[], Error>({
    queryKey: ["patient-preload-phone", initialPatientPhone],
    enabled: Boolean(
      open && initialPatientPhone && !patientId,
    ),
    queryFn: async ({ signal }) => {
      if (!initialPatientPhone) return [];
      const sp = new URLSearchParams({ q: initialPatientPhone, limit: "5" });
      const res = await fetch(`/api/crm/patients?${sp.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) return [];
      const j = (await res.json()) as { rows: PatientHit[] };
      return j.rows;
    },
    staleTime: 30_000,
  });

  // Apply the phone lookup result once per open: we only auto-fill if the
  // operator hasn't already picked a patient manually.
  const phoneAppliedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open) {
      phoneAppliedRef.current = null;
      return;
    }
    if (!initialPatientPhone || patientId) return;
    if (phoneAppliedRef.current === initialPatientPhone) return;
    if (phoneLookup.isLoading || !phoneLookup.data) return;

    phoneAppliedRef.current = initialPatientPhone;
    const hits = phoneLookup.data;
    setState((s) => {
      if (s.patient) return s;
      if (hits.length === 1) {
        return { ...s, patient: hits[0]!, newPatient: false };
      }
      return {
        ...s,
        newPatient: true,
        patient: null,
        newPatientForm: {
          ...s.newPatientForm,
          phone: s.newPatientForm.phone || initialPatientPhone,
        },
      };
    });
  }, [
    open,
    initialPatientPhone,
    patientId,
    phoneLookup.isLoading,
    phoneLookup.data,
  ]);

  const doctorsQuery = useQuery<DoctorHit[], Error>({
    queryKey: ["doctors", "dialog"],
    enabled: open,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/doctors?isActive=true&limit=200`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: DoctorHit[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });

  const servicesQuery = useQuery<ServiceHit[], Error>({
    queryKey: ["services", "dialog"],
    enabled: open,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/services?isActive=true&limit=200`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: ServiceHit[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });

  const cabinetsQuery = useQuery<CabinetHit[], Error>({
    queryKey: ["cabinets", "dialog"],
    enabled: open,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/cabinets?isActive=true&limit=200`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: CabinetHit[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });

  // When the user picks a doctor we look up that doctor's services + schedule
  // — services drive what's offered in the picker below, and the most-frequent
  // cabinetId across the doctor's active weekly schedule becomes the default
  // cabinet (each doctor is "anchored" to one room).
  type DoctorDetail = {
    id: string;
    services: { serviceId: string }[];
    schedules: { cabinetId: string | null; isActive: boolean }[];
  };
  const doctorDetailQuery = useQuery<DoctorDetail | null, Error>({
    queryKey: ["doctor", "detail", state.doctorId],
    enabled: open && !!state.doctorId,
    queryFn: async ({ signal }) => {
      if (!state.doctorId) return null;
      const res = await fetch(`/api/crm/doctors/${state.doctorId}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as DoctorDetail;
    },
    staleTime: 60_000,
  });

  const allowedServiceIds = React.useMemo(() => {
    const d = doctorDetailQuery.data;
    if (!d) return null;
    return new Set(d.services.map((s) => s.serviceId));
  }, [doctorDetailQuery.data]);

  const filteredServices = React.useMemo(() => {
    const all = servicesQuery.data ?? [];
    if (!allowedServiceIds) return [];
    return all.filter((s) => allowedServiceIds.has(s.id));
  }, [servicesQuery.data, allowedServiceIds]);

  // Auto-fill cabinet from doctor's schedule (most common cabinetId across
  // active entries). Drop selected services that the new doctor doesn't
  // offer. Runs once per doctor change.
  React.useEffect(() => {
    const detail = doctorDetailQuery.data;
    if (!detail) return;
    if (lastDoctorRef.current === detail.id) return;
    lastDoctorRef.current = detail.id;

    const counts = new Map<string, number>();
    for (const sch of detail.schedules) {
      if (!sch.isActive || !sch.cabinetId) continue;
      counts.set(sch.cabinetId, (counts.get(sch.cabinetId) ?? 0) + 1);
    }
    let topCabinetId: string | null = null;
    let topCount = 0;
    for (const [id, n] of counts) {
      if (n > topCount) {
        topCabinetId = id;
        topCount = n;
      }
    }
    const allowed = new Set(detail.services.map((s) => s.serviceId));
    setState((s) => ({
      ...s,
      // Always reflect the new doctor's anchor cabinet — null wipes any
      // stale cabinet from a previously-selected doctor.
      cabinetId: topCabinetId,
      serviceIds: s.serviceIds.filter((id) => allowed.has(id)),
    }));
  }, [doctorDetailQuery.data]);

  const createMutation = useMutation<
    { id: string },
    Error,
    FormState,
    unknown
  >({
    mutationFn: async (values) => {
      let resolvedPatientId: string | null = values.patient?.id ?? null;
      if (values.newPatient) {
        if (!values.newPatientForm.fullName.trim()) {
          throw new Error("PATIENT_NAME_REQUIRED");
        }
        if (!values.newPatientForm.phone.trim()) {
          throw new Error("PATIENT_PHONE_REQUIRED");
        }
        const patientRes = await fetch(`/api/crm/patients`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: values.newPatientForm.fullName.trim(),
            phone: values.newPatientForm.phone.trim(),
            gender: values.newPatientForm.gender || undefined,
            source: values.newPatientForm.source || undefined,
          }),
        });
        if (!patientRes.ok) {
          const j = (await patientRes.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(j?.error ?? `HTTP ${patientRes.status}`);
        }
        const p = (await patientRes.json()) as { id: string };
        resolvedPatientId = p.id;
      }
      if (!resolvedPatientId) throw new Error("PATIENT_REQUIRED");
      if (!values.doctorId) throw new Error("DOCTOR_REQUIRED");
      if (!values.time) throw new Error("TIME_REQUIRED");

      const totalDuration = Math.max(
        5,
        values.serviceIds.reduce((acc, sid) => {
          const svc = (servicesQuery.data ?? []).find((x) => x.id === sid);
          return acc + (svc?.durationMin ?? 0);
        }, 0) || 30,
      );

      const body = {
        patientId: resolvedPatientId,
        doctorId: values.doctorId,
        cabinetId: values.cabinetId ?? undefined,
        services: values.serviceIds.map((sid) => ({
          serviceId: sid,
          quantity: 1,
        })),
        serviceId: values.serviceIds[0] ?? undefined,
        date: values.date.toISOString(),
        time: values.time,
        durationMin: totalDuration,
        channel: values.channel,
        comments: values.comments || undefined,
      };

      const res = await fetch(`/api/crm/appointments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          reason?: string;
          until?: string;
        } | null;
        const reason =
          (j?.reason as
            | "doctor_busy"
            | "cabinet_busy"
            | "doctor_time_off"
            | "outside_schedule") ?? "doctor_busy";
        setConflict({ reason, until: j?.until });
        throw new Error(`conflict:${reason}`);
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: (created) => {
      const opts = { refetchType: "active" } as const;
      qc.invalidateQueries({ queryKey: ["appointments", "list"], ...opts });
      qc.invalidateQueries({ queryKey: ["calendar", "appointments"], ...opts });
      qc.invalidateQueries({ queryKey: ["reception"], ...opts });
      qc.invalidateQueries({ queryKey: ["crm", "shell-summary"], ...opts });
      toast.success(t("createdToast"));
      onOpenChange(false);
      setState(EMPTY);
      if (onCreated) onCreated(created.id);
    },
    onError: (err) => {
      if (err.message.startsWith("conflict:")) return;
      if (err.message === "PATIENT_REQUIRED") toast.error(t("err.patient"));
      else if (err.message === "DOCTOR_REQUIRED") toast.error(t("err.doctor"));
      else if (err.message === "TIME_REQUIRED") toast.error(t("err.time"));
      else if (err.message === "PATIENT_NAME_REQUIRED")
        toast.error(t("err.patientName"));
      else if (err.message === "PATIENT_PHONE_REQUIRED")
        toast.error(t("err.patientPhone"));
      else toast.error(err.message);
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setConflict(null);
    createMutation.mutate(state);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <PatientPicker
            value={state.patient}
            newPatient={state.newPatient}
            newPatientForm={state.newPatientForm}
            onChangePatient={(p) =>
              setState((s) => ({ ...s, patient: p, newPatient: false }))
            }
            onToggleNew={(on) =>
              setState((s) => ({
                ...s,
                newPatient: on,
                patient: on ? null : s.patient,
              }))
            }
            onChangeNewPatient={(next) =>
              setState((s) => ({ ...s, newPatientForm: next }))
            }
            disabled={Boolean(patientId)}
          />

          <DoctorPicker
            doctors={doctorsQuery.data ?? []}
            value={state.doctorId}
            onChange={(id) =>
              setState((s) => ({
                ...s,
                doctorId: id,
                time: null,
                // Cabinet + services are reapplied by the effect above once
                // the doctor's detail loads; clear stale values until then.
                cabinetId: id ? s.cabinetId : null,
                serviceIds: id ? s.serviceIds : [],
              }))
            }
          />

          <ServicesPicker
            services={filteredServices}
            value={state.serviceIds}
            doctorPicked={Boolean(state.doctorId)}
            onChange={(ids) =>
              setState((s) => ({ ...s, serviceIds: ids }))
            }
          />

          <SlotPicker
            doctorId={state.doctorId}
            date={state.date}
            serviceIds={state.serviceIds}
            value={state.time}
            onChange={(n) =>
              setState((s) => ({ ...s, date: n.date, time: n.time }))
            }
            onDateChange={(d) =>
              setState((s) => ({ ...s, date: d, time: null }))
            }
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label>{t("channel")}</Label>
              <Select
                value={state.channel}
                onValueChange={(v) =>
                  setState((s) => ({ ...s, channel: v as ChannelType }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {tChannel(c.toLowerCase() as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>{t("cabinet")}</Label>
              <Select
                value={state.cabinetId ?? "__none"}
                onValueChange={(v) =>
                  setState((s) => ({
                    ...s,
                    cabinetId: v === "__none" ? null : v,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("cabinetPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t("cabinetNone")}</SelectItem>
                  {(cabinetsQuery.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      №{c.number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1">
            <Label>{t("notes")}</Label>
            <Textarea
              value={state.comments}
              onChange={(e) =>
                setState((s) => ({ ...s, comments: e.target.value }))
              }
              rows={2}
              placeholder={t("notesPlaceholder")}
            />
          </div>

          {conflict ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {(
                tConflict as unknown as (
                  k: string,
                  v?: Record<string, string>,
                ) => string
              )(conflict.reason, {
                until: conflict.until ?? "",
              })}
            </div>
          ) : null}

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? t("saving") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default NewAppointmentDialog;
