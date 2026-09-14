/**
 * The sections of the settings page.
 *
 * Kept apart from the settings themselves so the page can import it without pulling the database
 * client into the browser bundle: the reader and the writer live in lib/settings, and only these
 * four titles are needed to lay the page out.
 */

export type SettingGroup = "modes" | "prices" | "referrals" | "numbers";

/** In the order they are shown: what switches the bot first, what it charges after. */
export const settingGroups: Array<{ key: SettingGroup; title: string; note: string }> = [
  { key: "modes", title: "أوضاع التشغيل", note: "ما يغيّر سلوك البوت كله. التبديل هنا فوري." },
  { key: "prices", title: "الأسعار والخصم", note: "ما يُخصم من المستخدم ومتى." },
  { key: "referrals", title: "المسوّقون والعمولات", note: "ما يكسبه المسوّق ومتى يستطيع سحبه." },
  { key: "numbers", title: "الأرقام", note: "أرقام واتساب التي يعمل عليها النظام." }
];
