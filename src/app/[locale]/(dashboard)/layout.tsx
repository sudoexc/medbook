import { SessionProvider } from "next-auth/react";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { DoctorsProvider } from "@/components/providers/doctors-provider";
import { getDoctors } from "@/lib/doctors";
import { auth } from "@/lib/auth";

export default async function DashboardGroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const session = await auth();
  const { locale } = await params;
  if (!session?.user) {
    redirect(`/${locale}/login`);
  }

  const doctors = await getDoctors();

  return (
    <SessionProvider>
      <DoctorsProvider doctors={doctors}>
        {children}
        <Toaster richColors position="top-right" closeButton />
      </DoctorsProvider>
    </SessionProvider>
  );
}
