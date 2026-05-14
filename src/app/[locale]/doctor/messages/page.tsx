import { Suspense } from "react";

import { ChatPanel } from "./_components/chat-panel";
import { PatientContextPanel } from "./_components/patient-context-panel";
import { ThreadListSidebar } from "./_components/thread-list-sidebar";
import { MessagesProvider } from "./_hooks/messages-context";

export default function MessagesPage() {
  return (
    // Suspense boundary required because `MessagesProvider` consumes
    // `useSearchParams` to autoselect a thread when the URL carries
    // `?patientId=…`. Next requires a fence around any client subtree that
    // reads search params so the static shell can be prerendered.
    <Suspense fallback={null}>
      <MessagesProvider>
        <div className="flex min-w-0 gap-4 p-4 xl:gap-5 xl:p-6">
          <ThreadListSidebar />
          <ChatPanel />
          <PatientContextPanel />
        </div>
      </MessagesProvider>
    </Suspense>
  );
}
