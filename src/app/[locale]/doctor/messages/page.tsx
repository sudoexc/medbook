import { ChatPanel } from "./_components/chat-panel";
import { PatientContextPanel } from "./_components/patient-context-panel";
import { ThreadListSidebar } from "./_components/thread-list-sidebar";

export default function MessagesPage() {
  return (
    <div className="flex min-w-0 gap-4 p-4 xl:gap-5 xl:p-6">
      <ThreadListSidebar />
      <ChatPanel />
      <PatientContextPanel />
    </div>
  );
}
