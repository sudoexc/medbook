"use client";

import { useTranslations } from "next-intl";
import { AlertTriangleIcon, LockIcon } from "lucide-react";

import { EmptyState } from "@/components/atoms/empty-state";

import { CallsLoadError } from "../_hooks/use-incoming-calls";

/**
 * A call list that failed to load says so (audit CM-08): a 403 used to
 * read «Сейчас тихо», and the operator believed nobody was calling.
 */
export function CallsErrorState({ error }: { error: Error }) {
  const t = useTranslations("callCenter.errors");
  const forbidden = error instanceof CallsLoadError && error.status === 403;
  return (
    <div className="flex h-full items-center justify-center px-3 py-6">
      <EmptyState
        icon={forbidden ? <LockIcon /> : <AlertTriangleIcon />}
        title={forbidden ? t("forbiddenTitle") : t("loadFailedTitle")}
        description={
          forbidden ? t("forbiddenDescription") : t("loadFailedDescription")
        }
        className="border-none bg-transparent px-2 py-4"
      />
    </div>
  );
}
