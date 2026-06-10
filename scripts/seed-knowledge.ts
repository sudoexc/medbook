/**
 * Ф1 (TZ-smart-constructor) — seed the global DiagnosisGuide knowledge base
 * (clinicId = null) with curated neuro-profile guides, RU + UZ.
 *
 * Idempotent: rows are matched by (clinicId: null, code) via findFirst —
 * Postgres treats NULL as distinct in the composite unique, so upsert with
 * `clinicId_code` can't be used here. Existing rows are UPDATED (the seed is
 * the source of truth for global guides); clinic-own rows are never touched.
 *
 * Usage (after `prisma migrate deploy`):
 *   docker compose run --rm worker npx tsx scripts/seed-knowledge.ts
 * Without docker (DATABASE_URL in env):
 *   npx tsx scripts/seed-knowledge.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

type GuideSeed = {
  code: string;
  matchPrefix: string;
  titleRu: string;
  titleUz: string;
  whatToDoRu: string;
  whatToDoUz: string;
  careRu?: string;
  careUz?: string;
  lifestyleRu?: string;
  lifestyleUz?: string;
  redFlagsRu: string;
  redFlagsUz: string;
  adviceChips: string[];
  defaultFollowUpDays?: number;
};

const GUIDES: GuideSeed[] = [
  {
    code: "G43",
    matchPrefix: "G43",
    titleRu: "Мигрень",
    titleUz: "Migren",
    whatToDoRu:
      "— При первых признаках приступа примите назначенный препарат, не дожидаясь пика боли.\n— Уйдите в тихое затемнённое помещение, приложите холод ко лбу.\n— Ведите дневник приступов: дата, длительность, возможный триггер.",
    whatToDoUz:
      "— Xuruj boshlanishi bilan tayinlangan dorini qabul qiling, og‘riq kuchayishini kutmang.\n— Tinch va qorong‘i xonaga o‘ting, peshonaga sovuq narsa qo‘ying.\n— Xurujlar kundaligini yuriting: sana, davomiyligi, ehtimoliy sabab.",
    careRu:
      "— Спите не менее 7–8 часов, ложитесь и вставайте в одно и то же время.\n— Не пропускайте приёмы пищи — голод частый триггер.",
    careUz:
      "— Kamida 7–8 soat uxlang, bir xil vaqtda yotib turing.\n— Ovqatni o‘tkazib yubormang — ochlik xurujni qo‘zg‘atadi.",
    lifestyleRu:
      "— Ограничьте кофеин, красное вино, выдержанные сыры и шоколад.\n— Пейте достаточно воды (1,5–2 л в день).\n— Регулярная умеренная активность (ходьба, плавание) снижает частоту приступов.",
    lifestyleUz:
      "— Kofein, qizil vino, eski pishloq va shokoladni cheklang.\n— Yetarli suv iching (kuniga 1,5–2 l).\n— Muntazam yengil faollik (piyoda yurish, suzish) xurujlarni kamaytiradi.",
    redFlagsRu:
      "— Внезапная «громоподобная» боль, самая сильная в жизни.\n— Боль с температурой, сыпью, скованностью шеи.\n— Слабость в руке/ноге, нарушение речи или зрения.\n— Приступ длится более 72 часов.",
    redFlagsUz:
      "— To‘satdan, hayotdagi eng kuchli «momaqaldiroq» og‘rig‘i.\n— Og‘riq bilan isitma, toshma, bo‘yin qotishi.\n— Qo‘l/oyoqda holsizlik, nutq yoki ko‘rish buzilishi.\n— Xuruj 72 soatdan uzoq davom etsa.",
    adviceChips: [
      "Дневник головной боли",
      "Сон 7–8 часов",
      "Ограничить кофеин",
      "Пить 1,5–2 л воды",
    ],
    defaultFollowUpDays: 30,
  },
  {
    code: "G40",
    matchPrefix: "G40",
    titleRu: "Эпилепсия",
    titleUz: "Epilepsiya",
    whatToDoRu:
      "— Принимайте противосудорожный препарат строго по схеме, в одно и то же время.\n— Не пропускайте дозы и не отменяйте препарат самостоятельно — это главный риск повторного приступа.\n— Ведите календарь приступов и приносите его на каждый приём.",
    whatToDoUz:
      "— Tutqanoqqa qarshi dorini qat’iy jadval bo‘yicha, bir xil vaqtda iching.\n— Dozani o‘tkazib yubormang va dorini o‘zboshimchalik bilan to‘xtatmang — bu qaytalanishning asosiy xavfi.\n— Xurujlar taqvimini yuriting va har qabulga olib keling.",
    careRu:
      "— Родным: при приступе уложите на бок, уберите опасные предметы, ничего не кладите в рот, засеките время.\n— После приступа дайте человеку отдохнуть, не оставляйте одного.",
    careUz:
      "— Yaqinlarga: xuruj paytida bemorni yonboshlatib yotqizing, xavfli narsalarni olib qo‘ying, og‘ziga hech narsa solmang, vaqtni belgilang.\n— Xurujdan keyin dam berishga qo‘ying, yolg‘iz qoldirmang.",
    lifestyleRu:
      "— Высыпайтесь: недосып провоцирует приступы.\n— Полностью исключите алкоголь.\n— Избегайте мерцающего света и работы на высоте; вождение — только с разрешения врача.",
    lifestyleUz:
      "— Yetarli uxlang: uyqusizlik xurujni qo‘zg‘atadi.\n— Spirtli ichimliklarni butunlay cheklang.\n— Miltillovchi yorug‘lik va balandlikda ishlashdan saqlaning; mashina haydash — faqat shifokor ruxsati bilan.",
    redFlagsRu:
      "— Приступ длится более 5 минут или приступы идут один за другим.\n— Человек не приходит в сознание после приступа.\n— Травма головы во время приступа, затруднённое дыхание.",
    redFlagsUz:
      "— Xuruj 5 daqiqadan uzoq davom etsa yoki ketma-ket kelsa.\n— Xurujdan keyin hush qaytmasa.\n— Xuruj paytida bosh jarohati, nafas olish qiyinlashuvi.",
    adviceChips: [
      "Календарь приступов",
      "Исключить алкоголь",
      "Регулярный сон",
      "Не пропускать препарат",
    ],
    defaultFollowUpDays: 30,
  },
  {
    code: "G45",
    matchPrefix: "G45",
    titleRu: "Транзиторная ишемическая атака (ТИА)",
    titleUz: "Tranzitor ishemik ataka (TIA)",
    whatToDoRu:
      "— ТИА — предупреждение о риске инсульта: принимайте назначенные препараты (антиагреганты, статины, давление) без пропусков.\n— Измеряйте артериальное давление утром и вечером, записывайте.\n— Пройдите назначенные обследования (УЗИ сосудов шеи, ЭКГ) не откладывая.",
    whatToDoUz:
      "— TIA — insult xavfidan ogohlantirish: tayinlangan dorilarni (antiagregant, statin, bosim dorisi) qoldirmasdan iching.\n— Qon bosimini ertalab va kechqurun o‘lchab, yozib boring.\n— Tayinlangan tekshiruvlarni (bo‘yin tomirlari UTT, EKG) kechiktirmasdan o‘tang.",
    lifestyleRu:
      "— Откажитесь от курения — это главный изменяемый фактор риска.\n— Ограничьте соль до 5 г/день, жирное и жареное.\n— Ходьба 30 минут в день, контроль веса.",
    lifestyleUz:
      "— Chekishni tashlang — bu o‘zgartirsa bo‘ladigan asosiy xavf omili.\n— Tuzni kuniga 5 g gacha, yog‘li va qovurilgan ovqatni cheklang.\n— Kuniga 30 daqiqa piyoda yuring, vaznni nazorat qiling.",
    redFlagsRu:
      "— Внезапная слабость или онемение руки/ноги/лица, особенно с одной стороны.\n— Нарушение речи, перекос лица, двоение в глазах.\n— Резкое головокружение с потерей равновесия.\nПри любом из этих признаков — немедленно вызывайте скорую (103).",
    redFlagsUz:
      "— To‘satdan qo‘l/oyoq/yuzda holsizlik yoki uvishish, ayniqsa bir tomonda.\n— Nutq buzilishi, yuz qiyshayishi, ko‘zda ikkilanish.\n— Muvozanat yo‘qolishi bilan keskin bosh aylanishi.\nShu belgilardan biri bo‘lsa — darhol tez yordam chaqiring (103).",
    adviceChips: [
      "Контроль АД 2 раза в день",
      "Отказ от курения",
      "Соль ≤ 5 г/день",
      "Ходьба 30 мин/день",
    ],
    defaultFollowUpDays: 14,
  },
  {
    code: "G47.0",
    matchPrefix: "G47.0",
    titleRu: "Бессонница",
    titleUz: "Uyqusizlik (insomniya)",
    whatToDoRu:
      "— Ложитесь и вставайте в одно и то же время, включая выходные.\n— Кровать — только для сна: не лежите в ней с телефоном.\n— Если не заснули за 20 минут — встаньте, займитесь спокойным делом при тусклом свете, вернитесь когда захотите спать.",
    whatToDoUz:
      "— Har kuni, dam olish kunlari ham, bir xil vaqtda yotib turing.\n— Krovat — faqat uyqu uchun: unda telefon ko‘rib yotmang.\n— 20 daqiqada uxlamasangiz — turing, xira yorug‘likda tinch ish bilan shug‘ullaning, uyqu kelganda qayting.",
    careRu:
      "— Спальня: прохладно (18–20 °C), темно, тихо.\n— За час до сна — никаких экранов; снотворные только по назначению врача и коротким курсом.",
    careUz:
      "— Yotoqxona: salqin (18–20 °C), qorong‘i, tinch bo‘lsin.\n— Uyqudan bir soat oldin ekranlarga qaramang; uyqu dorilari — faqat shifokor tayinlovi bilan, qisqa kurs.",
    lifestyleRu:
      "— Кофеин — только до обеда; алкоголь ухудшает качество сна.\n— Дневной сон не дольше 20–30 минут и не после 15:00.\n— Физическая активность днём, но не позднее чем за 3 часа до сна.",
    lifestyleUz:
      "— Kofein — faqat tushgacha; spirtli ichimlik uyqu sifatini buzadi.\n— Kunduzgi uyqu 20–30 daqiqadan oshmasin va 15:00 dan keyin bo‘lmasin.\n— Jismoniy faollik kunduzi, lekin uyqudan kamida 3 soat oldin.",
    redFlagsRu:
      "— Сильная дневная сонливость с засыпанием за рулём или на работе.\n— Громкий храп с остановками дыхания (со слов близких).\n— Бессонница с подавленным настроением и мыслями о самоповреждении.",
    redFlagsUz:
      "— Rul yoki ish paytida uxlab qolish darajasidagi kunduzgi uyquchanlik.\n— Yaqinlar aytishicha, nafas to‘xtashi bilan qattiq xurrak.\n— Tushkun kayfiyat va o‘ziga zarar yetkazish xayollari bilan uyqusizlik.",
    adviceChips: [
      "Режим сна",
      "Без экранов за час до сна",
      "Кофеин только до обеда",
      "Спальня 18–20 °C",
    ],
    defaultFollowUpDays: 21,
  },
  {
    code: "M54",
    matchPrefix: "M54",
    titleRu: "Боль в спине (дорсалгия)",
    titleUz: "Bel og‘rig‘i (dorsalgiya)",
    whatToDoRu:
      "— Сохраняйте посильную активность: постельный режим дольше 1–2 дней замедляет восстановление.\n— Принимайте обезболивающие по назначенной схеме, не «по требованию» на пике боли.\n— Тепло на болезненную зону по 15–20 минут облегчает спазм.",
    whatToDoUz:
      "— Imkon qadar harakatda bo‘ling: 1–2 kundan ortiq yotish tuzalishni sekinlashtiradi.\n— Og‘riq qoldiruvchilarni tayinlangan jadval bo‘yicha iching, og‘riq cho‘qqisini kutmang.\n— Og‘riyotgan joyga 15–20 daqiqa issiq qo‘yish spazmni yengillashtiradi.",
    careRu:
      "— Избегайте подъёма тяжестей и резких наклонов со скручиванием.\n— При сидячей работе вставайте и разминайтесь каждые 45–60 минут.",
    careUz:
      "— Og‘ir ko‘tarish va burilib keskin egilishdan saqlaning.\n— O‘tirib ishlasangiz, har 45–60 daqiqada turib badan qizdiring.",
    lifestyleRu:
      "— Ежедневная ходьба и упражнения на мышцы спины/пресса после стихания острой боли.\n— Контроль веса снижает нагрузку на позвоночник.\n— Матрас средней жёсткости, подушка под колени при сне на спине.",
    lifestyleUz:
      "— O‘tkir og‘riq bosilgach — har kuni piyoda yurish, bel/press mushaklari uchun mashqlar.\n— Vazn nazorati umurtqaga yukni kamaytiradi.\n— O‘rtacha qattiq matras; chalqancha uxlaganda tizza ostiga yostiq.",
    redFlagsRu:
      "— Онемение промежности, недержание или задержка мочи/стула.\n— Нарастающая слабость в ноге, шлепающая стопа.\n— Боль с температурой, ночная боль с потерей веса, недавняя серьёзная травма.",
    redFlagsUz:
      "— Oraliq sohada uvishish, siydik/najas tutilmasligi yoki tutilishi.\n— Oyoqda kuchayib boruvchi holsizlik, oyoq panjasining osilib qolishi.\n— Isitma bilan og‘riq, vazn yo‘qotish bilan tungi og‘riq, yaqinda olingan jiddiy jarohat.",
    adviceChips: [
      "Не лежать дольше 2 дней",
      "Разминка каждый час",
      "Не поднимать тяжести",
      "ЛФК после стихания боли",
    ],
    defaultFollowUpDays: 14,
  },
  {
    code: "G47.3",
    matchPrefix: "G47.3",
    titleRu: "Апноэ сна",
    titleUz: "Uyqudagi apnoe",
    whatToDoRu:
      "— Пройдите назначенное исследование сна (полисомнографию/респираторный мониторинг).\n— Если назначен СИПАП-аппарат — используйте его каждую ночь, не менее 4 часов.\n— Спите на боку, не на спине.",
    whatToDoUz:
      "— Tayinlangan uyqu tekshiruvidan (polisomnografiya/respirator monitoring) o‘ting.\n— SIPAP apparati tayinlangan bo‘lsa — har kecha, kamida 4 soat ishlating.\n— Chalqancha emas, yonboshlab uxlang.",
    lifestyleRu:
      "— Снижение веса на 10% заметно уменьшает остановки дыхания.\n— Исключите алкоголь и снотворные вечером — они расслабляют мышцы глотки.\n— Откажитесь от курения.",
    lifestyleUz:
      "— Vaznni 10% kamaytirish nafas to‘xtashlarini sezilarli kamaytiradi.\n— Kechqurun spirtli ichimlik va uyqu dorilarini cheklang — ular halqum mushaklarini bo‘shashtiradi.\n— Chekishni tashlang.",
    redFlagsRu:
      "— Засыпание за рулём или при разговоре.\n— Удушье по ночам с паникой, утренние боли в груди.\n— Нарастающие отёки ног, перебои в сердце.",
    redFlagsUz:
      "— Rulda yoki suhbat paytida uxlab qolish.\n— Kechasi bo‘g‘ilib, vahima bilan uyg‘onish, ertalabki ko‘krak og‘rig‘i.\n— Oyoqlarda kuchayib boruvchi shish, yurak urishida uzilishlar.",
    adviceChips: [
      "Спать на боку",
      "Снижение веса",
      "Без алкоголя вечером",
      "СИПАП каждую ночь",
    ],
    defaultFollowUpDays: 30,
  },
  {
    code: "R51",
    matchPrefix: "R51",
    titleRu: "Головная боль",
    titleUz: "Bosh og‘rig‘i",
    whatToDoRu:
      "— Ведите дневник боли: когда началась, сколько длилась, чем снималась.\n— Обезболивающие — не чаще 2 дней в неделю: частый приём сам вызывает головную боль.\n— Проверьте зрение и артериальное давление.",
    whatToDoUz:
      "— Og‘riq kundaligini yuriting: qachon boshlandi, qancha davom etdi, nima yordam berdi.\n— Og‘riq qoldiruvchilar — haftada ko‘pi bilan 2 kun: tez-tez ichish o‘zi bosh og‘rig‘ini keltiradi.\n— Ko‘rish va qon bosimini tekshirtiring.",
    careRu:
      "— Регулярный сон и приёмы пищи, перерывы при работе за экраном каждые 40–60 минут.\n— Проветривайте помещение, пейте достаточно воды.",
    careUz:
      "— Muntazam uyqu va ovqatlanish; ekran oldida har 40–60 daqiqada tanaffus qiling.\n— Xonani shamollatib turing, yetarli suv iching.",
    redFlagsRu:
      "— Внезапная боль максимальной силы («удар грома»).\n— Боль с температурой и ригидностью шеи, после травмы головы.\n— Боль со слабостью в конечностях, нарушением речи или зрения.\n— Впервые возникшая сильная боль после 50 лет.",
    redFlagsUz:
      "— To‘satdan, maksimal kuchli og‘riq («momaqaldiroq zarbasi»).\n— Isitma va bo‘yin qotishi bilan, bosh jarohatidan keyingi og‘riq.\n— Qo‘l-oyoqda holsizlik, nutq yoki ko‘rish buzilishi bilan og‘riq.\n— 50 yoshdan keyin birinchi marta paydo bo‘lgan kuchli og‘riq.",
    adviceChips: [
      "Дневник головной боли",
      "Анальгетики ≤ 2 дней/нед",
      "Перерывы у экрана",
      "Контроль АД",
    ],
    defaultFollowUpDays: 14,
  },
  {
    code: "G62",
    matchPrefix: "G62",
    titleRu: "Полинейропатия",
    titleUz: "Polineyropatiya",
    whatToDoRu:
      "— Принимайте назначенное лечение и лечите основную причину (сахар крови, дефицит B12, отказ от алкоголя).\n— Ежедневно осматривайте стопы: трещины и ранки при сниженной чувствительности легко пропустить.\n— Носите удобную закрытую обувь без швов внутри.",
    whatToDoUz:
      "— Tayinlangan davoni oling va asosiy sababni davolang (qon qandi, B12 yetishmovchiligi, spirtli ichimlikni tashlash).\n— Har kuni oyoq panjalarini ko‘zdan kechiring: sezgi pasayganda yoriq va yaralarni o‘tkazib yuborish oson.\n— Ichida choki yo‘q, qulay yopiq poyabzal kiying.",
    careRu:
      "— Проверяйте температуру воды рукой или термометром перед ванной — стопы могут не почувствовать ожог.\n— Не ходите босиком, даже дома.",
    careUz:
      "— Cho‘milishdan oldin suv haroratini qo‘l yoki termometr bilan tekshiring — oyoqlar kuyishni sezmasligi mumkin.\n— Hatto uyda ham yalangoyoq yurmang.",
    lifestyleRu:
      "— Полный отказ от алкоголя.\n— При диабете — контроль сахара по плану эндокринолога.\n— Ежедневная ходьба и упражнения на равновесие.",
    lifestyleUz:
      "— Spirtli ichimlikdan butunlay voz keching.\n— Diabet bo‘lsa — endokrinolog rejasi bo‘yicha qand nazorati.\n— Har kuni piyoda yurish va muvozanat mashqlari.",
    redFlagsRu:
      "— Быстро нарастающая слабость в ногах/руках за часы-дни.\n— Затруднение дыхания или глотания.\n— Незаживающая рана или потемнение пальца стопы.",
    redFlagsUz:
      "— Soat-kunlar ichida oyoq/qo‘llarda tez kuchayib boruvchi holsizlik.\n— Nafas olish yoki yutish qiyinlashuvi.\n— Bitmaydigan yara yoki oyoq barmog‘ining qorayishi.",
    adviceChips: [
      "Осмотр стоп ежедневно",
      "Отказ от алкоголя",
      "Контроль сахара",
      "Не ходить босиком",
    ],
    defaultFollowUpDays: 30,
  },
  {
    code: "F41",
    matchPrefix: "F41",
    titleRu: "Тревожное расстройство",
    titleUz: "Xavotir buzilishi",
    whatToDoRu:
      "— Принимайте назначенные препараты ежедневно: эффект развивается через 2–4 недели, не бросайте раньше.\n— При приступе паники: медленный выдох длиннее вдоха (вдох 4 сек — выдох 6–8 сек), назовите 5 предметов вокруг.\n— Помните: паническая атака неприятна, но не опасна и проходит за 10–30 минут.",
    whatToDoUz:
      "— Tayinlangan dorilarni har kuni iching: ta’sir 2–4 haftada boshlanadi, oldin tashlamang.\n— Vahima xurujida: nafas chiqarish olishdan uzun bo‘lsin (4 soniya olish — 6–8 soniya chiqarish), atrofdagi 5 narsani nomlang.\n— Yodda tuting: vahima xuruji yoqimsiz, lekin xavfli emas, 10–30 daqiqada o‘tadi.",
    careRu:
      "— Ограничьте кофеин и энергетики — они имитируют симптомы тревоги.\n— Регулярный сон в одно и то же время.",
    careUz:
      "— Kofein va energetiklarni cheklang — ular xavotir belgilarini kuchaytiradi.\n— Bir xil vaqtda muntazam uxlang.",
    lifestyleRu:
      "— Аэробная нагрузка 30 минут 3–5 раз в неделю снижает тревогу не хуже лекарств.\n— Дыхательные практики или медитация 10 минут в день.\n— Сократите чтение новостей перед сном.",
    lifestyleUz:
      "— Haftasiga 3–5 marta 30 daqiqa aerob mashq xavotirni dori kabi kamaytiradi.\n— Kuniga 10 daqiqa nafas mashqlari yoki meditatsiya.\n— Uyqudan oldin yangiliklar o‘qishni kamaytiring.",
    redFlagsRu:
      "— Мысли о самоповреждении или нежелании жить — обратитесь за помощью немедленно.\n— Боль/давление в груди с одышкой и холодным потом — вызовите скорую для исключения сердечной причины.",
    redFlagsUz:
      "— O‘ziga zarar yetkazish yoki yashashni istamaslik xayollari — darhol yordamga murojaat qiling.\n— Hansirash va sovuq ter bilan ko‘krakdagi og‘riq/bosim — yurak sababini istisno qilish uchun tez yordam chaqiring.",
    adviceChips: [
      "Дыхание 4–8 при панике",
      "Без кофеина",
      "Аэробика 30 мин ×3/нед",
      "Сон по режиму",
    ],
    defaultFollowUpDays: 21,
  },
  {
    code: "I63",
    matchPrefix: "I63",
    titleRu: "Ишемический инсульт (восстановление)",
    titleUz: "Ishemik insult (tiklanish)",
    whatToDoRu:
      "— Принимайте все назначенные препараты (антиагреганты/антикоагулянты, статины, давление) пожизненно, без пропусков.\n— Измеряйте давление утром и вечером, ведите дневник.\n— Занимайтесь реабилитацией ежедневно: упражнения ЛФК, речевые упражнения по заданию логопеда.",
    whatToDoUz:
      "— Barcha tayinlangan dorilarni (antiagregant/antikoagulyant, statin, bosim dorisi) umrbod, qoldirmasdan iching.\n— Bosimni ertalab va kechqurun o‘lchab, kundalik yuriting.\n— Har kuni reabilitatsiya bilan shug‘ullaning: davolovchi mashqlar, logoped topshirig‘i bo‘yicha nutq mashqlari.",
    careRu:
      "— Родным: помогайте, но не делайте за пациента то, что он может сам — это замедляет восстановление.\n— Профилактика падений: уберите ковры и провода, поручни в ванной, хорошее освещение.",
    careUz:
      "— Yaqinlarga: yordam bering, lekin bemor o‘zi qila oladigan ishni uning o‘rniga qilmang — bu tiklanishni sekinlashtiradi.\n— Yiqilishdan saqlanish: gilam va simlarni olib qo‘ying, vannada tutqich, yaxshi yoritish.",
    lifestyleRu:
      "— Полный отказ от курения и алкоголя.\n— Соль ≤ 5 г/день, больше овощей и рыбы, меньше животных жиров.\n— Ходьба или доступная активность 30 минут в день.",
    lifestyleUz:
      "— Chekish va spirtli ichimlikdan butunlay voz keching.\n— Tuz ≤ 5 g/kun, ko‘proq sabzavot va baliq, kamroq hayvon yog‘lari.\n— Kuniga 30 daqiqa piyoda yurish yoki imkon darajasidagi faollik.",
    redFlagsRu:
      "— Новая слабость/онемение, перекос лица, нарушение речи — немедленно скорая (103): возможен повторный инсульт.\n— Внезапная сильнейшая головная боль, судороги, спутанность сознания.\n— Чёрный стул или кровоточивость на фоне разжижающих кровь препаратов.",
    redFlagsUz:
      "— Yangi holsizlik/uvishish, yuz qiyshayishi, nutq buzilishi — darhol tez yordam (103): qayta insult bo‘lishi mumkin.\n— To‘satdan juda kuchli bosh og‘rig‘i, tutqanoq, ongning chalkashishi.\n— Qon suyultiruvchi dorilar fonida qora najas yoki qon ketishi.",
    adviceChips: [
      "АД утром и вечером",
      "Препараты без пропусков",
      "ЛФК ежедневно",
      "Соль ≤ 5 г/день",
      "Отказ от курения",
    ],
    defaultFollowUpDays: 30,
  },
  {
    code: "G35",
    matchPrefix: "G35",
    titleRu: "Рассеянный склероз",
    titleUz: "Tarqoq skleroz",
    whatToDoRu:
      "— Принимайте назначенную терапию, изменяющую течение болезни, строго по схеме — она работает только при регулярном приёме.\n— Записывайте новые симптомы и их длительность: эпизод дольше 24 часов может быть обострением.\n— Не отменяйте и не меняйте лечение без врача.",
    whatToDoUz:
      "— Kasallik kechishini o‘zgartiruvchi tayinlangan davoni qat’iy jadval bo‘yicha oling — u faqat muntazam qabul qilinganda ishlaydi.\n— Yangi belgilar va ularning davomiyligini yozib boring: 24 soatdan uzoq epizod xuruj bo‘lishi mumkin.\n— Davoni shifokorsiz to‘xtatmang yoki o‘zgartirmang.",
    careRu:
      "— Избегайте перегрева: горячие ванны и жара временно усиливают симптомы (феномен Утхоффа).\n— Планируйте отдых в течение дня — усталость лучше предупреждать, чем пересиливать.",
    careUz:
      "— Qizib ketishdan saqlaning: issiq vanna va jazirama belgilarni vaqtincha kuchaytiradi.\n— Kun davomida dam olishni rejalashtiring — charchoqni yengishdan ko‘ra oldini olish yaxshi.",
    lifestyleRu:
      "— Регулярная умеренная активность (ходьба, плавание, йога) сохраняет силу и равновесие.\n— Витамин D по назначению врача, отказ от курения.\n— Прививки обсуждайте с неврологом заранее.",
    lifestyleUz:
      "— Muntazam yengil faollik (piyoda, suzish, yoga) kuch va muvozanatni saqlaydi.\n— Vitamin D — shifokor tayinlovi bo‘yicha; chekishni tashlang.\n— Emlashlarni nevrolog bilan oldindan maslahatlashing.",
    redFlagsRu:
      "— Новый стойкий симптом дольше 24 часов (слабость, онемение, ухудшение зрения) — свяжитесь с неврологом: возможно обострение.\n— Резкая потеря зрения на один глаз с болью при движении глаза.\n— Температура с резким ухудшением состояния.",
    redFlagsUz:
      "— 24 soatdan uzoq yangi turg‘un belgi (holsizlik, uvishish, ko‘rish yomonlashuvi) — nevrologga murojaat qiling: xuruj bo‘lishi mumkin.\n— Bir ko‘zda keskin ko‘rish yo‘qolishi, ko‘z harakatida og‘riq bilan.\n— Ahvolning keskin yomonlashuvi bilan isitma.",
    adviceChips: [
      "Избегать перегрева",
      "Дневник симптомов",
      "Витамин D",
      "Плановый отдых днём",
    ],
    defaultFollowUpDays: 90,
  },
  {
    code: "G20",
    matchPrefix: "G20",
    titleRu: "Болезнь Паркинсона",
    titleUz: "Parkinson kasalligi",
    whatToDoRu:
      "— Принимайте препараты строго по часам — равные интервалы важнее привязки к еде (леводопу — за 30–60 минут до еды).\n— Не пропускайте и не сдваивайте дозы.\n— Ежедневная гимнастика: крупные движения, растяжка, тренировка походки и голоса.",
    whatToDoUz:
      "— Dorilarni soat bo‘yicha qat’iy iching — teng intervallar muhim (levodopa — ovqatdan 30–60 daqiqa oldin).\n— Dozani o‘tkazib yubormang va ikkilantirmang.\n— Har kuni gimnastika: keng harakatlar, cho‘zilish, yurish va ovoz mashqlari.",
    careRu:
      "— Профилактика падений: уберите пороги и ковры, поручни в ванной, обувь с нескользкой подошвой.\n— Вставайте медленно: сначала посидите на краю кровати — препараты могут снижать давление.",
    careUz:
      "— Yiqilishdan saqlanish: ostona va gilamlarni olib tashlang, vannada tutqich, sirpanmaydigan poyabzal.\n— Sekin turing: avval krovat chetida o‘tiring — dorilar bosimni tushirishi mumkin.",
    lifestyleRu:
      "— Белковую пищу смещайте на вечер, если она ослабляет действие леводопы.\n— Больше клетчатки и воды — запоры частый спутник болезни.\n— Танцы, скандинавская ходьба, тай-чи доказанно улучшают походку.",
    lifestyleUz:
      "— Oqsilli ovqat levodopa ta’sirini susaytirsa, uni kechga suring.\n— Ko‘proq tola va suv — ich qotishi kasallikning tez-tez hamrohi.\n— Raqs, skandinav yurishi, tay-chi yurishni isbotlangan tarzda yaxshilaydi.",
    redFlagsRu:
      "— Внезапная невозможность двигаться или спутанность после смены дозы.\n— Галлюцинации, выраженная сонливость днём.\n— Частые падения, поперхивание при еде и питье.",
    redFlagsUz:
      "— Doza o‘zgargach to‘satdan harakatlana olmaslik yoki ongning chalkashishi.\n— Gallyutsinatsiyalar, kunduzi kuchli uyquchanlik.\n— Tez-tez yiqilish, ovqat va suv ichganda qalqib ketish.",
    adviceChips: [
      "Препараты по часам",
      "Гимнастика ежедневно",
      "Убрать ковры и пороги",
      "Вставать медленно",
    ],
    defaultFollowUpDays: 60,
  },
  {
    code: "G44.2",
    matchPrefix: "G44.2",
    titleRu: "Головная боль напряжения",
    titleUz: "Zo‘riqish bosh og‘rig‘i",
    whatToDoRu:
      "— Разминайте шею и плечи каждые 1–2 часа при сидячей работе.\n— Обезболивающие — эпизодически, не чаще 2 дней в неделю.\n— Тёплый душ на шею и воротниковую зону, лёгкий самомассаж висков.",
    whatToDoUz:
      "— O‘tirib ishlaganda har 1–2 soatda bo‘yin va yelkalarni yozing.\n— Og‘riq qoldiruvchilar — vaqti-vaqti bilan, haftada ko‘pi bilan 2 kun.\n— Bo‘yin va yelka sohasiga iliq dush, chakkalarga yengil massaj.",
    careRu:
      "— Настройте рабочее место: экран на уровне глаз, опора для поясницы.\n— Проверьте зрение — некорригированная близорукость поддерживает напряжение.",
    careUz:
      "— Ish joyini sozlang: ekran ko‘z balandligida, belga tayanch.\n— Ko‘rishni tekshirtiring — tuzatilmagan miopiya zo‘riqishni saqlaydi.",
    lifestyleRu:
      "— Регулярная аэробная активность и достаточный сон.\n— Техники расслабления при стрессе: дыхание, прогулка, растяжка.",
    lifestyleUz:
      "— Muntazam aerob faollik va yetarli uyqu.\n— Stressda bo‘shashish usullari: nafas mashqlari, sayr, cho‘zilish.",
    redFlagsRu:
      "— Боль изменила характер: стала внезапной, громоподобной или будит по ночам.\n— Присоединились тошнота, светобоязнь, неврологические симптомы.\n— Боль чаще 15 дней в месяц — нужен пересмотр лечения.",
    redFlagsUz:
      "— Og‘riq xarakteri o‘zgardi: to‘satdan, juda kuchli bo‘ldi yoki kechasi uyg‘otadi.\n— Ko‘ngil aynishi, yorug‘likdan qo‘rqish, nevrologik belgilar qo‘shildi.\n— Og‘riq oyiga 15 kundan ko‘p — davoni qayta ko‘rish kerak.",
    adviceChips: [
      "Разминка шеи каждый час",
      "Экран на уровне глаз",
      "Анальгетики ≤ 2 дней/нед",
      "Проверить зрение",
    ],
    defaultFollowUpDays: 21,
  },
  {
    code: "G50",
    matchPrefix: "G50",
    titleRu: "Невралгия тройничного нерва",
    titleUz: "Uch shoxli nerv nevralgiyasi",
    whatToDoRu:
      "— Принимайте назначенный препарат (карбамазепин и аналоги) строго по схеме, дозу меняет только врач.\n— Запоминайте триггеры (умывание, бритьё, жевание, холодный ветер) и щадите эти зоны.\n— Обычные анальгетики при этой боли почти не работают — не повышайте их дозы самостоятельно.",
    whatToDoUz:
      "— Tayinlangan dorini (karbamazepin va o‘xshashlari) qat’iy jadval bo‘yicha iching, dozani faqat shifokor o‘zgartiradi.\n— Triggerlarni eslab qoling (yuvinish, soqol olish, chaynash, sovuq shamol) va shu sohalarni avaylang.\n— Oddiy og‘riq qoldiruvchilar bu og‘riqda deyarli ishlamaydi — dozani o‘zingiz oshirmang.",
    careRu:
      "— Умывайтесь тёплой водой, жуйте на здоровой стороне.\n— В холод закрывайте лицо шарфом.",
    careUz:
      "— Iliq suvda yuvining, sog‘ tomonda chaynang.\n— Sovuqda yuzni sharf bilan yoping.",
    redFlagsRu:
      "— Головокружение, сыпь, двоение или выраженная сонливость на фоне препарата — свяжитесь с врачом (возможна коррекция дозы).\n— Онемение лица, слабость жевания, снижение слуха — нужна дообследование.\n— Боль перестала сниматься привычной дозой.",
    redFlagsUz:
      "— Dori fonida bosh aylanishi, toshma, ikkilanish yoki kuchli uyquchanlik — shifokorga murojaat qiling (doza tuzatilishi mumkin).\n— Yuzda uvishish, chaynash holsizligi, eshitish pasayishi — qo‘shimcha tekshiruv kerak.\n— Og‘riq odatdagi doza bilan bosilmay qoldi.",
    adviceChips: [
      "Тёплая вода для умывания",
      "Шарф в холодную погоду",
      "Жевать на здоровой стороне",
    ],
    defaultFollowUpDays: 14,
  },
  {
    code: "R42",
    matchPrefix: "R42",
    titleRu: "Головокружение",
    titleUz: "Bosh aylanishi",
    whatToDoRu:
      "— При приступе сядьте или лягте, зафиксируйте взгляд на неподвижной точке, не закрывайте глаза.\n— Вставайте медленно, в два этапа: сначала сесть, через 30 секунд — встать.\n— Выполняйте назначенную вестибулярную гимнастику ежедневно — она тренирует равновесие.",
    whatToDoUz:
      "— Xurujda o‘tiring yoki yoting, nigohni qimirlamas nuqtaga qadang, ko‘zni yummang.\n— Sekin, ikki bosqichda turing: avval o‘tiring, 30 soniyadan keyin turing.\n— Tayinlangan vestibulyar gimnastikani har kuni bajaring — u muvozanatni mashq qildiradi.",
    careRu:
      "— Уберите дома то, обо что можно споткнуться; ночью включайте ночник.\n— Не водите машину и не работайте на высоте до разрешения врача.",
    careUz:
      "— Uyda qoqilib ketish mumkin bo‘lgan narsalarni olib tashlang; kechasi tungi chiroq yoqing.\n— Shifokor ruxsatigacha mashina haydamang va balandlikda ishlamang.",
    lifestyleRu:
      "— Пейте достаточно воды, не пропускайте еду.\n— Ограничьте кофеин и алкоголь.\n— Достаточный сон — недосып усиливает головокружение.",
    lifestyleUz:
      "— Yetarli suv iching, ovqatni o‘tkazib yubormang.\n— Kofein va spirtli ichimlikni cheklang.\n— Yetarli uxlang — uyqusizlik bosh aylanishini kuchaytiradi.",
    redFlagsRu:
      "— Головокружение с двоением, нарушением речи, слабостью конечностей, перекосом лица — немедленно скорая (103).\n— Впервые возникшее сильное головокружение с рвотой, не проходящее в покое.\n— Внезапная глухота на одно ухо, падения с потерей сознания.",
    redFlagsUz:
      "— Ikkilanish, nutq buzilishi, qo‘l-oyoq holsizligi, yuz qiyshayishi bilan bosh aylanishi — darhol tez yordam (103).\n— Birinchi marta, qusish bilan, tinch holatda o‘tmaydigan kuchli bosh aylanishi.\n— Bir quloqda to‘satdan karlik, hushdan ketish bilan yiqilish.",
    adviceChips: [
      "Вставать в два этапа",
      "Вестибулярная гимнастика",
      "Ночник ночью",
      "Не водить до разрешения",
    ],
    defaultFollowUpDays: 14,
  },
  {
    code: "G51.0",
    matchPrefix: "G51.0",
    titleRu: "Неврит лицевого нерва (паралич Белла)",
    titleUz: "Yuz nervi nevriti (Bell falaji)",
    whatToDoRu:
      "— Начните назначенное лечение как можно раньше — первые 72 часа самые важные.\n— Если глаз не закрывается: увлажняющие капли днём, гель и повязка на ночь — роговицу нужно защитить.\n— Гимнастика для лица перед зеркалом 2–3 раза в день после стихания острой фазы.",
    whatToDoUz:
      "— Tayinlangan davoni imkon qadar erta boshlang — dastlabki 72 soat eng muhim.\n— Ko‘z yopilmasa: kunduzi namlovchi tomchilar, kechasi gel va bog‘lam — shox pardani himoya qilish kerak.\n— O‘tkir bosqich o‘tgach, kuniga 2–3 marta oyna oldida yuz gimnastikasi.",
    careRu:
      "— Защищайте лицо от холода и сквозняков.\n— Жуйте медленно, на здоровой стороне; следите за остатками пищи за щекой.",
    careUz:
      "— Yuzni sovuq va shamoldan asrang.\n— Sekin, sog‘ tomonda chaynang; lunj ortida ovqat qoldig‘i qolmasligini kuzating.",
    redFlagsRu:
      "— Слабость в руке или ноге, нарушение речи или глотания — это не неврит, немедленно скорая (103).\n— Боль и краснота глаза, ухудшение зрения.\n— Пузырьковая сыпь в ухе или на лице, сильная боль в ухе.",
    redFlagsUz:
      "— Qo‘l yoki oyoqda holsizlik, nutq yoki yutish buzilishi — bu nevrit emas, darhol tez yordam (103).\n— Ko‘zda og‘riq va qizarish, ko‘rish yomonlashuvi.\n— Quloq yoki yuzda pufakchali toshma, quloqda kuchli og‘riq.",
    adviceChips: [
      "Защита глаза (капли, повязка)",
      "Гимнастика у зеркала",
      "Беречь лицо от холода",
    ],
    defaultFollowUpDays: 7,
  },
  {
    code: "G56.0",
    matchPrefix: "G56.0",
    titleRu: "Синдром запястного канала",
    titleUz: "Kaft usti kanali sindromi",
    whatToDoRu:
      "— Носите ортез на запястье ночью — он держит кисть в нейтральном положении и снимает ночное онемение.\n— Делайте перерывы каждые 30–45 минут при работе с мышью/телефоном, встряхивайте кисти.\n— Выполняйте упражнения скольжения нерва по инструкции.",
    whatToDoUz:
      "— Kechasi bilakka ortez taqing — u qo‘lni neytral holatda ushlab, tungi uvishishni kamaytiradi.\n— Sichqoncha/telefon bilan ishlaganda har 30–45 daqiqada tanaffus qiling, qo‘llarni silkiting.\n— Ko‘rsatma bo‘yicha nerv sirpanish mashqlarini bajaring.",
    careRu:
      "— Настройте рабочее место: запястье прямое, не опирается на острый край стола.\n— Избегайте долгого сжатия (инструмент, руль) и вибрации.",
    careUz:
      "— Ish joyini sozlang: bilak tekis bo‘lsin, stolning o‘tkir qirrasiga tayanmasin.\n— Uzoq siqish (asbob, rul) va vibratsiyadan saqlaning.",
    redFlagsRu:
      "— Постоянное онемение без светлых промежутков, предметы выпадают из руки.\n— Похудение мышцы у основания большого пальца.\n— Онемение поднялось выше кисти или появилось с обеих сторон внезапно.",
    redFlagsUz:
      "— Tinim bermaydigan doimiy uvishish, narsalar qo‘ldan tushib ketadi.\n— Bosh barmoq asosidagi mushakning ozishi.\n— Uvishish bilakdan yuqoriga ko‘tarildi yoki to‘satdan ikki tomonlama boshlandi.",
    adviceChips: [
      "Ортез на ночь",
      "Перерывы каждые 30–45 мин",
      "Прямое запястье при работе",
    ],
    defaultFollowUpDays: 21,
  },
  {
    code: "M50",
    matchPrefix: "M50",
    titleRu: "Остеохондроз шейного отдела / грыжа диска",
    titleUz: "Bo‘yin osteoxondrozi / disk churrasi",
    whatToDoRu:
      "— Принимайте назначенные препараты по схеме; воротник Шанца — только короткими периодами, если назначен.\n— Избегайте резких поворотов головы и запрокидывания (потолок красить нельзя).\n— После стихания боли — ежедневная лечебная гимнастика для шеи, плавно и без боли.",
    whatToDoUz:
      "— Tayinlangan dorilarni jadval bo‘yicha iching; Shans yoqasi — faqat qisqa muddat, tayinlangan bo‘lsa.\n— Boshni keskin burish va orqaga tashlashdan saqlaning.\n— Og‘riq bosilgach — har kuni bo‘yin uchun davolovchi gimnastika, ohista va og‘riqsiz.",
    careRu:
      "— Подушка средней высоты, поддерживающая шею; не спите на животе.\n— Экран на уровне глаз, телефон не зажимайте плечом.",
    careUz:
      "— O‘rtacha balandlikdagi, bo‘yinni tutib turadigan yostiq; qorinda uxlamang.\n— Ekran ko‘z balandligida; telefonni yelka bilan qismang.",
    lifestyleRu:
      "— Регулярные перерывы при сидячей работе, укрепление мышц спины.\n— Плавание на спине разгружает шейный отдел.",
    lifestyleUz:
      "— O‘tirib ishlaganda muntazam tanaffuslar, orqa mushaklarini mustahkamlash.\n— Chalqancha suzish bo‘yin umurtqasini yengillashtiradi.",
    redFlagsRu:
      "— Нарастающая слабость или онемение в руке, неловкость пальцев.\n— Шаткость походки, онемение в ногах — признаки сдавления спинного мозга.\n— Боль с температурой или после травмы.",
    redFlagsUz:
      "— Qo‘lda kuchayib boruvchi holsizlik yoki uvishish, barmoqlar beso‘naqayligi.\n— Yurish beqarorligi, oyoqlarda uvishish — orqa miya siqilishi belgilari.\n— Isitma bilan yoki jarohatdan keyingi og‘riq.",
    adviceChips: [
      "Подушка средней высоты",
      "Экран на уровне глаз",
      "Гимнастика для шеи",
      "Не спать на животе",
    ],
    defaultFollowUpDays: 14,
  },
  {
    code: "M51",
    matchPrefix: "M51",
    titleRu: "Грыжа поясничного диска",
    titleUz: "Bel disk churrasi",
    whatToDoRu:
      "— Большинство грыж уменьшается без операции за 6–12 недель — выполняйте план лечения.\n— Сохраняйте активность в пределах терпимой боли; долгий постельный режим вреден.\n— Поднимая предметы — приседайте с прямой спиной, держите груз близко к телу.",
    whatToDoUz:
      "— Ko‘pchilik churralar 6–12 haftada operatsiyasiz kichrayadi — davolash rejasini bajaring.\n— Chidasa bo‘ladigan og‘riq doirasida faol bo‘ling; uzoq yotish zararli.\n— Narsa ko‘targanda — beli tik holda cho‘qqaying, yukni tanaga yaqin tuting.",
    careRu:
      "— Не сидите дольше 30–40 минут подряд в остром периоде.\n— При сидении — опора под поясницу; вставайте через положение на боку.",
    careUz:
      "— O‘tkir davrda 30–40 daqiqadan ortiq surunkali o‘tirmang.\n— O‘tirganda belga tayanch qo‘ying; yotgan joydan yonboshlab turing.",
    lifestyleRu:
      "— После стихания боли — ходьба, плавание, укрепление мышц кора.\n— Контроль веса, отказ от курения (ухудшает питание диска).",
    lifestyleUz:
      "— Og‘riq bosilgach — piyoda yurish, suzish, tana mushaklarini mustahkamlash.\n— Vazn nazorati, chekishni tashlash (disk oziqlanishini yomonlashtiradi).",
    redFlagsRu:
      "— Онемение промежности, нарушение мочеиспускания/стула — синдром конского хвоста, экстренно в больницу.\n— Нарастающая слабость стопы (шлепает при ходьбе).\n— Невыносимая боль, не снимающаяся назначенными препаратами.",
    redFlagsUz:
      "— Oraliq sohada uvishish, siydik/najas buzilishi — «ot dumi» sindromi, zudlik bilan shifoxonaga.\n— Oyoq panjasida kuchayib boruvchi holsizlik (yurganda shapillaydi).\n— Tayinlangan dorilar bosa olmaydigan chidab bo‘lmas og‘riq.",
    adviceChips: [
      "Не сидеть дольше 40 мин",
      "Приседать, не наклоняться",
      "Ходьба ежедневно",
      "Укрепление кора",
    ],
    defaultFollowUpDays: 14,
  },
  {
    code: "F45.3",
    matchPrefix: "F45.3",
    titleRu: "Соматоформная вегетативная дисфункция",
    titleUz: "Somatoform vegetativ disfunksiya",
    whatToDoRu:
      "— Обследование не выявило опасного заболевания органов — симптомы реальны, но их источник в перегрузке нервной системы.\n— Принимайте назначенную терапию курсом, эффект накапливается 2–4 недели.\n— Освойте дыхание животом: 5 минут 3 раза в день и при волне симптомов.",
    whatToDoUz:
      "— Tekshiruvlar a’zolarning xavfli kasalligini topmadi — belgilar haqiqiy, lekin manbai asab tizimining zo‘riqishi.\n— Tayinlangan davoni kurs bilan oling, ta’sir 2–4 haftada to‘planadi.\n— Qorin bilan nafas olishni o‘rganing: kuniga 3 marta 5 daqiqadan va belgilar kuchayganda.",
    careRu:
      "— Режим сна и регулярное питание — основа стабильности вегетатики.\n— Сократите кофеин, энергетики и мониторинг пульса «на всякий случай».",
    careUz:
      "— Uyqu tartibi va muntazam ovqatlanish — vegetatika barqarorligining asosi.\n— Kofein, energetiklar va «har ehtimolga» puls o‘lchashni kamaytiring.",
    lifestyleRu:
      "— Аэробная нагрузка 30 минут через день — тренирует сосудистый тонус.\n— Контрастный душ, прогулки, хобби со сменой фокуса внимания.",
    lifestyleUz:
      "— Kunora 30 daqiqa aerob mashq — tomir tonusini mashq qildiradi.\n— Kontrast dush, sayr, diqqatni almashtiruvchi mashg‘ulotlar.",
    redFlagsRu:
      "— Давящая боль за грудиной при нагрузке, отдающая в руку/челюсть — скорая (103).\n— Обморок с травмой, впервые возникшие перебои сердца в покое.\n— Мысли о нежелании жить.",
    redFlagsUz:
      "— Yuk paytida to‘sh orqasidagi siquvchi og‘riq, qo‘l/jag‘ga berishi — tez yordam (103).\n— Jarohat bilan hushdan ketish, tinch holatda birinchi marta yurak urishidagi uzilishlar.\n— Yashashni istamaslik xayollari.",
    adviceChips: [
      "Дыхание животом 3×5 мин",
      "Без кофеина и энергетиков",
      "Аэробика через день",
      "Режим сна",
    ],
    defaultFollowUpDays: 21,
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const [i, g] of GUIDES.entries()) {
    const data = {
      matchPrefix: g.matchPrefix,
      titleRu: g.titleRu,
      titleUz: g.titleUz,
      whatToDoRu: g.whatToDoRu,
      whatToDoUz: g.whatToDoUz,
      careRu: g.careRu ?? null,
      careUz: g.careUz ?? null,
      lifestyleRu: g.lifestyleRu ?? null,
      lifestyleUz: g.lifestyleUz ?? null,
      redFlagsRu: g.redFlagsRu,
      redFlagsUz: g.redFlagsUz,
      adviceChips: g.adviceChips,
      defaultFollowUpDays: g.defaultFollowUpDays ?? null,
      sortOrder: i,
      active: true,
    };

    const existing = await prisma.diagnosisGuide.findFirst({
      where: { clinicId: null, code: g.code },
      select: { id: true },
    });

    if (existing) {
      await prisma.diagnosisGuide.update({
        where: { id: existing.id },
        data,
      });
      updated += 1;
      console.log(`  [update] ${g.code} — ${g.titleRu}`);
    } else {
      await prisma.diagnosisGuide.create({
        data: { ...data, clinicId: null, code: g.code },
      });
      created += 1;
      console.log(`  [create] ${g.code} — ${g.titleRu}`);
    }
  }

  console.log(`Done: ${created} created, ${updated} updated, ${GUIDES.length} total.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
