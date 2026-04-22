"use client";

import { MButton, MCard, MSection } from "./mini-ui";
import { useT } from "./mini-i18n";
import { useUpdateProfile } from "../_hooks/use-profile";

export function LanguagePickerScreen() {
  const t = useT();
  const update = useUpdateProfile();
  return (
    <div className="pt-4">
      <MSection title={t.lang.picker}>
        <MCard className="space-y-3">
          <MButton
            block
            variant="primary"
            onClick={() => update.mutate({ lang: "RU" })}
            disabled={update.isPending}
          >
            {t.lang.ru}
          </MButton>
          <MButton
            block
            variant="secondary"
            onClick={() => update.mutate({ lang: "UZ" })}
            disabled={update.isPending}
          >
            {t.lang.uz}
          </MButton>
        </MCard>
      </MSection>
    </div>
  );
}
