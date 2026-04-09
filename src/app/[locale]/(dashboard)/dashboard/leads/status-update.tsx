"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface LeadStatusUpdateProps {
  leadId: string;
  currentStatus: string;
  statusLabels: Record<string, Record<string, string>>;
  locale: string;
}

export function LeadStatusUpdate({
  leadId,
  currentStatus,
  statusLabels,
  locale,
}: LeadStatusUpdateProps) {
  const router = useRouter();

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value;
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Не удалось обновить статус");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Сетевая ошибка");
    }
  }

  const colors: Record<string, string> = {
    NEW: "bg-amber-50 text-amber-700 border-amber-200",
    CONTACTED: "bg-blue-50 text-blue-700 border-blue-200",
    CONVERTED: "bg-green-50 text-green-700 border-green-200",
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
