import * as React from "react";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { QueryProvider } from "@/components/providers/query-provider";

import { DoctorSidebar } from "./_components/doctor-sidebar";
import { DoctorTopbar } from "./_components/doctor-topbar";

// Server layout guard for the doctor surface. Three rules:
//
//   1. No session → bounce to /login.
//   2. Session but role !== DOCTOR → push to /crm (the regular CRM home).
//      SUPER_ADMIN bypasses are intentionally NOT honoured here — the
//      doctor surface is data-bound to a specific Doctor row that
//      SUPER_ADMIN cannot impersonate without a real Doctor.userId link.
//   3. Role === DOCTOR but no Doctor row joined to userId → bounce to /crm
//      with an error flag so the admin can finish provisioning the user.
//
// The resolved Doctor row (name, specialization, photo) drives the topbar
// avatar + greeting without a second roundtrip from a client component.
export default async function DoctorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect(`/${locale}/login`);
  }
  if (session.user.role !== "DOCTOR") {
    redirect(`/${locale}/crm`);
  }
  if (!session.user.clinicId) {
    redirect(`/${locale}/crm?error=no_clinic`);
  }

  const doctor = await runWithTenant(
    {
      kind: "TENANT",
      clinicId: session.user.clinicId,
      userId: session.user.id,
      role: "DOCTOR",
    },
    () =>
      prisma.doctor.findFirst({
        where: { userId: session.user.id },
        select: {
          id: true,
          nameRu: true,
          specializationRu: true,
          photoUrl: true,
        },
      }),
  );

  if (!doctor) {
    redirect(`/${locale}/crm?error=doctor_profile_missing`);
  }

  return (
    <QueryProvider>
      <div className="flex h-screen min-h-0 w-full bg-background">
        <DoctorSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <DoctorTopbar
            doctorName={doctor.nameRu}
            doctorSpecialty={doctor.specializationRu}
            doctorAvatarUrl={doctor.photoUrl}
            userEmail={session.user.email}
          />
          <main className="min-h-0 flex-1 overflow-y-auto bg-surface">
            {children}
          </main>
        </div>
      </div>
    </QueryProvider>
  );
}
