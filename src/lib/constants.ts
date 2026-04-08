export const SITE_NAME = "NeuroFax";
export const SITE_DOMAIN = "neurofax.uz";

export const CONTACT = {
  phone: "+998 71 275 28 18",
  email: "info@neurofax.uz",
  telegram: "#",
  instagram: "#",
  address: {
    ru: "Ташкент, 13 квартал, ул. Лутфий 26-1, 100138",
    uz: "Toshkent, 13-mavze, Lutfiy ko'chasi 26-1, 100138",
  },
} as const;

export const NAV_LINKS = [
  { href: "#doctors", labelKey: "nav.doctors" },
  { href: "#services", labelKey: "nav.services" },
  { href: "#about", labelKey: "nav.about" },
  { href: "#faq", labelKey: "nav.faq" },
] as const;
