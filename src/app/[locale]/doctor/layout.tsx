import * as React from "react";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { QueryProvider } from "@/components/providers/query-provider";

import { DoctorSidebar } from "./_components/doctor-sidebar";
import { DoctorTopbar } from "./_components/doctor-topbar";

// Doctor cabinet is LIVE — unpaused on prod (DOCTOR_CABINET_ENABLED=1). All
// unpause blockers are closed: P0.1 fake data removed (visit screens read real
// data), P0.2 2FA-over-/api enforced via enforceTotpEnrollment in api-handler.ts,
// P0.3 audit wired for DOCTOR_CABINET surfaces. The env gate below is kept as a
// kill-switch; per _ROADMAP.md it's removed only after a sustained green window.
// Unset DOCTOR_CABINET_ENABLED (or set it != "1") to re-pause and bounce to /crm.
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
  if (process.env.DOCTOR_CABINET_ENABLED !== "1") {
    redirect(`/${locale}/crm?notice=doctor_cabinet_paused`);
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
