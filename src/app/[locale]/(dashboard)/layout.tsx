import { SessionProvider } from "next-auth/react";
import { DoctorsProvider } from "@/components/providers/doctors-provider";
import { getDoctors } from "@/lib/doctors";

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const doctors = await getDoctors();

  return (
    <SessionProvider>
      <DoctorsProvider doctors={doctors}>
        {children}
      </DoctorsProvider>
    </SessionProvider>
  );
}
