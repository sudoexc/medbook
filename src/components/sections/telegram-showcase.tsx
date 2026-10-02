import { useTranslations } from "next-intl";
import { BellIcon, CheckIcon, FileTextIcon, SendIcon } from "lucide-react";

import { CONTACT } from "@/lib/constants";

/**
 * The clinic's real differentiator, sold as such: after the visit the doctor
 * sends the conclusion, prescriptions and reminders straight to the
 * patient's Telegram. Everything in the phone mockup mirrors what the bot
 * actually delivers — a PDF document, the handout text, visit reminders.
 * Flat CSS mockup, no imagery, single accent.
 */
export function TelegramShowcase() {
  const t = useTranslations("tgShowcase");

  const points = [t("p1"), t("p2"), t("p3")];

  return (
    <section className="border-t border-border bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 className="max-w-lg text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              {t("title")}
            </h2>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">
              {t("lead")}
            </p>
            <ul className="mt-8 space-y-4">
              {points.map((p) => (
                <li key={p} className="flex items-start gap-3 text-base text-foreground">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <CheckIcon className="h-3.5 w-3.5" />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
            {/* The way into the bot the section sells (audit LD-16). */}
            <a
              href={CONTACT.telegram}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <SendIcon className="h-4 w-4" />
              {t("cta")}
            </a>
          </div>

          {/* Phone mockup — plain CSS, mirrors the bot's actual messages. */}
          <div className="flex justify-center lg:justify-end">
            <div className="w-full max-w-[340px] rounded-[2.5rem] border-[6px] border-foreground/85 bg-white p-2 shadow-sm">
              <div className="overflow-hidden rounded-[2rem] bg-[#f4f8fc]">
                <div className="flex items-center gap-3 border-b border-border bg-white px-4 py-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    N
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {t("chatName")}
                    </p>
                    <a
                      href={CONTACT.telegram}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-primary"
                    >
                      {t("botHandle")}
                    </a>
                  </div>
                </div>

                <div className="space-y-2.5 px-3 py-4">
                  <div className="flex max-w-[85%] items-center gap-3 rounded-2xl rounded-tl-md border border-border bg-white px-3 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <FileTextIcon className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {t("chatFile")}
                    </span>
                  </div>
                  <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-border bg-white px-3 py-2.5 text-sm leading-snug text-foreground">
                    {t("chatMsg")}
                  </div>
                  <div className="flex max-w-[85%] items-start gap-2.5 rounded-2xl rounded-tl-md border border-border bg-white px-3 py-2.5">
                    <BellIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-sm leading-snug text-foreground">
                      {t("chatReminder")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
