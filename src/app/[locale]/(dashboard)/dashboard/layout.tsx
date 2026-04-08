"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, LogOut, Calendar, Menu, X, ListOrdered, UserSearch, BarChart3, Grid3X3, Bell, Search, Banknote, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

import { useSession } from "next-auth/react";

const allNavItems = [
  { path: "dashboard", icon: LayoutDashboard, key: "overview" as const, exact: true, roles: ["ADMIN", "DOCTOR", "RECEPTIONIST"] },
  { path: "dashboard/schedule", icon: Grid3X3, key: "schedule" as const, roles: ["ADMIN", "DOCTOR", "RECEPTIONIST"] },
  { path: "dashboard/queue", icon: ListOrdered, key: "queue" as const, roles: ["ADMIN", "DOCTOR", "RECEPTIONIST"] },
  { path: "dashboard/patients", icon: UserSearch, key: "patients" as const, roles: ["ADMIN", "DOCTOR", "RECEPTIONIST"] },
  { path: "dashboard/leads", icon: Users, key: "leads" as const, roles: ["ADMIN"] },
  { path: "dashboard/appointments", icon: Calendar, key: "appointments" as const, roles: ["ADMIN", "DOCTOR"] },
  { path: "dashboard/analytics", icon: BarChart3, key: "analytics" as const, roles: ["ADMIN"] },
  { path: "dashboard/payments", icon: Banknote, key: "payments" as const, roles: ["ADMIN", "RECEPTIONIST"] },
  { path: "dashboard/settings", icon: Settings, key: "settings" as const, roles: ["ADMIN", "DOCTOR"] },
];

function SidebarContent({ t, locale, pathname, role }: { t: ReturnType<typeof useTranslations<"dashboard">>; locale: string; pathname: string; role: string }) {
  const navItems = allNavItems.filter((item) => item.roles.includes(role));

  function isActive(item: typeof allNavItems[number]) {
    const href = `/${locale}/${item.path}`;
    if (item.exact) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <>
      <a href={`/${locale}`} className="flex items-center mb-10">
        <img src="/logo.png" alt="NeuroFax-B" className="h-10" />
      </a>

      <nav className="flex flex-col gap-1.5 flex-1">
        {navItems.map((item) => {
          const active = isActive(item);
          return (
            <a
              key={item.key}
              href={`/${locale}/${item.path}`}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {t(item.key)}
            </a>
          );
        })}
      </nav>

      <form action="/api/auth/signout" method="POST">
        <Button
          type="submit"
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          {t("logout")}
        </Button>
      </form>
    </>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role || "DOCTOR";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [newLeadsCount, setNewLeadsCount] = useState(0);
  const [showSearch, setShowSearch] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/leads?countNew=true");
      if (res.ok) {
        const data = await res.json();
        setNewLeadsCount(data.count || 0);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 10000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  // Cmd+K shortcut
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === "Escape") setShowSearch(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="flex min-h-screen bg-secondary/30">
      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center justify-between border-b border-border/40 bg-white px-4 md:hidden">
        <a href={`/${locale}`} className="flex items-center">
          <img src="/logo.png" alt="NeuroFax-B" className="h-8" />
        </a>
        <div className="flex items-center gap-1">
          <a href={`/${locale}/dashboard/leads`} className="relative flex h-9 w-9 items-center justify-center rounded-lg hover:bg-secondary">
            <Bell className="h-5 w-5" />
            {newLeadsCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {newLeadsCount}
              </span>
            )}
          </a>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-secondary"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 flex flex-col bg-white p-6">
            <SidebarContent t={t} locale={locale} pathname={pathname} role={role} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-col border-r border-border/40 bg-white p-6 md:flex">
        <SidebarContent t={t} locale={locale} pathname={pathname} role={role} />
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Desktop top bar */}
        <div className="hidden md:flex items-center justify-end gap-3 px-10 pt-6 pb-0">
          <button
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-2 rounded-xl border border-border/60 bg-white px-4 py-2 text-sm text-muted-foreground hover:bg-secondary/50 transition-colors"
          >
            <Search className="h-4 w-4" />
            <span>{locale === "ru" ? "Поиск..." : "Qidirish..."}</span>
            <kbd className="ml-4 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-mono">⌘K</kbd>
          </button>
          <a href={`/${locale}/dashboard/leads`} className="relative flex h-9 w-9 items-center justify-center rounded-xl hover:bg-secondary transition-colors">
            <Bell className="h-5 w-5 text-muted-foreground" />
            {newLeadsCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {newLeadsCount}
              </span>
            )}
          </a>
        </div>

        <main className="flex-1 p-6 pt-20 md:px-10 md:py-6">
          {children}
        </main>
      </div>

      {/* Global search modal */}
      {showSearch && <GlobalSearch locale={locale} onClose={() => setShowSearch(false)} />}
    </div>
  );
}

function GlobalSearch({ locale, onClose }: { locale: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{
    patients: { id: string; fullName: string; phone: string }[];
    leads: { id: string; name: string; phone: string; status: string }[];
  }>({ patients: [], leads: [] });

  useEffect(() => {
    if (query.length < 2) { setResults({ patients: [], leads: [] }); return; }
    const timeout = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (res.ok) setResults(await res.json());
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const hasResults = results.patients.length > 0 || results.leads.length > 0;
  const isRu = locale === "ru";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl mx-4 overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border/40 px-4">
          <Search className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isRu ? "Поиск пациентов, заявок..." : "Bemorlar, so'rovlar qidirish..."}
            className="w-full py-4 text-sm outline-none bg-transparent"
          />
          <kbd className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">ESC</kbd>
        </div>

        {hasResults && (
          <div className="max-h-[50vh] overflow-y-auto p-2">
            {results.patients.length > 0 && (
              <>
                <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {isRu ? "Пациенты" : "Bemorlar"}
                </p>
                {results.patients.map((p) => (
                  <a
                    key={p.id}
                    href={`/${locale}/dashboard/patients/${p.id}`}
                    onClick={onClose}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {p.fullName.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{p.fullName}</p>
                      <p className="text-xs text-muted-foreground">{p.phone}</p>
                    </div>
                  </a>
                ))}
              </>
            )}
            {results.leads.length > 0 && (
              <>
                <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-1">
                  {isRu ? "Заявки" : "So'rovlar"}
                </p>
                {results.leads.map((l) => (
                  <a
                    key={l.id}
                    href={`/${locale}/dashboard/leads`}
                    onClick={onClose}
                    className="flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-secondary/50 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium">{l.name}</p>
                      <p className="text-xs text-muted-foreground">{l.phone}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-lg font-medium ${
                      l.status === "NEW" ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"
                    }`}>{l.status}</span>
                  </a>
                ))}
              </>
            )}
          </div>
        )}

        {query.length >= 2 && !hasResults && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {isRu ? "Ничего не найдено" : "Hech narsa topilmadi"}
          </div>
        )}
      </div>
    </div>
  );
}
