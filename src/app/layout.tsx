import type { Viewport } from "next";
import { Inter } from "next/font/google";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { THEME_INIT_SCRIPT } from "@/lib/theme-scope";

// Without an explicit viewport export this custom root layout ships NO
// viewport meta at all — phones lay the site out at 980px and scale it down,
// which is exactly the "масштаб хуевый" complaint on the public landing.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
});

// Inline FOUC-prevention (THEME_INIT_SCRIPT, lib/theme-scope): must run
// before paint via dangerouslySetInnerHTML (React 19 warns when scripts are
// rendered as React children). Dark only on staff surfaces (audit LD-17).

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The request's locale, so the server HTML of /uz says lang="uz" (audit
  // LD-12): crawlers read the HTML, not the client fix-up in LocaleHtmlLang,
  // which still covers a switch of language without a reload. Routes outside
  // the locale middleware (kiosk, TV, Mini App) get the default, ru.
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${inter.variable} h-full antialiased scroll-smooth`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ThemeProvider>
          {children}
          <Toaster position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
