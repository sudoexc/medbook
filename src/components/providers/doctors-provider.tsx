"use client";

import { createContext, useContext } from "react";
import type { DoctorView } from "@/lib/doctors";

const DoctorsContext = createContext<DoctorView[]>([]);

export function DoctorsProvider({
  doctors,
  children,
}: {
  doctors: DoctorView[];
  children: React.ReactNode;
}) {
  return (
    <DoctorsContext.Provider value={doctors}>
      {children}
    </DoctorsContext.Provider>
  );
}

export function useDoctors() {
  return useContext(DoctorsContext);
}
