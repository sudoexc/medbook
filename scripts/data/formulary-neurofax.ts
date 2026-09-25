/**
 * NeuroFax core drug list — «РЕЦЕПТЫ.docx», handed over by the clinic
 * 25.09.2026 as the drugs its doctors write in ~90% of prescriptions.
 *
 * One entry per line of the document, in its order. `label` is the name as
 * the doctors write it; `aliases` are the other trade names they listed in
 * brackets (their vocabulary, used for search — kept per clinic, never
 * written into the shared brand table); `strengths` are the doses they
 * listed. `drugId` points at the catalog row the name was matched to
 * (checked against the prod catalog 25.09.2026); `drugId: null` means the
 * catalog has no such drug and it is added as the clinic's own.
 *
 * Deliberate choices:
 *   - Obvious typos in the document are corrected (ФИНЛКПСИН → Финлепсин,
 *     ТОПЕРАМАТ → Топирамат, КЛОНОЗЕПАМ → Клоназепам, КОФНФУНДУС →
 *     Конфундус, ЭДЕРАВОН → Эдаравон).
 *   - «АРЛЕВЕРТ (ОМАРОН, ФЕЗАМ)»: Омарон/Фезам are a different combination
 *     (пирацетам + циннаризин, their own catalog row), so they are not made
 *     aliases of Арлеверт — search finds them under their own row anyway.
 *   - «ЭЛЛИЗИНА»: the catalog's «Лизин» row lumps 25 unrelated lysine
 *     products, so Эллизина is added as the clinic's own drug instead.
 *   - «(НЕТ В БАЗЕ)» Клоназепам and Тералиджен are in fact in the catalog
 *     (клоназепам; алимемазин) and are linked there.
 */
export type FormularySeed = {
  label: string;
  aliases: string[];
  strengths: string[];
  drugId: string | null;
  /** «без рецепт» in the document. */
  otc?: boolean;
};

export const NEUROFAX_FORMULARY: FormularySeed[] = [
  { label: "Амангри", aliases: [], strengths: ["60 мг"], drugId: null },
  { label: "Анаприлин", aliases: ["Пропранолол"], strengths: ["40 мг"], drugId: "uzr-propranolol" },
  { label: "Арлеверт", aliases: [], strengths: [], drugId: "uzr-dimengidrinat-tsinnarizin" },
  { label: "Аторвастатин", aliases: ["Аторис", "Аторвакор"], strengths: ["10 мг", "20 мг"], drugId: "atorvastatin" },
  { label: "Блокиум В12", aliases: ["Опеблок", "Нейроблок", "Блокарт"], strengths: [], drugId: "uzr-betametazon-gidroksokobalamin-diklofenak" },
  { label: "Венлаксор", aliases: ["Венлаксим"], strengths: ["37,5 мг", "75 мг"], drugId: "venlafaxine" },
  { label: "Глиатилин", aliases: [], strengths: ["400 мг"], drugId: "choline-alfoscerate" },
  { label: "Глицевит", aliases: [], strengths: [], drugId: null, otc: true },
  { label: "Грандаксин", aliases: [], strengths: ["50 мг"], drugId: "tofisopam" },
  { label: "Золмигрен", aliases: [], strengths: ["2,5 мг"], drugId: "zolmitriptan" },
  { label: "Зопиклон", aliases: ["Соннат"], strengths: ["7,5 мг"], drugId: "zopiclone" },
  { label: "Ибупрофен", aliases: ["МИГ", "Гофен", "Бруфен"], strengths: ["200 мг", "400 мг"], drugId: "ibuprofen", otc: true },
  { label: "Карбамазепин", aliases: ["Финлепсин", "Милепсин", "Мезакар"], strengths: ["200 мг", "400 мг"], drugId: "carbamazepine" },
  { label: "Ксефомиелин", aliases: [], strengths: [], drugId: null },
  { label: "Карболит", aliases: [], strengths: ["300 мг"], drugId: null },
  { label: "Клоназепам", aliases: [], strengths: ["0,5 мг", "2 мг"], drugId: "clonazepam" },
  { label: "Конвулекс", aliases: ["Депакин", "Вольпарин"], strengths: ["300 мг", "500 мг"], drugId: "valproate" },
  { label: "Ламотриджин", aliases: ["Ламитор"], strengths: ["25 мг", "50 мг", "100 мг"], drugId: "lamotrigine" },
  { label: "Летирам", aliases: ["Кеппра"], strengths: ["250 мг", "500 мг"], drugId: "levetiracetam" },
  { label: "Мелоксикам", aliases: ["Мелбек форте", "Камелот"], strengths: ["15 мг"], drugId: "meloxicam" },
  { label: "Мидокалм", aliases: [], strengths: ["150 мг"], drugId: "tolperisone" },
  { label: "Мускамед", aliases: ["Макстио", "Муфлексин"], strengths: [], drugId: "thiocolchicoside" },
  { label: "Найз", aliases: [], strengths: ["100 мг"], drugId: "nimesulide" },
  { label: "Нейрокс", aliases: ["Элфунат", "Мексидол"], strengths: [], drugId: "mexidol" },
  { label: "Нейромидин", aliases: ["Ипигрикс"], strengths: ["20 мг"], drugId: "ipidacrine" },
  { label: "Нивалин", aliases: [], strengths: ["5 мг"], drugId: "galantamine" },
  { label: "Ноогам", aliases: [], strengths: [], drugId: null, otc: true },
  { label: "Нуклео ЦМФ", aliases: [], strengths: [], drugId: "uzr-nukleo-ts-m-f-forte", otc: true },
  { label: "Пантогальцин", aliases: ["Гапонтомид", "Когнум"], strengths: ["250 мг", "500 мг"], drugId: "hopantenic-acid" },
  { label: "Ризоптан", aliases: [], strengths: ["10 мг"], drugId: "rizatriptan" },
  { label: "Розувастатин", aliases: ["Роксера", "Розувин"], strengths: ["10 мг", "20 мг"], drugId: "rosuvastatin" },
  { label: "Севпрам", aliases: ["Эспа", "Дорипам"], strengths: ["10 мг", "20 мг"], drugId: "escitalopram" },
  { label: "Сирдалуд", aliases: [], strengths: ["2 мг", "4 мг"], drugId: "tizanidine" },
  { label: "Суматриптан", aliases: ["Сумамигрен"], strengths: ["50 мг", "100 мг"], drugId: "sumatriptan" },
  { label: "Тералиджен", aliases: [], strengths: ["5 мг"], drugId: "uzr-alimemazin" },
  { label: "Тиаприд", aliases: ["Тиапросан"], strengths: ["100 мг"], drugId: "uzr-tiaprid" },
  { label: "Тидомет форте", aliases: ["Допадекс", "Конфундус", "Наком"], strengths: [], drugId: "levodopa_carbidopa" },
  { label: "Топирамат", aliases: ["Топамакс"], strengths: ["25 мг", "50 мг", "100 мг"], drugId: "topiramate" },
  { label: "Тригексифенидил", aliases: ["Циклодол"], strengths: ["2 мг", "5 мг"], drugId: "trihexyphenidyl" },
  { label: "Фенибут", aliases: ["Ноофен", "Бифрен"], strengths: ["250 мг"], drugId: "phenibut" },
  { label: "Флуоксетин", aliases: ["Лепрес"], strengths: ["20 мг"], drugId: "fluoxetine" },
  { label: "Цереболайф", aliases: [], strengths: [], drugId: null, otc: true },
  { label: "Цитиколин", aliases: ["Цикол", "Нейромак"], strengths: ["1000 мг"], drugId: "citicoline" },
  { label: "Эдаравон", aliases: ["Церавон"], strengths: ["30 мл"], drugId: "uzr-edaravon" },
  { label: "Эллизина", aliases: ["Л-лизина эсцинат"], strengths: [], drugId: null },
  { label: "Этодин форте", aliases: [], strengths: ["600 мг"], drugId: "uzr-etodolak" },
];
