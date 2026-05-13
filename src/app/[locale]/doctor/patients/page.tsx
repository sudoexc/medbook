import { AiAssistantPanel } from "./_components/ai-assistant-panel";
import { PatientsFilters } from "./_components/patients-filters";
import { PatientsHeader } from "./_components/patients-header";
import { PatientsPagination } from "./_components/patients-pagination";
import { PatientsTable } from "./_components/patients-table";
import { SegmentationCard } from "./_components/segmentation-card";
import { SelectedPatientCard } from "./_components/selected-patient-card";

export default function PatientsPage() {
  return (
    <div className="flex gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4 xl:gap-5">
        <PatientsHeader />
        <PatientsFilters />
        <PatientsTable />
        <PatientsPagination />
      </div>

      <aside className="hidden w-[320px] shrink-0 flex-col gap-4 xl:flex xl:gap-5">
        <AiAssistantPanel />
        <SelectedPatientCard />
        <SegmentationCard />
      </aside>
    </div>
  );
}
