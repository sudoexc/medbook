"use client";

export function PrintVisitButton({
  visitNoteId,
  children,
}: {
  visitNoteId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        window.open(
          `/api/crm/visit-notes/${visitNoteId}/print?lang=ru`,
          "_blank",
          "noopener,noreferrer",
        );
      }}
      className="motion-press inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
    >
      {children}
    </button>
  );
}
