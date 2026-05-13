"use client";

import {
  FileTextIcon,
  FlaskConicalIcon,
  LayersIcon,
  PlusIcon,
  UserSearchIcon,
  type LucideIcon,
} from "lucide-react";

import { MOCK_QUICK_ACTIONS, type QuickAction } from "../_mocks";

const ICON: Record<QuickAction["icon"], LucideIcon> = {
  new: PlusIcon,
  patient: UserSearchIcon,
  conclusion: FileTextIcon,
  analysis: FlaskConicalIcon,
  template: LayersIcon,
};

export function QuickActions() {
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          Быстрые действия
        </div>
      </header>

      <ul className="space-y-1 px-3 pb-4">
        {MOCK_QUICK_ACTIONS.map((a) => {
          const Icon = ICON[a.icon];
          return (
            <li key={a.id}>
              <button
                type="button"
                className="motion-press flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-primary/5"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-3.5" />
                </span>
                <span className="flex-1 truncate text-sm font-medium text-foreground">
                  {a.label}
                </span>
                <kbd className="inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
                  {a.shortcut}
                </kbd>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
