"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, Plus, User2 } from "lucide-react";

import { useT } from "./mini-i18n";
import { useFamily, type FamilyMember, type FamilyPatient } from "../_hooks/use-family";
import { useActiveContext } from "../_hooks/use-active-context";

/**
 * Compact "act on behalf of" picker that lives at the top of every Mini App
 * page. Tapping it opens a sheet listing self + linked relatives (with an
 * "Add relative" CTA at the bottom). The selection is written back into the
 * URL via `useActiveContext`, so refresh + booking flow + treatment plan all
 * stay in sync without a separate global store.
 *
 * Renders nothing while the family query is still loading — the shell would
 * otherwise jump as the bar appears post-fetch. Renders only the "Add" pill
 * if the user has zero relatives (no point showing a switcher with one row).
 */
export function FamilySwitcher({ slug }: { slug: string }) {
  const t = useT();
  const { data, isLoading } = useFamily();
  const { onBehalfOf, setOnBehalfOf } = useActiveContext();
  const [open, setOpen] = React.useState(false);

  if (isLoading || !data) return null;

  const activePatient: FamilyPatient =
    onBehalfOf
      ? data.members.find((m) => m.patient.id === onBehalfOf)?.patient ?? data.self
      : data.self;
  const isSelf = activePatient.id === data.self.id;
  const hasFamily = data.members.length > 0;

  return (
    <>
      <div className="-mt-1 mb-3 flex w-full items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-[36px] flex-1 items-center gap-2 rounded-full px-3 py-1.5 text-left text-sm transition active:scale-[0.99]"
          style={{
            backgroundColor:
              "color-mix(in oklch, var(--tg-section-bg) 80%, transparent)",
            border:
              "1px solid color-mix(in oklch, var(--tg-hint) 25%, transparent)",
          }}
        >
          <span
            className="grid h-6 w-6 place-items-center rounded-full"
            style={{
              backgroundColor: "var(--tg-accent)",
              color: "#fff",
            }}
          >
            <User2 className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold">
            {isSelf ? t.family.self : firstName(activePatient.fullName)}
          </span>
          {hasFamily ? (
            <ChevronDown
              className="h-4 w-4 opacity-60"
              aria-hidden
            />
          ) : null}
        </button>
        {!hasFamily ? (
          <Link
            href={`/c/${slug}/my/family/add`}
            className="flex min-h-[36px] items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-white transition active:scale-[0.98]"
            style={{ backgroundColor: "var(--tg-accent)" }}
          >
            <Plus className="h-4 w-4" />
            {t.family.add}
          </Link>
        ) : null}
      </div>

      {open && hasFamily ? (
        <SwitcherSheet
          slug={slug}
          self={data.self}
          members={data.members}
          activeId={activePatient.id}
          selfActive={isSelf}
          onClose={() => setOpen(false)}
          onPick={(patientId) => {
            setOnBehalfOf(patientId === data.self.id ? null : patientId);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function SwitcherSheet({
  slug,
  self,
  members,
  activeId,
  selfActive,
  onClose,
  onPick,
}: {
  slug: string;
  self: FamilyPatient;
  members: FamilyMember[];
  activeId: string;
  selfActive: boolean;
  onClose: () => void;
  onPick: (patientId: string) => void;
}) {
  const t = useT();

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center"
      onClick={onClose}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      />
      <div
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
        className="ma-fade-up relative w-full max-w-[430px] rounded-t-2xl px-3 pb-6 pt-3"
        style={{
          backgroundColor: "var(--tg-bg)",
          color: "var(--tg-text)",
          paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)",
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-1 w-10 rounded-full"
          style={{
            backgroundColor:
              "color-mix(in oklch, var(--tg-hint) 40%, transparent)",
          }}
        />
        <div className="space-y-1">
          <Row
            name={t.family.self}
            sub={self.phone}
            active={selfActive}
            onClick={() => onPick(self.id)}
          />
          {members.map((m) => (
            <Row
              key={m.linkId}
              name={m.patient.fullName}
              sub={t.family.relationship[m.relationship]}
              active={!selfActive && m.patient.id === activeId}
              onClick={() => onPick(m.patient.id)}
            />
          ))}
        </div>
        {members.length < (5) ? (
          <Link
            href={`/c/${slug}/my/family/add`}
            onClick={onClose}
            className="mt-3 flex min-h-[48px] items-center justify-center gap-2 rounded-2xl text-sm font-semibold"
            style={{
              backgroundColor: "var(--tg-accent)",
              color: "#fff",
            }}
          >
            <Plus className="h-4 w-4" />
            {t.family.add}
          </Link>
        ) : (
          <p
            className="mt-3 text-center text-xs"
            style={{ color: "var(--tg-hint)" }}
          >
            {t.family.maxReached}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  name,
  sub,
  active,
  onClick,
}: {
  name: string;
  sub?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition active:scale-[0.99]"
      style={{
        backgroundColor: active
          ? "color-mix(in oklch, var(--tg-accent) 14%, var(--tg-section-bg))"
          : "var(--tg-section-bg)",
        border: active
          ? "1px solid color-mix(in oklch, var(--tg-accent) 60%, transparent)"
          : "1px solid color-mix(in oklch, var(--tg-hint) 18%, transparent)",
      }}
    >
      <span
        className="grid h-9 w-9 place-items-center rounded-full"
        style={{
          backgroundColor: active ? "var(--tg-accent)" : "color-mix(in oklch, var(--tg-hint) 18%, transparent)",
          color: active ? "#fff" : "var(--tg-text)",
        }}
      >
        <User2 className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name}</div>
        {sub ? (
          <div
            className="truncate text-xs"
            style={{ color: "var(--tg-hint)" }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function firstName(full: string): string {
  return full.split(" ")[0] ?? full;
}
