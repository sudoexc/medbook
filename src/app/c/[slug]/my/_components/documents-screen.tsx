"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  MButton,
  MCard,
  MEmpty,
  MSection,
  MSpinner,
} from "./mini-ui";
import { useT } from "./mini-i18n";
import { useDocuments } from "../_hooks/use-documents";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

export function DocumentsScreen() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const docs = useDocuments();
  const tg = useTelegramWebApp();

  React.useEffect(() => {
    const off = tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
    return off;
  }, [tg, router, clinicSlug]);

  React.useEffect(() => {
    const off = tg.setMainButton({ visible: false });
    return off;
  }, [tg]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">{t.documents.title}</h1>
      {docs.isLoading ? (
        <MSpinner />
      ) : docs.data && docs.data.length > 0 ? (
        <MSection>
          {docs.data.map((d) => (
            <MCard key={d.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{d.title}</div>
                  <div
                    className="mt-0.5 text-xs"
                    style={{ color: "var(--tg-hint)" }}
                  >
                    {t.documents.types[d.type as keyof typeof t.documents.types] ?? t.documents.types.OTHER}
                  </div>
                  <div
                    className="mt-1 text-xs"
                    style={{ color: "var(--tg-hint)" }}
                  >
                    {t.documents.uploadedOn.replace(
                      "{date}",
                      new Date(d.createdAt).toLocaleDateString(
                        lang === "UZ" ? "uz-Latn-UZ" : "ru-RU",
                      ),
                    )}
                  </div>
                </div>
                <div>
                  {d.fileUrl && !d.fileUrl.startsWith("pending:") ? (
                    <a href={d.fileUrl} target="_blank" rel="noreferrer">
                      <MButton variant="secondary">{t.documents.open}</MButton>
                    </a>
                  ) : (
                    <MButton variant="ghost" disabled>
                      {t.documents.open}
                    </MButton>
                  )}
                </div>
              </div>
            </MCard>
          ))}
        </MSection>
      ) : (
        <MEmpty>{t.documents.empty}</MEmpty>
      )}
    </div>
  );
}
