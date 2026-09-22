"use client";

/**
 * Packaging-photo upload, shown inside the drug card.
 *
 * Wave 1 of «фото как в аптеке»: the clinic fills its own working set (a few
 * dozen drugs it actually dispenses) instead of us scraping a pharmacy
 * site. Files land in our own bucket through
 * POST /api/crm/catalogs/drugs/[id]/photo.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlusIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

export function DrugPhotoUpload({
  drugId,
  photoUrl,
  onChanged,
}: {
  drugId: string;
  photoUrl: string | null | undefined;
  onChanged: (next: string | null) => void;
}) {
  const t = useTranslations("doctor.references");
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refreshLists = () => {
    void qc.invalidateQueries({
      queryKey: ["doctor", "references", "drug-catalog"],
    });
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      // Content-Type is deliberately NOT set: the browser must add the
      // multipart boundary itself.
      const res = await fetch(`/api/crm/catalogs/drugs/${drugId}/photo`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(
          j?.error === "PhotoTooLarge"
            ? t("drugs.photoTooLarge")
            : j?.error === "PhotoMimeUnsupported"
              ? t("drugs.photoBadType")
              : t("drugs.photoFailed"),
        );
        return;
      }
      const j = (await res.json()) as { photoUrl: string };
      onChanged(j.photoUrl);
      refreshLists();
      toast.success(t("drugs.photoSaved"));
    } finally {
      setBusy(false);
      // Clear the input so re-picking the same file fires onChange again.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/catalogs/drugs/${drugId}/photo`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        toast.error(t("drugs.photoFailed"));
        return;
      }
      onChanged(null);
      refreshLists();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 border-t px-4 py-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          // iOS clears the FileList asynchronously — grab the file now.
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
      >
        {busy ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <ImagePlusIcon className="size-3.5" />
        )}
        {photoUrl ? t("drugs.photoReplace") : t("drugs.photoAdd")}
      </button>
      {photoUrl ? (
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-60"
        >
          <Trash2Icon className="size-3.5" />
          {t("drugs.photoRemove")}
        </button>
      ) : null}
      <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">
        {t("drugs.photoHint")}
      </span>
    </div>
  );
}
