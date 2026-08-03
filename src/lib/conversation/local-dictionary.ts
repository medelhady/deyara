export const greetings = [
  "السلام",
  "السلام عليكم",
  "سلام",
  "اهلا",
  "أهلا",
  "مرحبا",
  "مساء الخير",
  "صباح الخير"
];

export const introPhrases = [
  "شات",
  "ابدأ",
  "بدء",
  "start",
  "hello",
  "hi"
];

export const renterSearchPhrases = [
  "اريد",
  "أريد",
  "ابحث",
  "أبحث",
  "نبحث",
  "ندور",
  "نفتش",
  "احتاج",
  "أحتاج",
  "باغي",
  "بغيت",
  "عايز",
  "عاوز",
  "حبيت",
  "كراء",
  "للكراء",
  "للايجار",
  "للإيجار",
  "اكري",
  "أكري",
  "كاري"
];

export const ownerListingPhrases = [
  "عندي",
  "لدي",
  "عندي دار",
  "عندي شقة",
  "نأجر",
  "ناجر",
  "للكراء عندي",
  "للإيجار عندي",
  "متوفر عندي"
];

export function includesAny(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(phrase));
}

export function equalsAny(text: string, phrases: string[]) {
  return phrases.some((phrase) => text === phrase);
}
