import type { Icd10Entry } from "@/server/icd10/data";

export type Icd10Chapter = {
  id: string;
  range: string;
  label: string;
};

export const ICD10_CHAPTERS: Icd10Chapter[] = [
  { id: "A00-B99", range: "A00–B99", label: "Инфекционные и паразитарные болезни" },
  { id: "C00-D48", range: "C00–D48", label: "Новообразования" },
  { id: "D50-D89", range: "D50–D89", label: "Болезни крови и иммунной системы" },
  { id: "E00-E90", range: "E00–E90", label: "Эндокринные, болезни обмена" },
  { id: "F00-F99", range: "F00–F99", label: "Психические и поведенческие расстройства" },
  { id: "G00-G99", range: "G00–G99", label: "Болезни нервной системы" },
  { id: "H00-H59", range: "H00–H59", label: "Болезни глаза" },
  { id: "H60-H95", range: "H60–H95", label: "Болезни уха" },
  { id: "I00-I99", range: "I00–I99", label: "Болезни системы кровообращения" },
  { id: "J00-J99", range: "J00–J99", label: "Болезни органов дыхания" },
  { id: "K00-K93", range: "K00–K93", label: "Болезни органов пищеварения" },
  { id: "L00-L99", range: "L00–L99", label: "Болезни кожи и подкожной клетчатки" },
  { id: "M00-M99", range: "M00–M99", label: "Костно-мышечная система" },
  { id: "N00-N99", range: "N00–N99", label: "Мочеполовая система" },
  { id: "R00-R99", range: "R00–R99", label: "Симптомы и признаки" },
  { id: "S00-T98", range: "S00–T98", label: "Травмы и отравления" },
  { id: "Z00-Z99", range: "Z00–Z99", label: "Факторы здоровья и обращения к врачу" },
];

export function chapterIdFor(code: string): string | null {
  const letter = code.charAt(0).toUpperCase();
  const num = parseInt(code.slice(1, 3), 10);
  if (Number.isNaN(num)) return null;

  switch (letter) {
    case "A":
    case "B":
      return "A00-B99";
    case "C":
      return "C00-D48";
    case "D":
      return num <= 48 ? "C00-D48" : "D50-D89";
    case "E":
      return "E00-E90";
    case "F":
      return "F00-F99";
    case "G":
      return "G00-G99";
    case "H":
      return num <= 59 ? "H00-H59" : "H60-H95";
    case "I":
      return "I00-I99";
    case "J":
      return "J00-J99";
    case "K":
      return "K00-K93";
    case "L":
      return "L00-L99";
    case "M":
      return "M00-M99";
    case "N":
      return "N00-N99";
    case "R":
      return "R00-R99";
    case "S":
    case "T":
      return "S00-T98";
    case "Z":
      return "Z00-Z99";
    default:
      return null;
  }
}

export function groupByChapter(entries: Icd10Entry[]): Map<string, Icd10Entry[]> {
  const map = new Map<string, Icd10Entry[]>();
  for (const e of entries) {
    const id = chapterIdFor(e.code);
    if (!id) continue;
    const list = map.get(id);
    if (list) list.push(e);
    else map.set(id, [e]);
  }
  return map;
}
