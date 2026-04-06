export type Locale = "ru" | "uz";

export interface Specialty {
  id: string;
  slug: string;
  name: Record<Locale, string>;
  icon: string;
}

export interface LeadFormData {
  name: string;
  phone: string;
  specialty?: string;
  type: "patient" | "doctor" | "clinic";
  locale: Locale;
  source: string;
  createdAt: Date;
}
