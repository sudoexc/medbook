"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  FileTextIcon,
  FlaskConicalIcon,
  LayersIcon,
  PlusIcon,
  UserSearchIcon,
  type LucideIcon,
} from "lucide-react";

type Action = {
  id: string;
  labelKey: string;
  shortcut: string;
  icon: LucideIcon;
  href: string;
};

// Static — these are navigation entry-points, not data. Inlining keeps the
// shortcut + icon + label co-located with the route they open.
const ACTIONS: Action[] = [
  {
    id: "new",
    labelKey: "quickActions.newVisit",
    shortcut: "F2",
    icon: PlusIcon,
    href: "/doctor/reception?new=1",
  },
  {
    id: "patient",
    labelKey: "quickActions.openPatientCard",
    shortcut: "F3",
    icon: UserSearchIcon,
    href: "/doctor/patients",
  },
  {
    id: "conclusion",
    labelKey: "quickActions.createConclusion",
    shortcut: "F4",
    icon: FileTextIcon,
    href: "/doctor/conclusions?new=1",
  },
  {
    id: "analysis",
    labelKey: "quickActions.referToLabs",
    shortcut: "F5",
    icon: FlaskConicalIcon,
    href: "/doctor/documents?new=referral",
  },
  {
    id: "template",
    labelKey: "quickActions.documentTemplates",
    shortcut: "F6",
    icon: LayersIcon,
    href: "/doctor/documents?tab=templates",
  },
];

export function QuickActions() {
  const t = useTranslations("doctor.myDay");

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          {t("quickActions.title")}
        </div>
      </header>

      <ul className="space-y-1 px-3 pb-4">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <li key={a.id}>
              <Link
                href={a.href}
                className="motion-press flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-primary/5"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-3.5" />
                </span>
                <span className="flex-1 truncate text-sm font-medium text-foreground">
                  {t(a.labelKey)}
                </span>
                <kbd className="inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
                  {a.shortcut}
                </kbd>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
