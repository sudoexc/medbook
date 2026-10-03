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

/**
 * ATC therapeutic subgroups — the first three characters of a code («N03»).
 *
 * The visit screen's «Каталог» column (clinic request 03.10.2026: prescribe
 * with the mouse, no typing) walks group → subgroup → drugs. A main group
 * holds up to ~500 register rows, far too many to scroll; a subgroup holds
 * a few dozen. Short glosses, not the WHO wording: the column is narrow and
 * the doctor reads «Противоэпилептические», not «Antiepileptics (N03)».
 * Same reasoning as the main groups for a plain table over i18n messages.
 */
export const ATC_SUBGROUPS: AtcGroup[] = [
  { code: "A01", ru: "Стоматологические", uz: "Stomatologik" },
  { code: "A02", ru: "При повышенной кислотности", uz: "Kislotalilik oshganda" },
  { code: "A03", ru: "Спазмолитики и прокинетики", uz: "Spazmolitiklar va prokinetiklar" },
  { code: "A04", ru: "Противорвотные", uz: "Qusishga qarshi" },
  { code: "A05", ru: "Печень и желчные пути", uz: "Jigar va o't yo'llari" },
  { code: "A06", ru: "Слабительные", uz: "Surgi vositalar" },
  { code: "A07", ru: "Противодиарейные и кишечные", uz: "Diareyaga qarshi va ichak uchun" },
  { code: "A08", ru: "При ожирении", uz: "Semizlikda" },
  { code: "A09", ru: "Ферменты для пищеварения", uz: "Hazm fermentlari" },
  { code: "A10", ru: "Сахарный диабет", uz: "Qandli diabet" },
  { code: "A11", ru: "Витамины", uz: "Vitaminlar" },
  { code: "A12", ru: "Минеральные добавки", uz: "Mineral qo'shimchalar" },
  { code: "A13", ru: "Общетонизирующие", uz: "Umumiy quvvatlovchi" },
  { code: "A14", ru: "Анаболические", uz: "Anabolik vositalar" },
  { code: "A15", ru: "Стимуляторы аппетита", uz: "Ishtaha ochuvchi" },
  { code: "A16", ru: "Прочие для ЖКТ и обмена", uz: "Hazm va almashinuv uchun boshqalar" },
  { code: "B01", ru: "Антитромботические", uz: "Antitrombotik" },
  { code: "B02", ru: "Кровоостанавливающие", uz: "Qon to'xtatuvchi" },
  { code: "B03", ru: "Антианемические", uz: "Kamqonlikka qarshi" },
  { code: "B05", ru: "Растворы и кровезаменители", uz: "Eritmalar va qon o'rnini bosuvchilar" },
  { code: "B06", ru: "Прочие для крови", uz: "Qon uchun boshqalar" },
  { code: "C01", ru: "Для лечения сердца", uz: "Yurak davosi uchun" },
  { code: "C02", ru: "Антигипертензивные", uz: "Bosimni tushiruvchi" },
  { code: "C03", ru: "Диуретики", uz: "Siydik haydovchi" },
  { code: "C04", ru: "Периферические вазодилататоры", uz: "Periferik tomir kengaytiruvchi" },
  { code: "C05", ru: "Ангиопротекторы", uz: "Angioprotektorlar" },
  { code: "C07", ru: "Бета-блокаторы", uz: "Beta blokatorlar" },
  { code: "C08", ru: "Блокаторы кальциевых каналов", uz: "Kalsiy kanallari blokatorlari" },
  { code: "C09", ru: "Ингибиторы АПФ и сартаны", uz: "AAF ingibitorlari va sartanlar" },
  { code: "C10", ru: "Гиполипидемические", uz: "Lipidlarni kamaytiruvchi" },
  { code: "D01", ru: "Противогрибковые для кожи", uz: "Teri uchun zamburug'ga qarshi" },
  { code: "D02", ru: "Смягчающие и защитные", uz: "Yumshatuvchi va himoya" },
  { code: "D03", ru: "Для ран и язв", uz: "Yara va yaralar uchun" },
  { code: "D04", ru: "Противозудные", uz: "Qichishishga qarshi" },
  { code: "D05", ru: "При псориазе", uz: "Psoriazda" },
  { code: "D06", ru: "Антибиотики для кожи", uz: "Teri uchun antibiotiklar" },
  { code: "D07", ru: "Кортикостероиды для кожи", uz: "Teri uchun kortikosteroidlar" },
  { code: "D08", ru: "Антисептики", uz: "Antiseptiklar" },
  { code: "D09", ru: "Лечебные повязки", uz: "Davolovchi bog'ichlar" },
  { code: "D10", ru: "При акне", uz: "Akneda" },
  { code: "D11", ru: "Прочие дерматологические", uz: "Boshqa dermatologik" },
  { code: "G01", ru: "Гинекологические антисептики", uz: "Ginekologik antiseptiklar" },
  { code: "G02", ru: "Прочие гинекологические", uz: "Boshqa ginekologik" },
  { code: "G03", ru: "Половые гормоны", uz: "Jinsiy gormonlar" },
  { code: "G04", ru: "Урологические", uz: "Urologik" },
  { code: "H01", ru: "Гормоны гипофиза и гипоталамуса", uz: "Gipofiz va gipotalamus gormonlari" },
  { code: "H02", ru: "Кортикостероиды системные", uz: "Tizimli kortikosteroidlar" },
  { code: "H03", ru: "Щитовидная железа", uz: "Qalqonsimon bez" },
  { code: "H04", ru: "Гормоны поджелудочной железы", uz: "Oshqozon osti bezi gormonlari" },
  { code: "H05", ru: "Обмен кальция", uz: "Kalsiy almashinuvi" },
  { code: "J01", ru: "Антибиотики системные", uz: "Tizimli antibiotiklar" },
  { code: "J02", ru: "Противогрибковые системные", uz: "Tizimli zamburug'ga qarshi" },
  { code: "J04", ru: "Противотуберкулёзные", uz: "Silga qarshi" },
  { code: "J05", ru: "Противовирусные", uz: "Virusga qarshi" },
  { code: "J06", ru: "Сыворотки и иммуноглобулины", uz: "Zardoblar va immunoglobulinlar" },
  { code: "J07", ru: "Вакцины", uz: "Vaksinalar" },
  { code: "L01", ru: "Противоопухолевые", uz: "O'simtaga qarshi" },
  { code: "L02", ru: "Гормональная противоопухолевая", uz: "O'simtaga qarshi gormonal" },
  { code: "L03", ru: "Иммуностимуляторы", uz: "Immunostimulyatorlar" },
  { code: "L04", ru: "Иммунодепрессанты", uz: "Immunodepressantlar" },
  { code: "M01", ru: "НПВС и противоревматические", uz: "NYaQV va revmatizmga qarshi" },
  { code: "M02", ru: "Местно при болях в суставах и мышцах", uz: "Bo'g'im va mushak og'rig'ida mahalliy" },
  { code: "M03", ru: "Миорелаксанты", uz: "Miorelaksantlar" },
  { code: "M04", ru: "Противоподагрические", uz: "Podagraga qarshi" },
  { code: "M05", ru: "Для костей", uz: "Suyaklar uchun" },
  { code: "M09", ru: "Прочие для костей и мышц", uz: "Suyak va mushak uchun boshqalar" },
  { code: "N01", ru: "Анестетики", uz: "Anestetiklar" },
  { code: "N02", ru: "Анальгетики", uz: "Analgetiklar" },
  { code: "N03", ru: "Противоэпилептические", uz: "Epilepsiyaga qarshi" },
  { code: "N04", ru: "Противопаркинсонические", uz: "Parkinsonizmga qarshi" },
  { code: "N05", ru: "Транквилизаторы, нейролептики, снотворные", uz: "Trankvilizatorlar, neyroleptiklar, uxlatuvchi" },
  { code: "N06", ru: "Антидепрессанты и ноотропы", uz: "Antidepressantlar va nootroplar" },
  { code: "N07", ru: "Прочие для нервной системы", uz: "Asab tizimi uchun boshqalar" },
  { code: "P01", ru: "Противопротозойные", uz: "Protozoylarga qarshi" },
  { code: "P02", ru: "Противоглистные", uz: "Gijjaga qarshi" },
  { code: "P03", ru: "Против эктопаразитов", uz: "Ektoparazitlarga qarshi" },
  { code: "R01", ru: "Назальные", uz: "Burun uchun" },
  { code: "R02", ru: "Для горла", uz: "Tomoq uchun" },
  { code: "R03", ru: "При бронхиальной обструкции", uz: "Bronx obstruksiyasida" },
  { code: "R04", ru: "Растирания и ингаляции", uz: "Surtma va ingalyatsiyalar" },
  { code: "R05", ru: "От кашля и простуды", uz: "Yo'tal va shamollashga qarshi" },
  { code: "R06", ru: "Антигистаминные", uz: "Antigistamin" },
  { code: "R07", ru: "Прочие для дыхания", uz: "Nafas uchun boshqalar" },
  { code: "S01", ru: "Глазные", uz: "Ko'z uchun" },
  { code: "S02", ru: "Ушные", uz: "Quloq uchun" },
  { code: "S03", ru: "Глазные и ушные", uz: "Ko'z va quloq uchun" },
  { code: "V01", ru: "Аллергены", uz: "Allergenlar" },
  { code: "V03", ru: "Прочие лечебные", uz: "Boshqa davolovchi" },
  { code: "V04", ru: "Диагностические", uz: "Diagnostik" },
  { code: "V06", ru: "Питательные смеси", uz: "Ozuqaviy aralashmalar" },
  { code: "V07", ru: "Прочие нелечебные", uz: "Boshqa davolamaydigan" },
  { code: "V08", ru: "Контрастные средства", uz: "Kontrast vositalar" },
  { code: "V09", ru: "Радиофармпрепараты диагностические", uz: "Diagnostik radiofarmpreparatlar" },
  { code: "V10", ru: "Радиофармпрепараты лечебные", uz: "Davolovchi radiofarmpreparatlar" },
  { code: "V20", ru: "Хирургические перевязочные", uz: "Jarrohlik bog'lov vositalari" },
];

const SUB_BY_CODE = new Map(ATC_SUBGROUPS.map((g) => [g.code, g]));

/**
 * The gloss of a three-character subgroup, null for a code the table lacks
 * (the register has a few non-WHO prefixes): the caller shows the bare code.
 */
export function atcSubgroupLabel(
  code: string | null | undefined,
  locale: string,
): string | null {
  if (!code) return null;
  const g = SUB_BY_CODE.get(code.trim().slice(0, 3).toUpperCase());
  if (!g) return null;
  return locale === "uz" ? g.uz : g.ru;
}
