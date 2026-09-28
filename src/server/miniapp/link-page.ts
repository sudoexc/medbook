/**
 * What a patient sees when a Mini App link (a document, the calendar file)
 * is opened after it expired (audit MA-07). The link was opened in a
 * browser, so a JSON 401 would be a page of code; an expired link is the
 * normal case, and the app mints a fresh one on return. Both languages: the
 * link no longer tells us whose it was.
 */
import { createTranslator } from "next-intl";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function expiredMiniAppLinkPage(status: number): Response {
  const lines = (["ru", "uz"] as const).map((locale) => {
    const t = createTranslator({
      locale,
      messages: locale === "uz" ? uz : ru,
      namespace: "documents",
    });
    return `<h1>${esc(t("patientLinkTitle"))}</h1><p>${esc(t("patientLinkExpired"))}</p>`;
  });
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(
    createTranslator({ locale: "ru", messages: ru, namespace: "documents" })(
      "patientLinkTitle",
    ),
  )}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:40px 20px;text-align:center;color:#444}h1{font-size:18px;margin:24px 0 6px}p{margin:0}</style></head><body>${lines.join("")}</body></html>`;
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
