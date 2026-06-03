"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  MButton,
  MCard,
  MHint,
  MSection,
} from "./mini-ui";
import { SkeletonList } from "./skeleton";
import { useT } from "./mini-i18n";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import {
  useAddFamilyMember,
  useFamily,
} from "../_hooks/use-family";
import { useActiveContext } from "../_hooks/use-active-context";

type Relationship = "child" | "spouse" | "parent" | "other";

/**
 * "Add a relative" form. Posts to `/api/miniapp/family` and on success
 * switches the Mini App active context to the new member, navigating back
 * home so the user immediately sees the treatment plan / appointments for
 * that relative.
 */
export function FamilyAddScreen() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug } = useMiniAppAuth();
  const tg = useTelegramWebApp();
  const family = useFamily();
  const add = useAddFamilyMember();
  const { setOnBehalfOf } = useActiveContext();

  const [fullName, setFullName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [gender, setGender] = React.useState<"MALE" | "FEMALE" | null>(null);
  const [relationship, setRelationship] =
    React.useState<Relationship>("child");
  const [errMsg, setErrMsg] = React.useState<string | null>(null);

  // Wire TG back-button to return to /my, since we navigate here from the
  // family switcher inside the shell layout (no native browser back inside
  // the WebView).
  React.useEffect(() => {
    return tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
  }, [tg, router, clinicSlug]);

  const familyFull =
    family.data ? family.data.members.length >= family.data.max : false;

  const canSubmit =
    fullName.trim().length >= 2 && !add.isPending && !familyFull;

  const onSubmit = React.useCallback(async () => {
    setErrMsg(null);
    try {
      const res = await add.mutateAsync({
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        birthDate: birthDate || undefined,
        gender: gender ?? undefined,
        relationship,
      });
      tg.haptic.notification("success");
      setOnBehalfOf(res.member.patient.id);
      router.push(`/c/${clinicSlug}/my`);
    } catch (e) {
      tg.haptic.notification("error");
      const err = e as Error & { data?: { reason?: string } };
      const reason = err.data?.reason;
      if (reason === "max_reached") setErrMsg(t.family.maxReached);
      else if (reason === "duplicate") setErrMsg(t.family.duplicate);
      else setErrMsg(t.family.error);
    }
  }, [
    add,
    fullName,
    phone,
    birthDate,
    gender,
    relationship,
    tg,
    setOnBehalfOf,
    router,
    clinicSlug,
    t,
  ]);

  // Mirror the form state into Telegram's bottom MainButton so the action
  // sticks to the keyboard like every other Mini App screen.
  React.useEffect(() => {
    return tg.setMainButton({
      text: add.isPending ? t.family.saving : t.family.submit,
      active: canSubmit,
      progress: add.isPending,
      visible: true,
      onClick: onSubmit,
    });
  }, [tg, add.isPending, canSubmit, onSubmit, t.family.saving, t.family.submit]);

  if (family.isLoading) return <SkeletonList rows={3} variant="card" />;

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">{t.family.formTitle}</h1>

      {familyFull ? (
        <MCard className="mb-3 text-sm" style={{ color: "#b91c1c" }}>
          {t.family.maxReached}
        </MCard>
      ) : null}

      <MSection>
        <MCard className="space-y-4">
          <Field label={t.family.fullName}>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={inputStyle}
            />
          </Field>
          <Field label={t.family.phone}>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+998 90 000 00 00"
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={inputStyle}
            />
          </Field>
          <Field label={t.family.birthDate}>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={inputStyle}
            />
          </Field>
          <Field label={t.family.gender}>
            <div className="flex gap-2">
              {(["MALE", "FEMALE"] as const).map((g) => (
                <MButton
                  key={g}
                  type="button"
                  variant={gender === g ? "primary" : "secondary"}
                  block
                  onClick={() => setGender(g)}
                >
                  {g === "MALE" ? t.family.genderM : t.family.genderF}
                </MButton>
              ))}
            </div>
          </Field>
          <Field label={t.family.relationshipLabel}>
            <div className="grid grid-cols-2 gap-2">
              {(["child", "spouse", "parent", "other"] as const).map((r) => (
                <MButton
                  key={r}
                  type="button"
                  variant={relationship === r ? "primary" : "secondary"}
                  block
                  onClick={() => setRelationship(r)}
                >
                  {t.family.relationship[r]}
                </MButton>
              ))}
            </div>
          </Field>
        </MCard>
      </MSection>

      {errMsg ? (
        <MCard className="mb-3 text-sm" style={{ color: "#b91c1c" }}>
          {errMsg}
        </MCard>
      ) : null}

      <MHint>{t.book.phoneHint}</MHint>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div
        className="mb-1 text-xs font-medium"
        style={{ color: "var(--tg-hint)" }}
      >
        {label}
      </div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--tg-bg)",
  borderColor: "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
  color: "var(--tg-text)",
};
