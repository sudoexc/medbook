"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

const CHANNELS = [
  "WALKIN",
  "PHONE",
  "TELEGRAM",
  "WEBSITE",
  "KIOSK",
] as const;

type ChannelType = (typeof CHANNELS)[number];

const SOURCES = [
  "WEBSITE",
  "TELEGRAM",
  "INSTAGRAM",
  "CALL",
  "WALKIN",
  "REFERRAL",
  "ADS",
  "OTHER",
] as const;

type PatientHit = {
  id: string;
  fullName: string;
  phone: string;
  phoneNormalized: string;
  photoUrl: string | null;
  segment: string;
};

type ServiceHit = {
  id: string;
  nameRu: string;
  nameUz: string;
  priceBase: number;
  durationMin: number;
  category: string | null;
};

type DoctorHit = {
  id: string;
  nameRu: string;
  nameUz: string;
  photoUrl: string | null;
  color: string | null;
  isActive: boolean;
};

type CabinetHit = {
  id: string;
  number: string;
};

export interface NewAppointmentDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Pre-fill patient when opened from a patient card. */
  patientId?: string | null;
  /** Pre-fill doctor + time when opened from a slot click. */
  initialDoctorId?: string | null;
  initialDate?: Date | null;
  initialTime?: string | null;
  /** Called after successful creation with the new appointment id. */
  onCreated?: (appointmentId: string) => void;
}

type FormState = {
  patient: PatientHit | null;
  newPatient: boolean;
  newPatientForm: {
    fullName: string;
    phone: string;
    gender: "MALE" | "FEMALE" | "";
    source: (typeof SOURCES)[number] | "";
  };
  serviceIds: string[];
  doctorId: string | null;
  cabinetId: string | null;
  date: Date;
  time: string | null;
  channel: ChannelType;
  comments: string;
};

const EMPTY: FormState = {
  patient: null,
  newPatient: false,
  newPatientForm: {
    fullName: "",
    phone: "",
    gender: "",
    source: "",
  },
  serviceIds: [],
  doctorId: null,
  cabinetId: null,
  date: new Date(),
  time: null,
  channel: "WALKIN",
  comments: "",
};

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

  // Reset / prefill on open.
  React.useEffect(() => {
    if (!open) return;
    setConflict(null);
    setState((prev) => ({
      ...EMPTY,
      ...prev,
      patient: null,
      newPatient: false,
      serviceIds: [],
      doctorId: initialDoctorId ?? null,
      date: initialDate ?? new Date(),
      time: initialTime ?? null,
      channel: "WALKIN",
      comments: "",
    }));
  }, [open, initialDoctorId, initialDate, initialTime]);

  // Resolve `patientId` prop (e.g. from patient card) into a Patient hit.
  const preloadPatient = useQuery<PatientHit | null, Error>({
    queryKey: ["patient-preload", patientId],
    enabled: Boolean(open && patientId),
    queryFn: async () => {
      const res = await fetch(`/api/crm/patients/${patientId}`, {
        credentials: "include",
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

  const createMutation = useMutation<
    { id: string },
    Error,
    FormState,
    unknown
  >({
    mutationFn: async (values) => {
      // Resolve patient: create new if requested.
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
      qc.invalidateQueries({ queryKey: ["appointments", "list"] });
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

  const doctorsQuery = useQuery<DoctorHit[], Error>({
    queryKey: ["doctors", "dialog"],
    enabled: open,
    queryFn: async () => {
      const res = await fetch(`/api/crm/doctors?isActive=true&limit=200`, {
        credentials: "include",
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
    queryFn: async () => {
      const res = await fetch(`/api/crm/services?isActive=true&limit=200`, {
        credentials: "include",
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
    queryFn: async () => {
      const res = await fetch(`/api/crm/cabinets?isActive=true&limit=200`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: CabinetHit[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
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

          <ServicesPicker
            services={servicesQuery.data ?? []}
            value={state.serviceIds}
            onChange={(ids) =>
              setState((s) => ({ ...s, serviceIds: ids }))
            }
          />

          <DoctorPicker
            doctors={doctorsQuery.data ?? []}
            value={state.doctorId}
            onChange={(id) =>
              setState((s) => ({ ...s, doctorId: id, time: null }))
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

// -----------------------------------------------------------------------------
// PatientPicker
// -----------------------------------------------------------------------------

function PatientPicker({
  value,
  newPatient,
  newPatientForm,
  onChangePatient,
  onToggleNew,
  onChangeNewPatient,
  disabled,
}: {
  value: PatientHit | null;
  newPatient: boolean;
  newPatientForm: FormState["newPatientForm"];
  onChangePatient: (p: PatientHit | null) => void;
  onToggleNew: (on: boolean) => void;
  onChangeNewPatient: (next: FormState["newPatientForm"]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("appointments.newDialog.patient");
  const tSource = useTranslations("patients.source");
  const tGender = useTranslations("patients.gender");

  const [search, setSearch] = React.useState("");
  const [searchDebounced, setSearchDebounced] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const id = window.setTimeout(() => setSearchDebounced(search), 250);
    return () => window.clearTimeout(id);
  }, [search]);

  const hits = useQuery<PatientHit[], Error>({
    queryKey: ["patient-autocomplete", searchDebounced],
    enabled: open && searchDebounced.length >= 2,
    queryFn: async () => {
      const qs = new URLSearchParams({ q: searchDebounced, limit: "10" });
      const res = await fetch(`/api/crm/patients?${qs.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: PatientHit[] };
      return j.rows;
    },
    staleTime: 30_000,
  });

  // Close dropdown on outside click.
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="grid gap-1.5">
      <Label>{t("label")}</Label>

      {value && !newPatient ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{value.fullName}</div>
            <div className="text-xs text-muted-foreground">{value.phone}</div>
          </div>
          {!disabled ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChangePatient(null)}
            >
              <XIcon className="size-4" />
            </Button>
          ) : null}
        </div>
      ) : newPatient ? (
        <NewPatientInline
          values={newPatientForm}
          onChange={onChangeNewPatient}
          onCancel={() => onToggleNew(false)}
          tSource={tSource}
          tGender={tGender}
        />
      ) : (
        <div ref={containerRef} className="relative">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder={t("searchPlaceholder")}
              className="pl-8"
              disabled={disabled}
            />
          </div>

          {open && searchDebounced.length >= 2 ? (
            <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
              {hits.isLoading ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {t("loading")}
                </div>
              ) : (hits.data ?? []).length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {t("noMatches")}
                </div>
              ) : (
                <ul>
                  {(hits.data ?? []).map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChangePatient(p);
                          setOpen(false);
                          setSearch("");
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {p.fullName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {p.phone}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => {
                  onToggleNew(true);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-primary hover:bg-primary/5"
              >
                <PlusIcon className="size-4" />
                {t("createNew")}
              </button>
            </div>
          ) : null}

          {!disabled ? (
            <button
              type="button"
              onClick={() => onToggleNew(true)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <PlusIcon className="size-3.5" />
              {t("createNewShort")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function NewPatientInline({
  values,
  onChange,
  onCancel,
  tSource,
  tGender,
}: {
  values: FormState["newPatientForm"];
  onChange: (next: FormState["newPatientForm"]) => void;
  onCancel: () => void;
  tSource: ReturnType<typeof useTranslations>;
  tGender: ReturnType<typeof useTranslations>;
}) {
  const t = useTranslations("appointments.newDialog.newPatient");
  return (
    <div className="grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">
          {t("title")}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          aria-label={t("cancel")}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label>{t("fullName")}</Label>
          <Input
            value={values.fullName}
            onChange={(e) =>
              onChange({ ...values, fullName: e.target.value })
            }
            placeholder={t("fullNamePlaceholder")}
          />
        </div>
        <div className="grid gap-1">
          <Label>{t("phone")}</Label>
          <Input
            type="tel"
            value={values.phone}
            onChange={(e) => onChange({ ...values, phone: e.target.value })}
            placeholder="+998 90 123 45 67"
          />
        </div>
        <div className="grid gap-1">
          <Label>{t("gender")}</Label>
          <Select
            value={values.gender || ""}
            onValueChange={(v) =>
              onChange({
                ...values,
                gender: (v as "MALE" | "FEMALE") || "",
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("genderPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MALE">{tGender("male")}</SelectItem>
              <SelectItem value="FEMALE">{tGender("female")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>{t("source")}</Label>
          <Select
            value={values.source || ""}
            onValueChange={(v) =>
              onChange({
                ...values,
                source: (v as (typeof SOURCES)[number]) || "",
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("sourcePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {tSource(s.toLowerCase() as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// ServicesPicker — multi-select with inline list + add button.
// -----------------------------------------------------------------------------

function ServicesPicker({
  services,
  value,
  onChange,
}: {
  services: ServiceHit[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("appointments.newDialog");
  const [pick, setPick] = React.useState<string>("");

  const selected = services.filter((s) => value.includes(s.id));
  const available = services.filter((s) => !value.includes(s.id));

  const totalDuration = selected.reduce((acc, s) => acc + s.durationMin, 0);
  const totalPrice = selected.reduce((acc, s) => acc + s.priceBase, 0);

  return (
    <div className="grid gap-1.5">
      <Label>{t("services")}</Label>
      <div className="rounded-md border border-border bg-background">
        {selected.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {t("servicesEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {selected.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 px-3 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{s.nameRu}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.durationMin} {t("minutes")} · {formatSum(s.priceBase)}
                  </div>
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => onChange(value.filter((id) => id !== s.id))}
                  aria-label={t("serviceRemove")}
                >
                  <XIcon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-1 border-t border-border p-2">
          <Select
            value={pick}
            onValueChange={(v) => {
              if (v) {
                onChange([...value, v]);
                setPick("");
              }
            }}
          >
            <SelectTrigger className="h-8 flex-1">
              <SelectValue placeholder={t("serviceAddPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {available.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {t("serviceAllPicked")}
                </div>
              ) : (
                available.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nameRu} · {s.durationMin} {t("minutes")} ·{" "}
                    {formatSum(s.priceBase)}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selected.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("total", {
            duration: totalDuration,
            price: formatSum(totalPrice),
          })}
        </p>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// DoctorPicker
// -----------------------------------------------------------------------------

function DoctorPicker({
  doctors,
  value,
  onChange,
}: {
  doctors: DoctorHit[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const t = useTranslations("appointments.newDialog");
  return (
    <div className="grid gap-1">
      <Label>{t("doctor")}</Label>
      <Select
        value={value ?? ""}
        onValueChange={(v) => onChange(v || null)}
      >
        <SelectTrigger>
          <SelectValue placeholder={t("doctorPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {doctors.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              <span className="flex items-center gap-2">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: d.color ?? "#3DD5C0" }}
                />
                {d.nameRu}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground">
        {t("doctorHint")}
        {/* TODO(api): filter server-side by `services:{some:{serviceId:{in:...}}}` — tracked in report. */}
      </p>
    </div>
  );
}

function formatSum(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "0 сум";
  const whole = Math.trunc(amount / 100);
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped} сум`;
}

