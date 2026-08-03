import type { ExtractedMessage } from "./types";

const areas = ["تفرغ زينة", "لكصر", "عرفات", "تيارت", "دار النعيم", "السبخة", "الميناء", "نواكشوط"];
const propertyTypes = ["شقة", "منزل", "فيلا", "غرفة", "محل", "مكتب"];

function extractNumber(text: string) {
  const normalized = text.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const match = normalized.match(/\d{2,8}/);
  return match ? Number(match[0]) : undefined;
}

export function extractMessage(text: string): ExtractedMessage {
  const body = text.trim();
  const selected = body.match(/^\d+$/);
  if (selected) {
    return { intent: "select_property", selectedIndex: Number(selected[0]) };
  }

  const propertyType = propertyTypes.find((type) => body.includes(type));
  const area = areas.find((item) => body.includes(item));
  const price = extractNumber(body);
  const roomsMatch = body.match(/(\d+)\s*(غرف|غرفة|غرفه)/);
  const landmarkMatch = body.match(/(?:قريب من|قرب|بجانب|جنب)\s+(.+?)(?:\s+ب|\s+بسعر|$)/);
  const searchText = landmarkMatch?.[1]?.trim();
  const mentionsBudget = /حد|اقصى|أقصى|اقل|أقل|أرخص|ما يتجاوز|لا يتجاوز|بحد|ميزانية|بـ|ب /.test(body);

  if (/اريد|أريد|ابحث|أبحث|نبحث|احتاج|أحتاج/.test(body)) {
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

  if (/عندي|لدي|للإيجار|للايجار|ايجار|إيجار|منزل|شقة|فيلا/.test(body)) {
    return {
      intent: "add_property",
      propertyType,
      area,
      landmark: landmarkMatch?.[1]?.trim(),
      price,
      rooms: roomsMatch ? Number(roomsMatch[1]) : undefined
    };
  }

  return { intent: "unknown" };
}
