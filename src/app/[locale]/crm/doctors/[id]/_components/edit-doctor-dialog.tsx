"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { slugify } from "@/lib/slugify";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { COLOR_SWATCHES } from "../../_components/doctor-colors";
import { doctorKey, type DoctorDetail } from "../_hooks/use-doctor";
import {
  buildDoctorPatch,
  formFromDoctor,
  type EditDoctorField,
  type EditDoctorForm,
  type EditDoctorPatch,
} from "./edit-doctor-form";

export interface EditDoctorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctor: DoctorDetail;
}

/** Server field name → form field, to point a 400 at the input it came from. */
const SERVER_FIELD: Record<string, EditDoctorField> = {
  nameRu: "nameRu",
  nameUz: "nameUz",
  specializationRu: "specRu",
  specializationUz: "specUz",
  slug: "slug",
  color: "color",
  pricePerVisit: "pricePerVisit",
  salaryPercent: "salaryPercent",
  photoUrl: "photoUrl",
  bioRu: "bioRu",
  bioUz: "bioUz",
};

class FieldError extends Error {
  constructor(public readonly field: EditDoctorField) {
    super(field);
  }
}

/**
 * «Редактировать» on the doctor profile (audit DR-04): the profile columns
 * an admin set at creation and could never change afterwards. The cabinet,
 * services, ticket letter and login stay in their own editors. Labels reuse
 * the create dialog's, so both forms read the same.
 */
export function EditDoctorDialog({
  open,
  onOpenChange,
  doctor,
}: EditDoctorDialogProps) {
  const t = useTranslations("crmDoctors.newDialog");
  const tp = useTranslations("crmDoctors.profile");
  const tc = useTranslations("common");
  const qc = useQueryClient();

  const [form, setForm] = React.useState<EditDoctorForm>(() =>
    formFromDoctor(doctor),
  );
  const [errorField, setErrorField] = React.useState<EditDoctorField | null>(
    null,
  );
  const [slugTaken, setSlugTaken] = React.useState(false);

  // Fresh copy of the saved profile every time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setForm(formFromDoctor(doctor));
    setErrorField(null);
    setSlugTaken(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends EditDoctorField>(key: K, value: EditDoctorForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errorField === key) setErrorField(null);
    if (key === "slug") setSlugTaken(false);
  };

  const save = useMutation<unknown, Error, EditDoctorPatch>({
    mutationFn: async (patch) => {
      const res = await fetch(`/api/crm/doctors/${doctor.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          reason?: string;
          issues?: { path?: (string | number)[] }[];
        } | null;
        if (res.status === 409 && j?.reason === "slug_taken") {
          setSlugTaken(true);
          throw new FieldError("slug");
        }
        // Zod refusal: point at the field the server named.
        const serverField = j?.issues?.[0]?.path?.[0];
        if (res.status === 400 && typeof serverField === "string") {
          const field = SERVER_FIELD[serverField];
          if (field) throw new FieldError(field);
        }
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(tp("editSaved"));
      qc.invalidateQueries({ queryKey: doctorKey(doctor.id) });
      qc.invalidateQueries({ queryKey: ["doctors", "list"] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof FieldError) {
        setErrorField(e.field);
        return;
      }
      toast.error(tp("editFailed"));
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const built = buildDoctorPatch(doctor, form);
    if (!built.ok) {
      setErrorField(built.field);
      return;
    }
    if (Object.keys(built.patch).length === 0) {
      onOpenChange(false);
      return;
    }
    save.mutate(built.patch);
  };

  const invalid = (k: EditDoctorField) => errorField === k || undefined;
  const fieldError = (k: EditDoctorField) =>
    errorField === k ? (
      <p className="text-xs text-destructive">
        {k === "slug" && slugTaken ? t("errSlugTaken") : tp("editFieldInvalid")}
      </p>
    ) : null;

  // A colour picked outside the swatches (older doctors, imports) stays
  // selectable instead of being silently replaced.
  const swatches: string[] = (COLOR_SWATCHES as readonly string[]).includes(
    doctor.color,
  )
    ? [...COLOR_SWATCHES]
    : [doctor.color, ...COLOR_SWATCHES];

  const pending = save.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={onSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{tp("editDialogTitle")}</DialogTitle>
            <DialogDescription>{tp("editDialogHint")}</DialogDescription>
          </DialogHeader>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("sectionPersonal")}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="ed-name-ru">{t("nameRu")}</Label>
                <Input
                  id="ed-name-ru"
                  value={form.nameRu}
                  onChange={(e) => set("nameRu", e.target.value)}
                  aria-invalid={invalid("nameRu")}
                  maxLength={200}
                  disabled={pending}
                />
                {fieldError("nameRu")}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="ed-name-uz">{t("nameUz")}</Label>
                <Input
                  id="ed-name-uz"
                  value={form.nameUz}
                  onChange={(e) => set("nameUz", e.target.value)}
                  aria-invalid={invalid("nameUz")}
                  maxLength={200}
                  disabled={pending}
                />
                {fieldError("nameUz")}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="ed-spec-ru">{t("specRu")}</Label>
                <Input
                  id="ed-spec-ru"
                  value={form.specRu}
                  onChange={(e) => set("specRu", e.target.value)}
                  aria-invalid={invalid("specRu")}
                  maxLength={200}
                  disabled={pending}
                />
                {fieldError("specRu")}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="ed-spec-uz">{t("specUz")}</Label>
                <Input
                  id="ed-spec-uz"
                  value={form.specUz}
                  onChange={(e) => set("specUz", e.target.value)}
                  aria-invalid={invalid("specUz")}
                  maxLength={200}
                  disabled={pending}
                />
                {fieldError("specUz")}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-1">
                <Label htmlFor="ed-slug">{t("slug")}</Label>
                <Input
                  id="ed-slug"
                  value={form.slug}
                  onChange={(e) => set("slug", slugify(e.target.value))}
                  aria-invalid={invalid("slug")}
                  maxLength={100}
                  disabled={pending}
                />
                {fieldError("slug") ?? (
                  <p className="text-xs text-muted-foreground">
                    {tp("editSlugHint")}
                  </p>
                )}
              </div>
              <div className="grid gap-1">
                <Label>{t("color")}</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {swatches.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => set("color", c)}
                      aria-label={c}
                      aria-pressed={form.color === c}
                      disabled={pending}
                      className={cn(
                        "size-7 rounded-md border-2 transition-all",
                        form.color === c
                          ? "border-foreground ring-2 ring-foreground/20"
                          : "border-transparent hover:scale-110",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("sectionPricing")}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="ed-ppv">{t("pricePerVisit")}</Label>
                <Input
                  id="ed-ppv"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.pricePerVisit}
                  onChange={(e) =>
                    set("pricePerVisit", e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder={t("pricePerVisitPlaceholder")}
                  aria-invalid={invalid("pricePerVisit")}
                  disabled={pending}
                />
                {fieldError("pricePerVisit") ?? (
                  <p className="text-xs text-muted-foreground">
                    {t("pricePerVisitHint")}
                  </p>
                )}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="ed-salary">{t("salaryPercent")}</Label>
                <Input
                  id="ed-salary"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.salaryPercent}
                  onChange={(e) =>
                    set("salaryPercent", e.target.value.replace(/[^0-9]/g, ""))
                  }
                  aria-invalid={invalid("salaryPercent")}
                  disabled={pending}
                />
                {fieldError("salaryPercent") ?? (
                  <p className="text-xs text-muted-foreground">
                    {t("salaryPercentHint")}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("sectionAdvanced")}
            </h3>
            {/* Audit LD-08: what the public site shows, apart from isActive
                (a doctor who left keeps his history and cannot be deleted). */}
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="grid gap-0.5">
                <Label htmlFor="ed-listed">{tp("listedOnSite")}</Label>
                <p className="text-xs text-muted-foreground">
                  {tp("listedOnSiteHint")}
                </p>
              </div>
              <Switch
                id="ed-listed"
                checked={form.listedOnSite}
                onCheckedChange={(v) => set("listedOnSite", v)}
                disabled={pending}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ed-photo">{t("photoUrl")}</Label>
              <Input
                id="ed-photo"
                type="url"
                value={form.photoUrl}
                onChange={(e) => set("photoUrl", e.target.value)}
                placeholder="https://…"
                aria-invalid={invalid("photoUrl")}
                disabled={pending}
              />
              {fieldError("photoUrl")}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="ed-bio-ru">{t("bioRu")}</Label>
                <Textarea
                  id="ed-bio-ru"
                  value={form.bioRu}
                  onChange={(e) => set("bioRu", e.target.value)}
                  maxLength={5000}
                  rows={3}
                  aria-invalid={invalid("bioRu")}
                  disabled={pending}
                />
                {fieldError("bioRu")}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="ed-bio-uz">{t("bioUz")}</Label>
                <Textarea
                  id="ed-bio-uz"
                  value={form.bioUz}
                  onChange={(e) => set("bioUz", e.target.value)}
                  maxLength={5000}
                  rows={3}
                  aria-invalid={invalid("bioUz")}
                  disabled={pending}
                />
                {fieldError("bioUz")}
              </div>
            </div>
          </section>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
