"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2Icon, SaveIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

import {
  useDoctorProfile,
  usePatchDoctorProfile,
  type DoctorProfile,
  type ProfilePatch,
} from "../_hooks/use-doctor-profile";

/**
 * Compares editable form state to the server snapshot and returns only the
 * fields that actually changed. We treat empty strings as null for the
 * nullable bio/phone fields so clearing them PATCHes `null` rather than `""`.
 */
function diff(form: FormState, server: DoctorProfile): ProfilePatch {
  const out: ProfilePatch = {};
  if (form.name.trim() !== server.name) out.name = form.name.trim();

  const phoneNew = form.phone.trim() === "" ? null : form.phone.trim();
  if (phoneNew !== server.phone) out.phone = phoneNew;

  if (form.nameRu.trim() !== server.nameRu) out.nameRu = form.nameRu.trim();
  if (form.nameUz.trim() !== server.nameUz) out.nameUz = form.nameUz.trim();
  if (form.specializationRu.trim() !== server.specializationRu) {
    out.specializationRu = form.specializationRu.trim();
  }
  if (form.specializationUz.trim() !== server.specializationUz) {
    out.specializationUz = form.specializationUz.trim();
  }

  const bioRuNew = form.bioRu.trim() === "" ? null : form.bioRu.trim();
  if (bioRuNew !== server.bioRu) out.bioRu = bioRuNew;
  const bioUzNew = form.bioUz.trim() === "" ? null : form.bioUz.trim();
  if (bioUzNew !== server.bioUz) out.bioUz = bioUzNew;

  return out;
}

type FormState = {
  name: string;
  phone: string;
  nameRu: string;
  nameUz: string;
  specializationRu: string;
  specializationUz: string;
  bioRu: string;
  bioUz: string;
};

function toForm(p: DoctorProfile): FormState {
  return {
    name: p.name,
    phone: p.phone ?? "",
    nameRu: p.nameRu,
    nameUz: p.nameUz,
    specializationRu: p.specializationRu,
    specializationUz: p.specializationUz,
    bioRu: p.bioRu ?? "",
    bioUz: p.bioUz ?? "",
  };
}

export function ProfileTab() {
  const t = useTranslations("doctor.settings");
  const profile = useDoctorProfile();
  const patch = usePatchDoctorProfile();

  const [form, setForm] = React.useState<FormState | null>(null);

  // Hydrate form from server snapshot once it lands. Re-runs only when the
  // backing data id flips (e.g., after impersonation) — local edits are
  // preserved as the user types.
  React.useEffect(() => {
    if (profile.data && !form) {
      setForm(toForm(profile.data));
    }
  }, [profile.data, form]);

  if (profile.isLoading || !form) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full max-w-md" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (profile.isError || !profile.data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-destructive">
        {t("profile.loadError")}
        <button
          type="button"
          onClick={() => profile.refetch()}
          className="ml-1 underline"
        >
          {t("actions.retry")}
        </button>
      </div>
    );
  }

  const server = profile.data;
  const changed = diff(form, server);
  const isDirty = Object.keys(changed).length > 0;

  const onSave = () => {
    if (!isDirty) return;
    patch.mutate(changed, {
      onSuccess: () => toast.success(t("profile.saved")),
      onError: () => toast.error(t("actions.saveError")),
    });
  };

  const onReset = () => {
    setForm(toForm(server));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="rounded-2xl border border-border bg-card p-6"
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field id="name" label={t("profile.nameLabel")}>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            maxLength={200}
          />
        </Field>
        <Field id="phone" label={t("profile.phoneLabel")}>
          <Input
            id="phone"
            type="tel"
            placeholder="+998 (__) ___-__-__"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            maxLength={30}
          />
        </Field>

        <Field id="email" label={t("profile.emailLabel")}>
          <Input id="email" value={server.email} disabled />
        </Field>
        <Field id="role" label={t("profile.roleLabel")}>
          <Input id="role" value={server.role} disabled />
        </Field>

        <Field id="nameRu" label={t("profile.fullNameRuLabel")}>
          <Input
            id="nameRu"
            value={form.nameRu}
            onChange={(e) => setForm({ ...form, nameRu: e.target.value })}
            maxLength={200}
          />
        </Field>
        <Field id="nameUz" label={t("profile.fullNameUzLabel")}>
          <Input
            id="nameUz"
            value={form.nameUz}
            onChange={(e) => setForm({ ...form, nameUz: e.target.value })}
            maxLength={200}
          />
        </Field>

        <Field id="specializationRu" label={t("profile.specializationRuLabel")}>
          <Input
            id="specializationRu"
            value={form.specializationRu}
            onChange={(e) =>
              setForm({ ...form, specializationRu: e.target.value })
            }
            maxLength={200}
          />
        </Field>
        <Field id="specializationUz" label={t("profile.specializationUzLabel")}>
          <Input
            id="specializationUz"
            value={form.specializationUz}
            onChange={(e) =>
              setForm({ ...form, specializationUz: e.target.value })
            }
            maxLength={200}
          />
        </Field>

        <Field
          id="bioRu"
          label={t("profile.bioRuLabel")}
          className="md:col-span-2"
        >
          <Textarea
            id="bioRu"
            value={form.bioRu}
            onChange={(e) => setForm({ ...form, bioRu: e.target.value })}
            maxLength={5000}
            rows={4}
          />
        </Field>
        <Field
          id="bioUz"
          label={t("profile.bioUzLabel")}
          className="md:col-span-2"
        >
          <Textarea
            id="bioUz"
            value={form.bioUz}
            onChange={(e) => setForm({ ...form, bioUz: e.target.value })}
            maxLength={5000}
            rows={4}
          />
        </Field>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={!isDirty || patch.isPending}
        >
          {t("actions.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!isDirty || patch.isPending}
        >
          {patch.isPending ? (
            <Loader2Icon className="mr-1.5 size-4 animate-spin" />
          ) : (
            <SaveIcon className="mr-1.5 size-4" />
          )}
          {t("actions.save")}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 block text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
