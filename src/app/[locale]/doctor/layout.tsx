import * as React from "react";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { QueryProvider } from "@/components/providers/query-provider";

import { DoctorSidebar } from "./_components/doctor-sidebar";
import { DoctorTopbar } from "./_components/doctor-topbar";

// Doctor cabinet is paused (priority pivot 2026-05-18, feature freeze 2026-05-22).
// The P0.1 fake-data blocker is resolved — the live visit screens now read real
// data (last-visit / last-diagnosis via useDoctorPatientVisits, meta chips via
// real allergies/chronic, AI rail via patient-segments). Other unpause blockers
// (P0.2 2FA-over-/api, P0.3 audit) remain, so we still bounce everyone to /crm.
// Flip DOCTOR_CABINET_ENABLED=1 in env to re-enable for dev/preview.
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
