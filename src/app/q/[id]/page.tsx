/**
 * `/q/<id>` — the patient's live queue status behind the ticket's QR.
 *
 * Lives outside the [locale] segment (the printed QR carries a bare path),
 * so no next-intl provider reaches it. The page ships only the
 * `queueStatusPage` namespace of both languages to the client view, which
 * opens in the ticket's language (`?lang=`) or the patient's own (UX-06).
 */
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

import { QueueStatusView } from "./_components/queue-status-view";

export default async function QueueStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const raw = (await searchParams).lang;
  const lang = Array.isArray(raw) ? raw[0] : raw;
  return (
    <QueueStatusView
      id={id}
      forcedLang={lang === "uz" || lang === "ru" ? lang : null}
      messages={{ ru: ru.queueStatusPage, uz: uz.queueStatusPage }}
    />
  );
}
