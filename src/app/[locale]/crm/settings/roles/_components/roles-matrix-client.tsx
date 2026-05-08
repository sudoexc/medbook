"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircleIcon,
  BadgeCheckIcon,
  CheckIcon,
  EyeIcon,
  InfoIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import {
  ALL_ROLES,
  PERMISSION_MATRIX,
  type Permission,
  type ReadScope,
  type Role,
  type UpdateScope,
} from "@/lib/permissions/matrix";

// ---------------------------------------------------------------------------
// Per-action chips
// ---------------------------------------------------------------------------

function readChip(scope: ReadScope, label: string) {
  if (scope === "none") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground/60">
        <MinusIcon className="size-3" /> {label}
      </span>
    );
  }
  const tone =
    scope === "all"
      ? "bg-primary/15 text-primary"
      : "bg-warning/15 text-warning";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      <EyeIcon className="size-3" />
      {label}
    </span>
  );
}

function writeChip(canWrite: boolean, label: string) {
  if (!canWrite) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground/60">
        <MinusIcon className="size-3" /> {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-semibold text-success">
      <PlusIcon className="size-3" />
      {label}
    </span>
  );
}

function updateChip(scope: UpdateScope, label: string) {
  if (scope === "none") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground/60">
        <MinusIcon className="size-3" /> {label}
      </span>
    );
  }
  const tone =
    scope === "all"
      ? "bg-primary/15 text-primary"
      : "bg-warning/15 text-warning";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      <PencilIcon className="size-3" />
      {label}
    </span>
  );
}

function deleteChip(canDelete: boolean, label: string) {
  if (!canDelete) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground/60">
        <MinusIcon className="size-3" /> {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">
      <Trash2Icon className="size-3" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cell renderer
// ---------------------------------------------------------------------------

interface CellProps {
  perm: Permission;
  scopeLabels: { all: string; own: string; today: string };
  actionLabels: { r: string; w: string; u: string; d: string };
}

function Cell({ perm, scopeLabels, actionLabels }: CellProps) {
  // Compact summary: tiny chips stacked.
  const readLabel =
    perm.read === "all"
      ? scopeLabels.all
      : perm.read === "own"
        ? scopeLabels.own
        : perm.read === "today"
          ? scopeLabels.today
          : actionLabels.r;
  const updateLabel =
    perm.update === "all"
      ? scopeLabels.all
      : perm.update === "own"
        ? scopeLabels.own
        : actionLabels.u;

  // If everything is denied, render an em dash to keep the cell quiet.
  const allDenied =
    perm.read === "none" &&
    !perm.write &&
    perm.update === "none" &&
    !perm.delete;
  if (allDenied) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {readChip(perm.read, `${actionLabels.r}:${readLabel}`)}
      {writeChip(perm.write, actionLabels.w)}
      {updateChip(perm.update, `${actionLabels.u}:${updateLabel}`)}
      {deleteChip(perm.delete, actionLabels.d)}
      {perm.unsure ? (
        <AlertCircleIcon className="size-3 text-warning" aria-label="needs review" />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function RolesMatrixClient() {
  const tSettings = useTranslations("settings");
  const tRoles = useTranslations("settings.roles");
  const tUsers = useTranslations("settings.users.roles");

  const scopeLabels = {
    all: tRoles("scope.all"),
    own: tRoles("scope.own"),
    today: tRoles("scope.today"),
  };
  const actionLabels = {
    r: tRoles("actions.r"),
    w: tRoles("actions.w"),
    u: tRoles("actions.u"),
    d: tRoles("actions.d"),
  };

  return (
    <PageContainer>
      <SectionHeader
        title={tRoles("title")}
        subtitle={tRoles("subtitle")}
        actions={
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
            <BadgeCheckIcon className="size-4 text-primary" />
            {tRoles("readOnlyForAdmin")}
          </div>
        }
      />

      <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <p className="font-medium">{tRoles("legendTitle")}</p>
          <p className="mt-1 text-muted-foreground">{tRoles("legendBody")}</p>
          <p className="mt-1 text-muted-foreground">{tRoles("sourceNote")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{tRoles("legendChipsTitle")}</span>
        <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-primary">
          <EyeIcon className="size-3" /> {tRoles("actions.r")}
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-success/15 px-1.5 py-0.5 text-success">
          <PlusIcon className="size-3" /> {tRoles("actions.w")}
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-warning">
          <PencilIcon className="size-3" /> {tRoles("actions.u")}
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
          <Trash2Icon className="size-3" /> {tRoles("actions.d")}
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5">
          <CheckIcon className="size-3" /> {tRoles("scope.all")}
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5">
          {tRoles("scope.own")}
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5">
          {tRoles("scope.today")}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 font-medium">
                {tRoles("resourceCol")}
              </th>
              {ALL_ROLES.map((r: Role) => (
                <th key={r} className="min-w-[180px] px-3 py-2 font-medium">
                  {tUsers(r)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MATRIX.map((row) => (
              <tr key={row.resource} className="border-t border-border align-top">
                <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium">
                  {tRoles(`resources.${row.resource}`)}
                </td>
                {ALL_ROLES.map((role: Role) => (
                  <td key={role} className="px-3 py-2">
                    <Cell
                      perm={row.perRole[role]}
                      scopeLabels={scopeLabels}
                      actionLabels={actionLabels}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        {tSettings("common.shown", {
          shown: PERMISSION_MATRIX.length,
          total: PERMISSION_MATRIX.length,
        })}
      </p>
    </PageContainer>
  );
}
