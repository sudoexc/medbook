"use client";

/**
 * Both languages on the waiting-room TVs (audit UX-06).
 *
 * A TV serves every patient in the hall at once, so its static labels are
 * shown in Russian and Uzbek side by side rather than switched by a locale.
 * `/tv` lives outside the [locale] segment and has no next-intl provider;
 * the layout hands this provider only the `tvBoard` namespace of each
 * language and it builds one translator per language.
 */

import * as React from "react";
import { createTranslator } from "next-intl";

import type ruMessages from "@/messages/ru.json";
import type { BoardLang, BoardTranslator } from "@/lib/tv-announce";

export type TvBoardMessages = (typeof ruMessages)["tvBoard"];
export type TvTranslators = Record<BoardLang, BoardTranslator>;

const TvI18nContext = React.createContext<TvTranslators | null>(null);

function translatorFor(locale: BoardLang, messages: TvBoardMessages): BoardTranslator {
  const t = createTranslator({
    locale,
    messages: { tvBoard: messages },
    namespace: "tvBoard",
  });
  // Keys are composed at call sites (slot statuses); the bundle parity test
  // keeps both languages complete.
  return (key, values) => (t as unknown as BoardTranslator)(key, values);
}

export function TvI18nProvider({
  messages,
  children,
}: {
  messages: Record<BoardLang, TvBoardMessages>;
  children: React.ReactNode;
}) {
  const value = React.useMemo<TvTranslators>(
    () => ({
      ru: translatorFor("ru", messages.ru),
      uz: translatorFor("uz", messages.uz),
    }),
    [messages],
  );
  return <TvI18nContext.Provider value={value}>{children}</TvI18nContext.Provider>;
}

export function useTvTranslators(): TvTranslators {
  const ctx = React.useContext(TvI18nContext);
  if (!ctx) throw new Error("useTvTranslators outside TvI18nProvider");
  return ctx;
}

/**
 * A static label in both languages: Russian, then Uzbek. `stacked` puts the
 * Uzbek line under the Russian one (big headings, narrow portrait rows);
 * inline it follows after a dot, a shade lighter.
 */
export function Bi({
  k,
  values,
  stacked = false,
  uzClassName = "",
  uzStyle,
}: {
  k: string;
  values?: Record<string, string>;
  stacked?: boolean;
  uzClassName?: string;
  uzStyle?: React.CSSProperties;
}) {
  const t = useTvTranslators();
  const ru = t.ru(k, values);
  const uz = t.uz(k, values);
  if (stacked) {
    return (
      <>
        <span className="block">{ru}</span>
        <span className={`block ${uzClassName}`} style={uzStyle}>
          {uz}
        </span>
      </>
    );
  }
  return (
    <>
      {ru}
      <span className={uzClassName} style={{ opacity: 0.75, ...uzStyle }}>
        {" · "}
        {uz}
      </span>
    </>
  );
}
