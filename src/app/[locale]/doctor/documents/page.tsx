import { DocumentAiPanel } from "./_components/document-ai-panel";
import { DocumentPreviewCard } from "./_components/document-preview-card";
import { DocumentsFilters } from "./_components/documents-filters";
import { DocumentsHeader } from "./_components/documents-header";
import { DocumentsTable } from "./_components/documents-table";
import { WidgetCards } from "./_components/widget-cards";

export default function DocumentsPage() {
  return (
    <div className="flex gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4 xl:gap-5">
        <DocumentsHeader />
        <DocumentsFilters />
        <WidgetCards />
        <DocumentsTable />
      </div>

      <aside className="hidden w-[340px] shrink-0 flex-col gap-4 xl:flex xl:gap-5">
        <DocumentPreviewCard />
        <DocumentAiPanel />
      </aside>
    </div>
  );
}
