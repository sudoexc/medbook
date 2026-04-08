"use client";

import { useRouter } from "next/navigation";

interface AppointmentStatusUpdateProps {
  appointmentId: string;
  currentStatus: string;
  statusLabels: Record<string, Record<string, string>>;
  locale: string;
}

export function AppointmentStatusUpdate({
  appointmentId,
  currentStatus,
  statusLabels,
  locale,
}: AppointmentStatusUpdateProps) {
  const router = useRouter();

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value;
    await fetch(`/api/appointments/${appointmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    router.refresh();
  }

  const colors: Record<string, string> = {
    PENDING: "bg-amber-50 text-amber-700 border-amber-200",
    CONFIRMED: "bg-blue-50 text-blue-700 border-blue-200",
    COMPLETED: "bg-green-50 text-green-700 border-green-200",
    CANCELLED: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <select
      value={currentStatus}
      onChange={handleChange}
      className={`rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer ${colors[currentStatus] || ""}`}
    >
      {Object.entries(statusLabels).map(([key, labels]) => (
        <option key={key} value={key}>
          {labels[locale] || key}
        </option>
      ))}
    </select>
  );
}
