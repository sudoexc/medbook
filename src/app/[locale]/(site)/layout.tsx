import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { DoctorsProvider } from "@/components/providers/doctors-provider";
import { getDoctors } from "@/lib/doctors";

// The whole public subtree reads doctors from the DB per request. Without
// this, `next build` prerenders these pages inside the Docker builder where
// no database exists and the build dies collecting page data.
export const dynamic = "force-dynamic";

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
