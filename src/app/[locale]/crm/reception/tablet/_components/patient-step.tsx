"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRightIcon, PhoneIcon, SearchIcon, UserPlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useDebounced } from "@/hooks/use-debounced";
import { formatCalendarDay } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import {
  formatFull,
  isCompleteLocal,
  phoneSearchTerm,
  phoneTail,
} from "@/lib/reception-tablet/phone";
import {
  birthYearInput,
  draftFromSearch,
  validateNewPatient,
  type NewPatientDraft,
  type NewPatientErrors,
} from "@/lib/reception-tablet/new-patient";
import type { ChosenPatient } from "@/lib/reception-tablet/flow";

import {
  useTabletPatientSearch,
  type TabletPatientHit,
} from "../_hooks/use-tablet-actions";
import { PhoneField, PhoneKeypad } from "./phone-keypad";
import { Caption, ErrorNote, Segmented, TOUCH, TouchButton } from "./tablet-ui";

/** The patient step's typing, kept by the page so «Назад» finds it as left. */
export type PatientSearchState = {
  mode: "phone" | "name";
  phoneLocal: string;
  nameQuery: string;
  creating: boolean;
  draft: NewPatientDraft;
};

export const EMPTY_PATIENT_SEARCH: PatientSearchState = {
  mode: "phone",
  phoneLocal: "",
  nameQuery: "",
  creating: false,
  draft: draftFromSearch({}),
};

function birthYearOf(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  return Number.isFinite(d.getTime()) ? d.getUTCFullYear() : null;
}

function nameSearchTerm(q: string): string | null {
  const v = q.replace(/\s+/g, " ").trim();
  return v.length >= 2 ? v : null;
}

export function PatientStep({
  search,
  onSearchChange,
  onPick,
}: {
  search: PatientSearchState;
  onSearchChange: (next: PatientSearchState) => void;
  onPick: (patient: ChosenPatient) => void;
}) {
  const t = useTranslations("receptionTablet.patient");
  const set = (patch: Partial<PatientSearchState>) => onSearchChange({ ...search, ...patch });

  const openNew = () =>
    set({
      creating: true,
      draft: draftFromSearch(
        search.mode === "phone"
          ? { phoneLocal: search.phoneLocal }
          : { nameQuery: search.nameQuery },
      ),
    });

  if (search.creating) {
    return (
      <NewPatientForm
        draft={search.draft}
        onDraftChange={(draft) => set({ draft })}
        onCancel={() => set({ creating: false })}
        onDone={onPick}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="mr-auto text-[28px] font-bold leading-tight text-foreground">{t("title")}</h2>
        <TouchButton tone="outline" size="lg" onClick={openNew}>
          <UserPlusIcon />
          {t("newPatient")}
        </TouchButton>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Segmented
            label={t("title")}
            value={search.mode}
            onChange={(v) => v && set({ mode: v })}
            options={[
              { value: "phone", label: t("byPhone"), icon: <PhoneIcon className="size-5" /> },
              { value: "name", label: t("byName"), icon: <SearchIcon className="size-5" /> },
            ]}
          />
          {search.mode === "phone" ? (
            <>
              <PhoneField
                id="tablet-phone-search"
                label={t("phoneLabel")}
                local={search.phoneLocal}
                onChange={(phoneLocal) => set({ phoneLocal })}
              />
              <PhoneKeypad
                fieldId="tablet-phone-search"
                local={search.phoneLocal}
                onChange={(phoneLocal) => set({ phoneLocal })}
              />
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="tablet-name-search"
                className="text-[15px] font-semibold text-muted-foreground"
              >
                {t("nameLabel")}
              </label>
              <input
                id="tablet-name-search"
                type="text"
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="search"
                value={search.nameQuery}
                onChange={(e) => set({ nameQuery: e.target.value })}
                placeholder={t("namePlaceholder")}
                className="h-[4.5rem] rounded-2xl border border-border bg-card px-5 text-[22px] font-medium text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
        </div>

        <SearchResults search={search} onPick={onPick} onNew={openNew} />
      </div>
    </div>
  );
}

function SearchResults({
  search,
  onPick,
  onNew,
}: {
  search: PatientSearchState;
  onPick: (patient: ChosenPatient) => void;
  onNew: () => void;
}) {
  const t = useTranslations("receptionTablet.patient");
  const rawTerm =
    search.mode === "phone" ? phoneSearchTerm(search.phoneLocal) : nameSearchTerm(search.nameQuery);
  const term = useDebounced(rawTerm, 250);
  const query = useTabletPatientSearch(term);
  const hits = term && rawTerm ? (query.data ?? []) : [];
  const phoneComplete = search.mode === "phone" && isCompleteLocal(search.phoneLocal);
  const settled = term === rawTerm && !query.isFetching;

  let status: React.ReactNode = null;
  if (!rawTerm) {
    status = search.mode === "phone" ? t("typeMoreDigits") : t("typeMoreLetters");
  } else if (query.isError && !query.data) {
    status = null;
  } else if (!settled && hits.length === 0) {
    status = t("searching");
  } else if (hits.length === 0) {
    status = phoneComplete ? t("noMatchesPhone") : t("noMatches");
  }

  return (
    <section aria-live="polite" className="flex min-w-0 flex-col gap-3">
      {hits.length > 0 ? (
        <Caption>{t("results", { count: hits.length })}</Caption>
      ) : null}
      {query.isError && !query.data ? <ErrorNote>{t("searchError")}</ErrorNote> : null}
      {status ? (
        <p className="rounded-2xl border border-dashed border-border bg-card/40 px-5 py-6 text-center text-[17px] text-muted-foreground">
          {status}
        </p>
      ) : null}
      {hits.length > 0 ? (
        <ul className={cn("flex flex-col gap-3", !settled && "opacity-70")}>
          {hits.map((p) => (
            <li key={p.id}>
              <PatientCard hit={p} onPick={onPick} />
            </li>
          ))}
        </ul>
      ) : null}
      {phoneComplete && settled ? (
        <TouchButton
          tone={hits.length === 0 ? "primary" : "outline"}
          size="lg"
          className="w-full"
          onClick={onNew}
        >
          <UserPlusIcon />
          {t("newWithPhone", { phone: formatFull(search.phoneLocal) })}
        </TouchButton>
      ) : null}
    </section>
  );
}

function PatientCard({
  hit,
  onPick,
}: {
  hit: TabletPatientHit;
  onPick: (patient: ChosenPatient) => void;
}) {
  const t = useTranslations("receptionTablet.patient");
  const locale = useLocale();
  const year = birthYearOf(hit.birthDate);
  const phone = displayPhone({ phone: hit.phone, phoneNormalized: hit.phoneNormalized });
  const tail = phoneTail(phone);
  return (
    <button
      type="button"
      onClick={() =>
        onPick({
          kind: "existing",
          id: hit.id,
          fullName: hit.fullName,
          phone: phone || null,
          birthYear: year,
        })
      }
      className={cn(
        TOUCH,
        "motion-press flex min-h-[5.5rem] w-full items-center gap-4 rounded-2xl border border-border bg-card px-5 py-3 text-left transition-colors active:bg-muted/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <AvatarWithStatus name={hit.fullName} src={hit.photoUrl} size="lg" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xl font-semibold text-foreground">{hit.fullName}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[15px] text-muted-foreground">
          <span>{year !== null ? t("born", { year }) : t("noBirthYear")}</span>
          {tail ? <span className="tabular-nums">•• {tail}</span> : null}
          <span>
            {hit.lastVisitAt
              ? t("lastVisit", { date: formatCalendarDay(hit.lastVisitAt, locale, { year: true }) })
              : t("neverVisited")}
          </span>
        </p>
      </div>
      <ChevronRightIcon className="size-6 shrink-0 text-muted-foreground/60" aria-hidden />
    </button>
  );
}

function NewPatientForm({
  draft,
  onDraftChange,
  onCancel,
  onDone,
}: {
  draft: NewPatientDraft;
  onDraftChange: (draft: NewPatientDraft) => void;
  onCancel: () => void;
  onDone: (patient: ChosenPatient) => void;
}) {
  const t = useTranslations("receptionTablet.newPatient");
  const [errors, setErrors] = React.useState<NewPatientErrors | null>(null);
  const set = (patch: Partial<NewPatientDraft>) => {
    const next = { ...draft, ...patch };
    onDraftChange(next);
    // Errors follow the fields once shown, so a fixed one goes away.
    if (errors) {
      const v = validateNewPatient(next);
      setErrors(v.ok ? null : v.errors);
    }
  };

  const submit = () => {
    const v = validateNewPatient(draft);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    onDone({ kind: "new", ...v.value });
  };

  const fieldClass =
    "h-[4.5rem] w-full rounded-2xl border bg-card px-5 text-[22px] font-medium text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-ring";

  return (
    <form
      className="mx-auto flex w-full max-w-4xl flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <h2 className="text-[28px] font-bold leading-tight text-foreground">{t("title")}</h2>

      <div className="flex flex-col gap-2">
        <label htmlFor="tablet-new-name" className="text-[15px] font-semibold text-muted-foreground">
          {t("fullName")}
        </label>
        <input
          id="tablet-new-name"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="next"
          value={draft.fullName}
          onChange={(e) => set({ fullName: e.target.value })}
          onKeyDown={(e) => {
            // «Далее» on the iPad keyboard with the number still to dial:
            // put the keyboard away so the keypad below is in reach, instead
            // of submitting a form that would only answer «наберите номер».
            if (e.key === "Enter" && !isCompleteLocal(draft.phoneLocal)) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          placeholder={t("fullNamePlaceholder")}
          aria-invalid={Boolean(errors?.fullName) || undefined}
          className={cn(fieldClass, errors?.fullName ? "border-destructive" : "border-border")}
        />
        {errors?.fullName ? (
          <p className="text-[15px] text-destructive">
            {errors.fullName === "required" ? t("errFullNameRequired") : t("errFullNameShort")}
          </p>
        ) : null}
      </div>

      {/* The phone as on the search: the field with the keypad under it
          (an iPad has no number pad of its own, its keyboard would cover
          half the screen), the year and the sex beside them. */}
      <div className="grid gap-6 md:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <PhoneField
              id="tablet-new-phone"
              label={t("phone")}
              local={draft.phoneLocal}
              onChange={(phoneLocal) => set({ phoneLocal })}
              invalid={Boolean(errors?.phone)}
            />
            {errors?.phone ? (
              <p className="text-[15px] text-destructive">
                {errors.phone === "required" ? t("errPhoneRequired") : t("errPhoneIncomplete")}
              </p>
            ) : null}
          </div>
          <PhoneKeypad
            fieldId="tablet-new-phone"
            local={draft.phoneLocal}
            onChange={(phoneLocal) => set({ phoneLocal })}
          />
        </div>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label htmlFor="tablet-new-year" className="text-[15px] font-semibold text-muted-foreground">
              {t("birthYear")}
            </label>
            <input
              id="tablet-new-year"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              enterKeyHint="done"
              value={draft.birthYear}
              onChange={(e) => set({ birthYear: birthYearInput(e.target.value) })}
              placeholder={t("birthYearPlaceholder")}
              aria-invalid={Boolean(errors?.birthYear) || undefined}
              className={cn(
                fieldClass,
                "text-[28px] font-semibold tabular-nums",
                errors?.birthYear ? "border-destructive" : "border-border",
              )}
            />
            {errors?.birthYear ? (
              <p className="text-[15px] text-destructive">{t("errBirthYear")}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[15px] font-semibold text-muted-foreground">
              {t("gender")} <span className="font-normal">({t("optional")})</span>
            </span>
            <Segmented
              label={t("gender")}
              allowNone
              value={draft.gender}
              onChange={(gender) => set({ gender })}
              options={[
                { value: "MALE", label: t("male") },
                { value: "FEMALE", label: t("female") },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <TouchButton tone="outline" size="lg" onClick={onCancel}>
          {t("backToSearch")}
        </TouchButton>
        <TouchButton type="submit" size="lg" className="min-w-[14rem] flex-1">
          {t("submit")}
        </TouchButton>
      </div>
    </form>
  );
}
