import * as React from "react";

import { auth } from "@/lib/auth";
import { QueryProvider } from "@/components/providers/query-provider";

import { DoctorSidebar } from "./_components/doctor-sidebar";
import { DoctorTopbar } from "./_components/doctor-topbar";

export default async function DoctorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Phase 1 — UI shell with mocks. Real doctor profile (name, specialty, avatar)
  // is wired from `Doctor` table by `userId` in the data phase.
  const doctorName = session?.user?.name ?? "Д-р Рахимов Б.И.";
  const doctorSpecialty = "Невролог";

  return (
    <QueryProvider>
      <div className="flex h-screen min-h-0 w-full bg-background">
        <DoctorSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <DoctorTopbar
            doctorName={doctorName}
            doctorSpecialty={doctorSpecialty}
          />
          <main className="min-h-0 flex-1 overflow-y-auto bg-surface">
            {children}
          </main>
        </div>
      </div>
    </QueryProvider>
  );
}
