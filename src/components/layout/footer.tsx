import { useTranslations } from "next-intl";
import { Stethoscope, Send, Camera } from "lucide-react";
import { CONTACT, SITE_NAME } from "@/lib/constants";

export function Footer() {
  const t = useTranslations("footer");

  return (
    <footer className="border-t border-border/40 bg-foreground/[0.02]">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 py-16">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-5 lg:col-span-1">
            <a href="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-md shadow-primary/20">
                <Stethoscope className="h-5 w-5 text-white" />
              </div>
              <span className="text-[22px] font-extrabold tracking-tight">
                Med<span className="text-primary">Book</span>
              </span>
            </a>
            <p className="text-sm leading-relaxed text-muted-foreground max-w-[260px]">
              {t("description")}
            </p>
            <div className="flex gap-2.5">
              <a
                href={CONTACT.telegram}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/[0.04] transition-all hover:bg-primary/10 hover:text-primary"
                aria-label="Telegram"
              >
                <Send className="h-[18px] w-[18px]" />
              </a>
              <a
                href={CONTACT.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/[0.04] transition-all hover:bg-primary/10 hover:text-primary"
                aria-label="Instagram"
              >
                <Camera className="h-[18px] w-[18px]" />
              </a>
            </div>
          </div>

          {/* Patients */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground/40">
              {t("patients")}
            </h3>
            <ul className="mt-5 space-y-3.5 text-sm">
              <li><a href="#" className="text-muted-foreground hover:text-foreground transition-colors">{t("findDoctor")}</a></li>
              <li><a href="#how-it-works" className="text-muted-foreground hover:text-foreground transition-colors">{t("howItWorksLink")}</a></li>
              <li><a href="#specialties" className="text-muted-foreground hover:text-foreground transition-colors">{t("specialtiesLink")}</a></li>
            </ul>
          </div>

          {/* Doctors */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground/40">
              {t("doctors")}
            </h3>
            <ul className="mt-5 space-y-3.5 text-sm">
              <li><a href="#for-doctors" className="text-muted-foreground hover:text-foreground transition-colors">{t("connectClinic")}</a></li>
              <li><a href="#for-doctors" className="text-muted-foreground hover:text-foreground transition-colors">{t("forDoctorsLink")}</a></li>
            </ul>
          </div>

          {/* Contacts */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground/40">
              {t("contacts")}
            </h3>
            <ul className="mt-5 space-y-3.5 text-sm">
              <li>
                <a href={`tel:${CONTACT.phone.replace(/\s/g, "")}`} className="text-muted-foreground hover:text-foreground transition-colors font-medium">
                  {CONTACT.phone}
                </a>
              </li>
              <li>
                <a href={`mailto:${CONTACT.email}`} className="text-muted-foreground hover:text-foreground transition-colors">
                  {CONTACT.email}
                </a>
              </li>
              <li>
                <a href={CONTACT.telegram} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                  Telegram
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-border/40 pt-8 sm:flex-row">
          <p className="text-xs text-muted-foreground/60">
            &copy; {new Date().getFullYear()} {SITE_NAME}. {t("rights")}.
          </p>
          <div className="flex gap-8 text-xs text-muted-foreground/60">
            <a href="#" className="hover:text-foreground transition-colors">{t("privacy")}</a>
            <a href="#" className="hover:text-foreground transition-colors">{t("terms")}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
