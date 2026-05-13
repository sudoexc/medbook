import { AiRail } from "./_components/ai-rail";
import { EditorPanel } from "./_components/editor-panel";
import { PatientSummaryBar } from "./_components/patient-summary-bar";
import { TemplatesSidebar } from "./_components/templates-sidebar";

export default function ConclusionsPage() {
  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <h1 className="text-2xl font-bold text-foreground">Заключения</h1>

      <PatientSummaryBar />

      <div className="flex min-w-0 gap-4 xl:gap-5">
        <TemplatesSidebar />
        <EditorPanel />
        <AiRail />
      </div>
    </div>
  );
}
