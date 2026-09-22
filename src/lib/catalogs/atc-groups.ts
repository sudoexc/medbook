/**
 * ATC anatomical main groups — the first letter of every WHO ATC code.
 *
 * This is the classification doctors actually navigate a formulary by, and
 * the state register ships an ATC code for ~94% of its rows, so the drug
 * reference can offer real professional navigation instead of one flat list
 * with a «показать ещё» button.
 *
 * Kept as a plain table (not i18n messages) because the letters and their
 * meanings are a WHO standard, not clinic copy — the localisation here is
 * only the human-readable gloss.
 */
export type AtcGroup = {
  /** ATC letter, e.g. "N". */
  code: string;
  ru: string;
  uz: string;
};

export const ATC_GROUPS: AtcGroup[] = [
  { code: "A", ru: "Пищеварение и обмен веществ", uz: "Hazm va moddalar almashinuvi" },
  { code: "B", ru: "Кровь и кроветворение", uz: "Qon va qon yaratilishi" },
  { code: "C", ru: "Сердечно-сосудистая система", uz: "Yurak qon tomir tizimi" },
  { code: "D", ru: "Дерматология", uz: "Dermatologiya" },
  { code: "G", ru: "Мочеполовая система и половые гормоны", uz: "Siydik tanosil tizimi va jinsiy gormonlar" },
  { code: "H", ru: "Гормоны (кроме половых)", uz: "Gormonlar (jinsiydan tashqari)" },
  { code: "J", ru: "Противомикробные средства", uz: "Mikrobga qarshi vositalar" },
  { code: "L", ru: "Противоопухолевые и иммуномодуляторы", uz: "O'simtaga qarshi va immunomodulyatorlar" },
  { code: "M", ru: "Костно-мышечная система", uz: "Suyak mushak tizimi" },
  { code: "N", ru: "Нервная система", uz: "Asab tizimi" },
  { code: "P", ru: "Противопаразитарные средства", uz: "Parazitga qarshi vositalar" },
  { code: "R", ru: "Дыхательная система", uz: "Nafas olish tizimi" },
  { code: "S", ru: "Органы чувств", uz: "Sezgi a'zolari" },
  { code: "V", ru: "Прочие препараты", uz: "Boshqa preparatlar" },
];

const BY_CODE = new Map(ATC_GROUPS.map((g) => [g.code, g]));

export function atcGroupLabel(
  code: string | null | undefined,
  locale: string,
): string | null {
  if (!code) return null;
  const g = BY_CODE.get(code.trim().charAt(0).toUpperCase());
  if (!g) return null;
  return locale === "uz" ? g.uz : g.ru;
}
