import { createTranslator } from "next-intl";

import type { Locale } from "@/lib/format";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";
import {
  QueueStatusView,
  type QueueLinkCopy,
} from "./_components/queue-status-view";

/**
 * `/q/<ticket token>`: the live queue behind the QR on a paper ticket.
 *
 * Lives outside the [locale] segment (the QR carries a bare path), so no
 * next-intl provider reaches it. The page ships only the `queueStatusPage`
 * namespace of both languages to the client view, which opens in the
 * ticket's language (`?lang=`) or the patient's own (UX-06). The words for a
 * link that shows nothing (INF-10) are built here in both languages too.
 */
function linkCopy(locale: Locale): QueueLinkCopy {
  const t = createTranslator({
    locale,
    messages: locale === "uz" ? uz : ru,
    namespace: "ticketStub",
  });
  return {
    notFound: t("notFound"),
    expired: t("linkExpired"),
    expiredHint: t("linkExpiredHint"),
    notToday: t("linkNotToday"),
    notTodayHint: t("linkNotTodayHint"),
    legacy: t("linkLegacy"),
    legacyHint: t("linkLegacyHint"),
  };
}

export default async function QueueStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const raw = (await searchParams)?.lang;
  const lang = Array.isArray(raw) ? raw[0] : raw;
  return (
    <QueueStatusView
      token={token}
      forcedLang={lang === "uz" || lang === "ru" ? lang : null}
      messages={{ ru: ru.queueStatusPage, uz: uz.queueStatusPage }}
      copy={{ ru: linkCopy("ru"), uz: linkCopy("uz") }}
    />
  );
}
