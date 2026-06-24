"use client";

import * as React from "react";
import { ChevronDown, User2 } from "lucide-react";

import { useT } from "./mini-i18n";
import { MSheet } from "./mini-ui";
import { useFamily, type FamilyMember, type FamilyPatient } from "../_hooks/use-family";
import { useActiveContext } from "../_hooks/use-active-context";

/**
 * Compact "act on behalf of" picker at the top of every Mini App page.
 * Tapping it opens a sheet listing self + linked relatives; the selection is
 * written back into the URL via `useActiveContext`, so refresh + booking flow
 * + treatment plan all stay in sync without a separate global store.
 *
 * Renders nothing until the family query resolves, and nothing when the user
 * has no linked relatives — a one-row switcher with no one to switch to is
 * just noise, and adding relatives is no longer offered from the home.
 */
export function FamilySwitcher() {
  const t = useT();
  const { data, isLoading } = useFamily();
  const { onBehalfOf, setOnBehalfOf } = useActiveContext();
  const [open, setOpen] = React.useState(false);

  if (isLoading || !data || data.members.length === 0) return null;

  const activePatient: FamilyPatient = onBehalfOf
    ? data.members.find((m) => m.patient.id === onBehalfOf)?.patient ?? data.self
    : data.self;
  const isSelf = activePatient.id === data.self.id;

  return (
    <>
      <div className="-mt-1 mb-3 flex w-full items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-[36px] flex-1 items-center gap-2 rounded-full px-3 py-1.5 text-left text-sm ma-press active:scale-[0.99]"
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
          <ChevronDown className="h-4 w-4 opacity-60" aria-hidden />
        </button>
      </div>

      {open ? (
        <SwitcherSheet
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
  self,
  members,
  activeId,
  selfActive,
  onClose,
  onPick,
}: {
  self: FamilyPatient;
  members: FamilyMember[];
  activeId: string;
  selfActive: boolean;
  onClose: () => void;
  onPick: (patientId: string) => void;
}) {
  const t = useT();

  return (
    <MSheet onClose={onClose}>
      {() => (
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
      )}
    </MSheet>
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
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left ma-press active:scale-[0.99]"
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
