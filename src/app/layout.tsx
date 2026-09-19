import type { Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";

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

// Inline FOUC-prevention: must run before paint via dangerouslySetInnerHTML
// (React 19 warns when scripts are rendered as React children).
// Default to light unless the user explicitly chose dark or system+OS-dark.
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(d){r.classList.add('dark');r.style.colorScheme='dark'}else{r.style.colorScheme='light'}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ru"
      suppressHydrationWarning
      className={`${inter.variable} h-full antialiased scroll-smooth`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ThemeProvider>
          {children}
          <Toaster position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
