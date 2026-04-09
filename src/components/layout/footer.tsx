import { useTranslations } from "next-intl";
import Image from "next/image";
import { Send, Camera, Clock } from "lucide-react";
import { CONTACT, SITE_NAME } from "@/lib/constants";

export function Footer() {
  const t = useTranslations("footer");
  const tNav = useTranslations("nav");

  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-3">
            <a href="/" className="block">
              <Image
                src="/logo.png"
                alt="NeuroFax-B"
                width={92}
                height={36}
                className="h-9 w-auto"
              />
            </a>
            <p className="text-sm text-muted-foreground max-w-[240px]">
              {t("description")}
            </p>
            <div className="flex gap-2">
              {CONTACT.telegram !== "#" && (
                <a
                  href={CONTACT.telegram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Telegram"
                >
                  <Send className="h-4 w-4" />
                </a>
              )}
              {CONTACT.instagram !== "#" && (
                <a
                  href={CONTACT.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Instagram"
                >
                  <Camera className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("navigation")}
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li><a href="#doctors" className="text-muted-foreground hover:text-foreground transition-colors">{tNav("doctors")}</a></li>
              <li><a href="#services" className="text-muted-foreground hover:text-foreground transition-colors">{tNav("services")}</a></li>
              <li><a href="#about" className="text-muted-foreground hover:text-foreground transition-colors">{tNav("about")}</a></li>
              <li><a href="#faq" className="text-muted-foreground hover:text-foreground transition-colors">{tNav("faq")}</a></li>
            </ul>
          </div>

          {/* Contacts */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("contacts")}
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a href={`tel:${CONTACT.phone.replace(/\s/g, "")}`} className="text-muted-foreground hover:text-foreground transition-colors">
                  {CONTACT.phone}
                </a>
              </li>
              <li>
                <a href={`mailto:${CONTACT.email}`} className="text-muted-foreground hover:text-foreground transition-colors">
                  {CONTACT.email}
                </a>
              </li>
              {CONTACT.telegram !== "#" && (
                <li>
                  <a href={CONTACT.telegram} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                    Telegram
                  </a>
                </li>
              )}
            </ul>
          </div>

          {/* Working hours */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("workingHours")}
            </h3>
            <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("workingHoursValue")}</span>
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} {SITE_NAME}. {t("rights")}.
          </p>
          <div className="flex gap-6 text-xs text-muted-foreground">
            <a href="#" className="hover:text-foreground transition-colors">{t("privacy")}</a>
            <a href="#" className="hover:text-foreground transition-colors">{t("terms")}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
