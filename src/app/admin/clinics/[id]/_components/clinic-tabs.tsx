"use client";

/**
 * Shared sub-page nav for a single clinic in the SUPER_ADMIN console.
 *
 * Renders a horizontal tab strip linking to the clinic's `integrations` and
 * `billing` (Phase 9c) pages. Highlights the active tab via `usePathname`.
 *
 * Designed to be dropped in at the top of every `src/app/admin/clinics/[id]/<sub>/page.tsx`
 * client component, just below the breadcrumb header. Future Phase 9d/+ tabs
 * (audit, branches, etc.) extend the `TABS` array.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCardIcon, PlugIcon, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface Tab {
  href: (clinicId: string) => string;
  match: (pathname: string, clinicId: string) => boolean;
  label: string;
  icon: LucideIcon;
}

const TABS: Tab[] = [
  {
    href: (id) => `/admin/clinics/${id}/billing`,
    match: (p, id) => p.startsWith(`/admin/clinics/${id}/billing`),
    label: "Тарификация",
    icon: CreditCardIcon,
  },
  {
    href: (id) => `/admin/clinics/${id}/integrations`,
    match: (p, id) => p.startsWith(`/admin/clinics/${id}/integrations`),
    label: "Интеграции",
    icon: PlugIcon,
  },
];

export function ClinicTabs({ clinicId }: { clinicId: string }) {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Разделы клиники"
      className="-mx-1 flex flex-wrap gap-1 border-b border-border pb-2"
    >
      {TABS.map((t) => {
        const active = t.match(pathname, clinicId);
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            href={t.href(clinicId)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
