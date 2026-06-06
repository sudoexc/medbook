"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, FolderOpen, Upload } from "lucide-react";

import {
  MButton,
  MCard,
  MEmpty,
  MSection,
} from "./mini-ui";
import { SkeletonList } from "./skeleton";
import { useT } from "./mini-i18n";
import { useDocuments, useUploadDocument } from "../_hooks/use-documents";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

export function DocumentsScreen() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state, initData } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  // `<a target="_blank">` opens in a fresh tab without our custom headers,
  // so we attach init-data via query — the server's `resolveMiniAppContext`
  // already accepts it that way (precedent: SSE endpoint).
  const fileLinkParam = initData
    ? `&initData=${encodeURIComponent(initData)}`
    : "";
  const docs = useDocuments();
  const upload = useUploadDocument();
  const tg = useTelegramWebApp();

  React.useEffect(() => {
    const off = tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
    return off;
  }, [tg, router, clinicSlug]);

  React.useEffect(() => {
    const off = tg.setMainButton({ visible: false });
    return off;
  }, [tg]);

  const handleFiles = React.useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      // Guard against a click that races the TG SDK boot — without an
      // init-data header the server replies 401 and we'd show the
      // confusing "uploadErrorGeneric" toast even though it's our fault.
      if (state.status !== "ready") return;
      const file = files[0];
      try {
        await upload.mutateAsync({ file });
        tg.haptic.notification("success");
        tg.showAlert(t.documents.uploadSuccess);
      } catch (e) {
        tg.haptic.notification("error");
        const err = e as Error & { status?: number; data?: { reason?: string } };
        if (err.status === 413) tg.showAlert(t.documents.uploadErrorTooLarge);
        else if (err.status === 415) tg.showAlert(t.documents.uploadErrorMime);
        else tg.showAlert(t.documents.uploadErrorGeneric);
      }
    },
    [upload, tg, t.documents, state.status],
  );

  const disabled = upload.isPending || state.status !== "ready";

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">{t.documents.title}</h1>
      <MCard className="mb-4">
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--tg-accent)" }}>
            <Upload className="h-5 w-5" />
          </span>
          <div className="text-sm font-semibold">{t.documents.uploadCta}</div>
        </div>
        <p
          className="mt-1 text-xs"
          style={{ color: "var(--tg-hint)" }}
        >
          {t.documents.uploadHint}
        </p>
        {/*
          `<label htmlFor>` instead of `<button onClick={ref.current.click()}>`:
          programmatic `.click()` on a hidden file input loses the user-gesture
          context in iOS WebViews (especially third-party Telegram clients like
          iMe), so the file picker silently never opens — exactly the symptom
          we hit on iPhone. A label-for-input click is a native browser path
          that doesn't need a JS-synthesised gesture.
        */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label
            htmlFor="miniapp-upload-camera"
            className="flex cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98]"
            style={{
              backgroundColor: "var(--tg-accent)",
              color: "#fff",
              opacity: disabled ? 0.6 : 1,
              pointerEvents: disabled ? "none" : "auto",
            }}
          >
            <Camera className="h-4 w-4" />
            {upload.isPending ? t.documents.uploading : t.documents.uploadCamera}
          </label>
          <label
            htmlFor="miniapp-upload-file"
            className="flex cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98]"
            style={{
              backgroundColor: "color-mix(in oklch, var(--tg-accent) 12%, transparent)",
              color: "var(--tg-accent)",
              opacity: disabled ? 0.6 : 1,
              pointerEvents: disabled ? "none" : "auto",
            }}
          >
            <FolderOpen className="h-4 w-4" />
            {upload.isPending ? t.documents.uploading : t.documents.uploadFile}
          </label>
        </div>
        <input
          id="miniapp-upload-camera"
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const files = e.target.files;
            e.target.value = "";
            tg.haptic.selection();
            void handleFiles(files);
          }}
        />
        <input
          id="miniapp-upload-file"
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          onChange={(e) => {
            const files = e.target.files;
            e.target.value = "";
            tg.haptic.selection();
            void handleFiles(files);
          }}
        />
      </MCard>
      {docs.isLoading ? (
        <SkeletonList rows={4} variant="card" />
      ) : docs.data && docs.data.length > 0 ? (
        <MSection>
          {docs.data.map((d) => {
            const isPending = !d.fileUrl || d.fileUrl.startsWith("pending:");
            return (
              <MCard key={d.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {isPending ? (
                        <span
                          aria-hidden
                          className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full"
                          style={{ backgroundColor: "#f59e0b" }}
                        />
                      ) : null}
                      <div className="truncate text-sm font-semibold">{d.title}</div>
                    </div>
                    <div
                      className="mt-0.5 text-xs"
                      style={{ color: "var(--tg-hint)" }}
                    >
                      {t.documents.types[d.type as keyof typeof t.documents.types] ?? t.documents.types.OTHER}
                    </div>
                    <div
                      className="mt-1 text-xs"
                      style={{ color: isPending ? "#b45309" : "var(--tg-hint)" }}
                    >
                      {isPending
                        ? t.documents.pending
                        : t.documents.uploadedOn.replace(
                            "{date}",
                            new Date(d.createdAt).toLocaleDateString(
                              lang === "UZ" ? "uz-Latn-UZ" : "ru-RU",
                            ),
                          )}
                    </div>
                  </div>
                  <div>
                    {!isPending ? (
                      <a
                        href={`${d.fileUrl}${fileLinkParam}`}
                        target="_blank"
                        rel="noreferrer"
                      >
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
            );
          })}
        </MSection>
      ) : (
        <MEmpty icon={FolderOpen}>{t.documents.empty}</MEmpty>
      )}
    </div>
  );
}
