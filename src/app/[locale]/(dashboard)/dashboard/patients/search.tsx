"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function PatientSearch({ locale, defaultValue }: { locale: string; defaultValue: string }) {
  const [query, setQuery] = useState(defaultValue);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    router.push(`/${locale}/dashboard/patients${params}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 max-w-md">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={locale === "ru" ? "Поиск по имени, телефону или паспорту" : "Ism, telefon yoki pasport bo'yicha qidirish"}
          className="h-10 rounded-lg pl-9"
        />
      </div>
    </form>
  );
}
