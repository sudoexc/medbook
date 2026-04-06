import type { Specialty } from "@/types";

export const SITE_NAME = "MedBook";
export const SITE_DOMAIN = "medbook.uz";

export const CONTACT = {
  phone: "+998 71 123 45 67",
  email: "info@medbook.uz",
  telegram: "https://t.me/medbook_uz",
  instagram: "https://instagram.com/medbook.uz",
} as const;

export const SPECIALTIES: Specialty[] = [
  { id: "therapist", slug: "therapist", name: { ru: "Терапевт", uz: "Terapevt" }, icon: "Stethoscope" },
  { id: "dentist", slug: "dentist", name: { ru: "Стоматолог", uz: "Stomatolog" }, icon: "SmilePlus" },
  { id: "gynecologist", slug: "gynecologist", name: { ru: "Гинеколог", uz: "Ginekolog" }, icon: "Baby" },
  { id: "ent", slug: "ent", name: { ru: "ЛОР", uz: "LOR" }, icon: "Ear" },
  { id: "ophthalmologist", slug: "ophthalmologist", name: { ru: "Офтальмолог", uz: "Oftalmolog" }, icon: "Eye" },
  { id: "cardiologist", slug: "cardiologist", name: { ru: "Кардиолог", uz: "Kardiolog" }, icon: "HeartPulse" },
  { id: "neurologist", slug: "neurologist", name: { ru: "Невролог", uz: "Nevrolog" }, icon: "Brain" },
  { id: "pediatrician", slug: "pediatrician", name: { ru: "Педиатр", uz: "Pediatr" }, icon: "Baby" },
  { id: "ultrasound", slug: "ultrasound", name: { ru: "УЗИ-диагностика", uz: "UZI diagnostikasi" }, icon: "Monitor" },
];

export const NAV_LINKS = [
  { href: "#how-it-works", labelKey: "nav.howItWorks" },
  { href: "#specialties", labelKey: "nav.specialties" },
  { href: "#for-doctors", labelKey: "nav.forDoctors" },
  { href: "#faq", labelKey: "nav.faq" },
] as const;
