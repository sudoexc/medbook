import { ConstructionIcon } from "lucide-react";

export function PlaceholderPage({
  title,
  description = "Этот раздел в разработке. Скоро здесь появятся данные.",
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border bg-card px-8 py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ConstructionIcon className="size-6" />
        </span>
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
