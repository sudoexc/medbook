import type { Metadata, Viewport } from "next";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { PageContainer } from "@/components/molecules/page-container";
import {
  canUseReceptionTablet,
  receptionTabletManifestUrl,
} from "@/lib/reception-tablet/access";

import { TabletApp } from "./_components/tablet-app";

/**
 * `/crm/reception/tablet` — the reception on the clinic's iPad Pro 12.9"
 * (1024 × 1366 portrait, 1366 × 1024 landscape, Safari, touch only): the
 * receptionist walks around the clinic with it, puts people into doctors'
 * queues and books them. Everything goes through the desk's own APIs
 * (walk-in, patients, booking, queue-status), so the identity, ticket and
 * time rules are the desktop reception's.
 *
 * The page carries the web app manifest and the Apple tags, so «Добавить на
 * экран Домой» on the iPad opens it full screen; the rest of the CRM does
 * not.
 */

// `viewport-fit=cover` so the safe-area insets are real numbers in the
// standalone window (the home indicator sits over the bottom bar otherwise).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "receptionTablet" });
  return {
    title: t("metaTitle"),
    manifest: receptionTabletManifestUrl(locale),
    appleWebApp: {
      capable: true,
      title: t("title"),
      statusBarStyle: "default",
    },
    icons: {
      apple: [{ url: "/reception-tablet/icon-180.png", sizes: "180x180", type: "image/png" }],
    },
    // Older iPadOS reads only the Apple spelling of «open full screen».
    other: { "apple-mobile-web-app-capable": "yes" },
    robots: { index: false, follow: false },
  };
}

export default async function ReceptionTabletPage() {
  const session = await auth();
  if (!canUseReceptionTablet(session?.user?.role)) {
    const t = await getTranslations("receptionTablet");
    return (
      <PageContainer>
        <div className="flex flex-col items-start gap-4 rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">{t("forbidden")}</p>
          <Link href="/crm" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {t("forbiddenBack")}
          </Link>
        </div>
      </PageContainer>
    );
  }
  return <TabletApp />;
}
