import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { DoctorsProvider } from "@/components/providers/doctors-provider";
import { getDoctors } from "@/lib/doctors";

export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const doctors = await getDoctors();

  return (
    <DoctorsProvider doctors={doctors}>
      {/* Clinic brand blue for the public site only — see .site-brand in globals.css */}
      <div className="site-brand">
        <Header />
        {children}
        <Footer />
      </div>
    </DoctorsProvider>
  );
}
