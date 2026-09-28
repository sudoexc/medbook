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
 * next-intl provider reaches it. The words for a link that shows nothing
 * are built here in both languages and handed to the client view.
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
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <QueueStatusView
      token={token}
      copy={{ ru: linkCopy("ru"), uz: linkCopy("uz") }}
    />
  );
}
