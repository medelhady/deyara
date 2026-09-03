import type { ExtractedMessage } from "./types";
import {
  equalsAny,
  greetings,
  includesAny,
  introPhrases,
  ownerListingPhrases,
  renterSearchPhrases,
  type RuntimeDictionary
} from "./local-dictionary";

const areas = ["تفرغ زينة", "لكصر", "عرفات", "تيارت", "دار النعيم", "السبخة", "الميناء", "نواكشوط"];
const propertyTypes = ["شقة", "منزل", "فيلا", "غرفة", "محل", "مكتب"];

/**
 * Latin digits only. Mauritania writes 0-9, and the Eastern forms are not read here at all -- so
 * accepting them was code guarding against a keyboard nobody uses, on a path where a wrong number is
 * a wrong rent.
 */
function extractNumber(text: string) {
  const match = text.match(/\d{2,8}/);
  return match ? Number(match[0]) : undefined;
}

export function extractMessage(text: string, dictionary?: RuntimeDictionary): ExtractedMessage {
  const body = text.trim();
  const activeGreetings = dictionary?.greetings ?? greetings;
  const activeIntroPhrases = dictionary?.introPhrases ?? introPhrases;
  const activeRenterSearchPhrases = dictionary?.renterSearchPhrases ?? renterSearchPhrases;
  const activeOwnerListingPhrases = dictionary?.ownerListingPhrases ?? ownerListingPhrases;
  const activeAreas = [...areas, ...(dictionary?.areas ?? [])];

  if (/^(مرحب|مرحبا|مرحبتين|اهلا|أهلا|اهلين|أهلين|السلام|السلام عليكم|سلام)$/i.test(body)) {
    return { intent: "greeting" };
  }

  if (equalsAny(body, activeGreetings)) {
    return { intent: "greeting" };
  }

  if (equalsAny(body.toLowerCase(), activeIntroPhrases)) {
    return { intent: "intro" };
  }

  if (body === "0") {
    return { intent: "search_property", searchText: "__more__" };
  }

  if (/^(اريد اكثر|أريد أكثر|المزيد|زيادة|زيد|اكثر|أكثر)$/i.test(body)) {
    return { intent: "search_property", searchText: "__more__" };
  }

  const selected = body.match(/^\d+$/);
  if (selected) {
    return { intent: "select_property", selectedIndex: Number(selected[0]) };
  }

  const propertyType = propertyTypes.find((type) => body.includes(type));
  const area = activeAreas.find((item) => body.includes(item));
  const price = extractNumber(body);
  const roomsMatch = body.match(/(\d+)\s*(غرف|غرفة|غرفه)/);
  const landmarkMatch = body.match(/(?:قريب من|قرب|بجانب|جنب)\s+(.+?)(?:\s+ب|\s+بسعر|$)/);
  const searchText = landmarkMatch?.[1]?.trim();
  const budgetPatterns = [
    /(?:^|\s)(?:بحد|الحد|حد)\s*(?:اقصى|أقصى)/,
    /(?:^|\s)(?:اقل|أقل)\s*من/,
    /ما يتجاوز|لا يتجاوز|ميزانية/,
    /(?:^|\s)بـ?\s*\d/
  ];
  const mentionsBudget = budgetPatterns.some((pattern) => pattern.test(body));
  const mentionsCheaper = /(?:^|\s)(?:ارخص|أرخص|الأرخص)(?:$|\s)/.test(body);
  const mentionsPricier = /(?:^|\s)(?:اغلى|أغلى|الأغلى)(?:$|\s)/.test(body);
  const wantsCheapest = /^(ارخص|أرخص|الأرخص|اقل سعر|أقل سعر|رخيص|الرخيص)$/i.test(body);
  const wantsExpensive = /^(اغلى|أغلى|الأغلى|اعلى سعر|أعلى سعر)$/i.test(body);

  const hasOwnershipSignal = /عندي|لدي/.test(body);
  const hasRequestPhrase =
    hasOwnershipSignal ||
    includesAny(body, activeOwnerListingPhrases) ||
    includesAny(body, activeRenterSearchPhrases);
  // A self-contained request ("أريد شقة في تفرغ زينة بحد أقصى 2450") starts a new search instead of
  // refining the previous one, while a bare filter ("أرخص"، "غرفتين") still refines.
  const startsNewRequest = hasRequestPhrase && Boolean(area || propertyType);

  if (
    !startsNewRequest &&
    (wantsCheapest || wantsExpensive || mentionsBudget || mentionsCheaper || mentionsPricier || roomsMatch)
  ) {
    return {
      intent: "refine_search",
      maxPrice: mentionsBudget ? price : undefined,
      rooms: roomsMatch ? Number(roomsMatch[1]) : undefined,
      sortBy:
        wantsCheapest || mentionsCheaper
          ? "cheapest"
          : wantsExpensive || mentionsPricier
            ? "expensive"
            : undefined
    };
  }

  if (hasOwnershipSignal || includesAny(body, activeOwnerListingPhrases)) {
    return {
      intent: "add_property",
      propertyType,
      area,
      landmark: landmarkMatch?.[1]?.trim(),
      price,
      rooms: roomsMatch ? Number(roomsMatch[1]) : undefined
    };
  }

  if (includesAny(body, activeRenterSearchPhrases)) {
    return {
      intent: "search_property",
      propertyType,
      area,
      maxPrice: mentionsBudget ? price : undefined,
      price: mentionsBudget ? undefined : price,
      searchText,
      rooms: roomsMatch ? Number(roomsMatch[1]) : undefined
    };
  }

  if (/رقم|تواصل|صاحب|مالك|المؤجر/.test(body)) {
    return { intent: "request_contact" };
  }

  if (/ايصال|إيصال|وصل|حوالة|دفعت|حولت/.test(body)) {
    return { intent: "send_payment_receipt" };
  }

  return { intent: "unknown" };
}