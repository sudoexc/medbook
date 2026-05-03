"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { slugify } from "@/lib/slugify";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  CABINETS_WITH_OCCUPANTS_KEY,
  CabinetSelectField,
} from "./cabinet-select-field";

const COLOR_SWATCHES = [
  "#3DD5C0", // primary teal
  "#3B82F6", // info blue
  "#F59E0B", // warning amber
  "#10B981", // success green
  "#EF4444", // destructive red
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#64748B", // slate
] as const;

const DURATION_MIN = 5;
const DURATION_MAX = 480;

type ServiceRow = {
  id: string;
  code: string;
  nameRu: string;
  nameUz: string;
  durationMin: number;
  priceBase: number;
  isActive: boolean;
};

type ServiceState = {
  selected: boolean;
  priceInput: string;
  durationInput: string;
};

type FieldErrors = {
  nameRu?: string;
  nameUz?: string;
  specRu?: string;
  specUz?: string;
  slug?: string;
  cabinetId?: string;
  generic?: string;
};

const fmtUzs = (n: number, locale: string): string =>
  new Intl.NumberFormat(locale === "uz" ? "uz-UZ" : "ru-RU").format(n);

export interface NewDoctorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (doctorId: string) => void;
}

/**
 * Single dialog covering the whole doctor-create flow:
 *   1. Personal info (names + specialization + slug + colour).
 *   2. Required cabinet binding (re-uses CabinetSelectField — never lets
 *      you submit while pointing at an occupied cabinet).
 *   3. Pricing defaults (per-visit price + salary %).
 *   4. Optional service catalog with per-service price/duration overrides
 *      (if the catalog is empty the section is hidden — services can
 *      always be assigned later from the doctor profile).
 *   5. Collapsible "advanced" — bio + photo URL.
 *
 * The submit button stays disabled until the schema-required fields are
 * non-empty; server-side 409s are surfaced inline next to the offending
 * field (cabinet / slug) and the cabinets list auto-refreshes after a race.
 */
export function NewDoctorDialog({
  open,
  onOpenChange,
  onCreated,
}: NewDoctorDialogProps) {
  const t = useTranslations("crmDoctors.newDialog");
  const tProfile = useTranslations("crmDoctors.profile");
  const tServices = useTranslations("crmDoctors.services");
  const locale = useLocale();
  const qc = useQueryClient();

  const [nameRu, setNameRu] = React.useState("");
  const [nameUz, setNameUz] = React.useState("");
  const [specRu, setSpecRu] = React.useState("");
  const [specUz, setSpecUz] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [color, setColor] = React.useState<string>(COLOR_SWATCHES[0]);
  const [cabinetId, setCabinetId] = React.useState("");
  const [pricePerVisit, setPricePerVisit] = React.useState("");
  const [salaryPercent, setSalaryPercent] = React.useState("40");
  const [services, setServices] = React.useState<Record<string, ServiceState>>({});
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [bioRu, setBioRu] = React.useState("");
  const [bioUz, setBioUz] = React.useState("");
  const [photoUrl, setPhotoUrl] = React.useState("");
  const [errors, setErrors] = React.useState<FieldErrors>({});

  // Reset everything when the dialog closes so re-opening is fresh.
  React.useEffect(() => {
    if (open) return;
    setNameRu("");
    setNameUz("");
    setSpecRu("");
    setSpecUz("");
    setSlug("");
    setSlugTouched(false);
    setColor(COLOR_SWATCHES[0]);
    setCabinetId("");
    setPricePerVisit("");
    setSalaryPercent("40");
    setServices({});
    setAdvancedOpen(false);
    setBioRu("");
    setBioUz("");
    setPhotoUrl("");
    setErrors({});
  }, [open]);

  // Auto-derive slug from nameRu while the user hasn't manually edited it.
  React.useEffect(() => {
    if (!slugTouched) setSlug(slugify(nameRu));
  }, [nameRu, slugTouched]);

  const servicesQuery = useQuery<ServiceRow[], Error>({
    queryKey: ["services-all"] as const,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/services?isActive=true&limit=200`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: ServiceRow[] };
      return j.rows;
    },
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const toggleService = (id: string, on: boolean) => {
    setServices((prev) => ({
      ...prev,
      [id]: {
        selected: on,
        priceInput: prev[id]?.priceInput ?? "",
        durationInput: prev[id]?.durationInput ?? "",
      },
    }));
  };

  const setServicePrice = (id: string, value: string) => {
    setServices((prev) => ({
      ...prev,
      [id]: {
        selected: prev[id]?.selected ?? false,
        priceInput: value.replace(/[^0-9]/g, ""),
        durationInput: prev[id]?.durationInput ?? "",
      },
    }));
  };

  const setServiceDuration = (id: string, value: string) => {
    setServices((prev) => ({
      ...prev,
      [id]: {
        selected: prev[id]?.selected ?? false,
        priceInput: prev[id]?.priceInput ?? "",
        durationInput: value.replace(/[^0-9]/g, ""),
      },
    }));
  };

  const requiredFilled =
    nameRu.trim().length > 0 &&
    nameUz.trim().length > 0 &&
    specRu.trim().length > 0 &&
    specUz.trim().length > 0 &&
    slug.length >= 2 &&
    /^[a-z0-9-]+$/.test(slug) &&
    cabinetId.length > 0;

  type CreateBody = {
    slug: string;
    nameRu: string;
    nameUz: string;
    specializationRu: string;
    specializationUz: string;
    cabinetId: string;
    color?: string;
    pricePerVisit?: number | null;
    salaryPercent?: number;
    bioRu?: string | null;
    bioUz?: string | null;
    photoUrl?: string | null;
    services?: Array<{
      serviceId: string;
      priceOverride?: number | null;
      durationMinOverride?: number | null;
    }>;
  };

  const buildBody = (): CreateBody => {
    const serviceList = Object.entries(services)
      .filter(([, s]) => s.selected)
      .map(([serviceId, s]) => {
        const priceOverride = s.priceInput.trim()
          ? Math.max(0, Number.parseInt(s.priceInput, 10))
          : null;
        const dn = s.durationInput.trim()
          ? Number.parseInt(s.durationInput, 10)
          : NaN;
        const durationMinOverride =
          Number.isFinite(dn) && dn >= DURATION_MIN && dn <= DURATION_MAX
            ? dn
            : null;
        return { serviceId, priceOverride, durationMinOverride };
      });
    const ppv = pricePerVisit.trim()
      ? Math.max(0, Number.parseInt(pricePerVisit, 10))
      : null;
    const sp = Number.parseInt(salaryPercent, 10);
    return {
      slug,
      nameRu: nameRu.trim(),
      nameUz: nameUz.trim(),
      specializationRu: specRu.trim(),
      specializationUz: specUz.trim(),
      cabinetId,
      color,
      pricePerVisit: ppv,
      salaryPercent: Number.isFinite(sp) ? Math.min(100, Math.max(0, sp)) : 40,
      bioRu: bioRu.trim() ? bioRu.trim() : null,
      bioUz: bioUz.trim() ? bioUz.trim() : null,
      photoUrl: photoUrl.trim() ? photoUrl.trim() : null,
      services: serviceList.length > 0 ? serviceList : undefined,
    };
  };

  const create = useMutation<{ id: string }, Error, CreateBody>({
    mutationFn: async (body) => {
      const res = await fetch("/api/crm/doctors", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          reason?: string;
        } | null;
        const code = j?.reason ?? j?.error ?? `HTTP_${res.status}`;
        throw Object.assign(new Error(code), { status: res.status, reason: j?.reason });
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: (created) => {
      toast.success(t("createdToast"));
      qc.invalidateQueries({ queryKey: ["doctors", "list"] });
      qc.invalidateQueries({ queryKey: CABINETS_WITH_OCCUPANTS_KEY });
      onOpenChange(false);
      if (onCreated) onCreated(created.id);
    },
    onError: (e: Error & { status?: number; reason?: string }) => {
      // Inline-friendly errors: surface the message under the field that caused
      // it instead of a generic toast. The cabinets list is refetched on the
      // race-loss case so the user sees the new occupant immediately.
      if (e.status === 409 && e.reason === "cabinet_taken") {
        setErrors((prev) => ({ ...prev, cabinetId: t("errCabinetTaken") }));
        qc.invalidateQueries({ queryKey: CABINETS_WITH_OCCUPANTS_KEY });
        return;
      }
      if (e.status === 422 && e.reason === "cabinet_not_found") {
        setErrors((prev) => ({ ...prev, cabinetId: t("errCabinetMissing") }));
        qc.invalidateQueries({ queryKey: CABINETS_WITH_OCCUPANTS_KEY });
        return;
      }
      if (e.status === 409 && e.reason === "slug_taken") {
        setErrors((prev) => ({ ...prev, slug: t("errSlugTaken") }));
        return;
      }
      toast.error(t("errGeneric"));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (!requiredFilled) return;
    create.mutate(buildBody());
  };

  // When user changes the cabinet selection clear any cabinet-related error.
  const onCabinetPick = (id: string) => {
    setCabinetId(id);
    setErrors((prev) => ({ ...prev, cabinetId: undefined }));
  };

  const onSlugChange = (next: string) => {
    setSlugTouched(true);
    // strip on input so the field stays in slug-shape as the user types.
    setSlug(slugify(next));
    setErrors((prev) => ({ ...prev, slug: undefined }));
  };

  const allServices = servicesQuery.data ?? [];
  const selectedCount = Object.values(services).filter((s) => s.selected).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-6">
          {/* === Personal === */}
          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("sectionPersonal")}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="nd-name-ru">{t("nameRu")}</Label>
                <Input
                  id="nd-name-ru"
                  value={nameRu}
                  onChange={(e) => setNameRu(e.target.value)}
                  placeholder={t("namePlaceholderRu")}
                  required
                  maxLength={200}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="nd-name-uz">{t("nameUz")}</Label>
                <Input
                  id="nd-name-uz"
                  value={nameUz}
                  onChange={(e) => setNameUz(e.target.value)}
                  placeholder={t("namePlaceholderUz")}
                  required
                  maxLength={200}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="nd-spec-ru">{t("specRu")}</Label>
                <Input
                  id="nd-spec-ru"
                  value={specRu}
                  onChange={(e) => setSpecRu(e.target.value)}
                  placeholder={t("specPlaceholderRu")}
                  required
                  maxLength={200}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="nd-spec-uz">{t("specUz")}</Label>
                <Input
                  id="nd-spec-uz"
                  value={specUz}
                  onChange={(e) => setSpecUz(e.target.value)}
                  placeholder={t("specPlaceholderUz")}
                  required
                  maxLength={200}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-1">
                <Label htmlFor="nd-slug">{t("slug")}</Label>
                <Input
                  id="nd-slug"
                  value={slug}
                  onChange={(e) => onSlugChange(e.target.value)}
                  aria-invalid={Boolean(errors.slug)}
                  placeholder="ivanov-petr"
                  required
                  maxLength={100}
                />
                <p
                  className={cn(
                    "text-xs",
                    errors.slug ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {errors.slug ?? t("slugHint")}
                </p>
              </div>
              <div className="grid gap-1">
                <Label>{t("color")}</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      aria-label={c}
                      className={cn(
                        "size-7 rounded-md border-2 transition-all",
                        color === c
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

          {/* === Cabinet === */}
          <section className="grid gap-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                {t("sectionCabinet")}
              </h3>
              <span className="text-xs text-muted-foreground">{t("cabinetHint")}</span>
            </div>
            {errors.cabinetId ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                {errors.cabinetId}
              </div>
            ) : null}
            <CabinetSelectField
              value={cabinetId}
              onChange={onCabinetPick}
              disabled={create.isPending}
              emptyAction={
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={`/${locale}/crm/settings/cabinets`} />}
                >
                  <PlusIcon className="size-4" />
                  {t("cabinetCreate")}
                </Button>
              }
            />
          </section>

          {/* === Pricing === */}
          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("sectionPricing")}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="nd-ppv">{t("pricePerVisit")}</Label>
                <Input
                  id="nd-ppv"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pricePerVisit}
                  onChange={(e) =>
                    setPricePerVisit(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder={t("pricePerVisitPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">{t("pricePerVisitHint")}</p>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="nd-salary">{t("salaryPercent")}</Label>
                <Input
                  id="nd-salary"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={salaryPercent}
                  onChange={(e) =>
                    setSalaryPercent(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder="40"
                />
                <p className="text-xs text-muted-foreground">{t("salaryPercentHint")}</p>
              </div>
            </div>
          </section>

          {/* === Services === */}
          {servicesQuery.isLoading ? (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t("sectionServices")}
              </h3>
              <div className="h-10 animate-pulse rounded-md bg-muted" />
              <div className="h-10 animate-pulse rounded-md bg-muted" />
            </section>
          ) : allServices.length === 0 ? (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t("sectionServices")}
              </h3>
              <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                {t("servicesEmpty")}
              </p>
            </section>
          ) : (
            <section className="grid gap-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  {t("sectionServices")}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {t("servicesSelected", { count: selectedCount, total: allServices.length })}
                </span>
              </div>
              <ul className="max-h-[40vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
                {allServices.map((s) => {
                  const row = services[s.id];
                  const checked = Boolean(row?.selected);
                  const priceInput = row?.priceInput ?? "";
                  const durationInput = row?.durationInput ?? "";
                  return (
                    <li
                      key={s.id}
                      className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2.5"
                    >
                      <Checkbox
                        id={`nd-svc-${s.id}`}
                        checked={checked}
                        disabled={create.isPending}
                        onCheckedChange={(v) => toggleService(s.id, v === true)}
                        aria-label={tServices("assign")}
                      />
                      <Label
                        htmlFor={`nd-svc-${s.id}`}
                        className="flex min-w-0 cursor-pointer flex-col gap-0.5 text-sm"
                      >
                        <span className="truncate font-medium text-foreground">
                          {locale === "uz" ? s.nameUz : s.nameRu}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {s.code} · {s.durationMin} {tServices("minShort")} ·{" "}
                          {tServices("basePrice")}: {fmtUzs(s.priceBase, locale)}{" "}
                          {tServices("currencySum")}
                        </span>
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={priceInput}
                          onChange={(e) => setServicePrice(s.id, e.target.value)}
                          placeholder={String(s.priceBase)}
                          disabled={!checked || create.isPending}
                          className="h-8 w-[110px]"
                          aria-label={tServices("priceOverride")}
                        />
                        <Input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={durationInput}
                          onChange={(e) => setServiceDuration(s.id, e.target.value)}
                          placeholder={String(s.durationMin)}
                          disabled={!checked || create.isPending}
                          className="h-8 w-[70px]"
                          aria-label={tServices("durationOverride")}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">{t("servicesHint")}</p>
            </section>
          )}

          {/* === Advanced (collapsible) === */}
          <section className="grid gap-2">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-fit items-center gap-1 text-sm font-semibold text-foreground hover:text-primary"
            >
              {advancedOpen ? (
                <ChevronDownIcon className="size-4" />
              ) : (
                <ChevronRightIcon className="size-4" />
              )}
              {t("sectionAdvanced")}
            </button>
            {advancedOpen ? (
              <div className="grid gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="nd-photo">{t("photoUrl")}</Label>
                  <Input
                    id="nd-photo"
                    type="url"
                    value={photoUrl}
                    onChange={(e) => setPhotoUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor="nd-bio-ru">{t("bioRu")}</Label>
                    <Textarea
                      id="nd-bio-ru"
                      value={bioRu}
                      onChange={(e) => setBioRu(e.target.value)}
                      maxLength={5000}
                      rows={3}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="nd-bio-uz">{t("bioUz")}</Label>
                    <Textarea
                      id="nd-bio-uz"
                      value={bioUz}
                      onChange={(e) => setBioUz(e.target.value)}
                      maxLength={5000}
                      rows={3}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <DialogFooter className="mt-2 flex-row items-center justify-between sm:justify-end">
            <p className="mr-auto text-xs text-muted-foreground sm:hidden">
              {tProfile("cabinetLabel")}: {cabinetId ? "✓" : "—"}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!requiredFilled || create.isPending}>
              {create.isPending ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
