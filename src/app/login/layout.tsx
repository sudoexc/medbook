/**
 * /login and /login/2fa live outside the [locale] segment (the proxy and every
 * "please sign in" redirect point at the bare /login), so no next-intl
 * provider reaches them. This layout supplies one, in the language the browser
 * last used (the NEXT_LOCALE cookie, re-seeded from the staff preference at
 * every sign-in), with only the login namespaces on the wire.
 */
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

export default async function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const store = await cookies();
  const locale = store.get("NEXT_LOCALE")?.value === "uz" ? "uz" : "ru";
  const all = locale === "uz" ? uz : ru;
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ login: all.login, login2fa: all.login2fa }}
    >
      {children}
    </NextIntlClientProvider>
  );
}
