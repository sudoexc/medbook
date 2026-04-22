"use client";

import { useT } from "./mini-i18n";
import { useClinic } from "../_hooks/use-clinic";
import { useMiniAppAuth } from "./miniapp-auth-provider";

export function OpenInTelegramFallback() {
  const t = useT();
  const { clinicSlug } = useMiniAppAuth();
  const { data: clinic } = useClinic(clinicSlug);
  const botUrl = clinic?.tgBotUsername
    ? `https://t.me/${clinic.tgBotUsername}`
    : null;
  return (
    <div
      className="mt-8 rounded-2xl p-6 text-center"
      style={{
        backgroundColor: "var(--tg-section-bg)",
        color: "var(--tg-text)",
      }}
    >
      <div
        className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full"
        style={{ backgroundColor: "var(--tg-accent)", color: "#fff" }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-7 w-7"
          aria-hidden
        >
          <path
            d="M21.9 4.5 18.3 20c-.3 1.2-1 1.5-2 .9l-5.5-4-2.7 2.5c-.3.3-.5.5-1 .5l.4-5.6 10-9c.4-.4-.1-.6-.7-.2L4.5 10.6l-5.3-1.7c-1.2-.4-1.2-1.2.2-1.8L20.6 2.8c.9-.3 1.7.2 1.3 1.7Z"
            fill="currentColor"
          />
        </svg>
      </div>
      <h2 className="mb-2 text-lg font-semibold">{t.common.openInTelegram}</h2>
      <p className="text-sm" style={{ color: "var(--tg-hint)" }}>
        {t.common.openInTelegramHint}
      </p>
      {botUrl ? (
        <a
          className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-white"
          href={botUrl}
          style={{ backgroundColor: "var(--tg-accent)" }}
        >
          @{clinic?.tgBotUsername}
        </a>
      ) : null}
    </div>
  );
}
