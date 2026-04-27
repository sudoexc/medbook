// TODO(public-site-revamp): rewrite against the Phase 1 Doctor schema.
// The legacy DoctorView shape (specialtyRu/specialtyUz, cabinet, scheduleRu,
// hours, photo, services) doesn't map cleanly to the new Doctor model
// (specializationRu/Uz, no per-doctor cabinet, no schedule string). Until the
// public site is rewritten, both functions return empty so build/runtime stay
// silent. Callers (sitemap, public site doctors page, layout) handle empty.
import type { Locale } from "@/types";

export interface DoctorView {
  id: string;
  name: Record<Locale, string>;
  specialty: Record<Locale, string>;
  cabinet: number;
  schedule: Record<Locale, string>;
  hours: string;
  photo: string | null;
  services: { name: Record<Locale, string>; price: number }[];
}

export async function getDoctors(): Promise<DoctorView[]> {
  return [];
}

export async function getDoctorById(_id: string): Promise<DoctorView | null> {
  return null;
}
