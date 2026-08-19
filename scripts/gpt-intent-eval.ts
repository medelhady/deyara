/**
 * Runs real messages through the GPT extractor and checks what it returns.
 *
 * Every intent bug reported so far came from GPT overriding a correct regex answer, and none of
 * them could be caught locally because the fallback path is the only one that runs without a key.
 * This is the missing check. It calls the live model, so it costs a few cents and is run by hand:
 *
 *   OPENAI_API_KEY=... npx tsx scripts/gpt-intent-eval.ts
 *
 * A case fails loudly with what was expected and what came back, so a prompt change can be measured
 * instead of guessed at.
 */
import { readFileSync } from "node:fs";
import { aiExtractMessage } from "../src/lib/conversation/ai-extract";
import { buildContextHint } from "../src/lib/conversation/engine";
import type { ConversationState, ExtractedMessage } from "../src/lib/conversation/types";

// Run outside Next, so .env.local is not loaded for us.
function loadEnvLocal() {
  if (process.env.OPENAI_API_KEY) {
    return;
  }

  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);

      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local is fine; the key may come from the environment.
  }
}

loadEnvLocal();

const areas = ["تفرغ زينة", "عرفات", "لكصر", "تيارت", "دار النعيم", "السبخة", "الميناء"];

type Case = {
  name: string;
  body: string;
  state?: ConversationState;
  /** Returns null when the answer is acceptable, or the reason it is not. */
  check: (result: ExtractedMessage | null) => string | null;
};

const draftAwaitingLandmark: ConversationState = {
  draftProperty: { type: "منزل", area: "لكصر", price: 35000, updatedAt: new Date().toISOString() }
};

const draftAwaitingArea: ConversationState = {
  draftProperty: { type: "شقة", updatedAt: new Date().toISOString() }
};

function intentIs(expected: string) {
  return (result: ExtractedMessage | null) =>
    result?.intent === expected ? null : `توقعت ${expected} وجاء ${result?.intent ?? "null"}`;
}

function intentIsNot(...rejected: string[]) {
  return (result: ExtractedMessage | null) =>
    result && rejected.includes(result.intent) ? `أعاد ${result.intent} وهو غير مقبول هنا` : null;
}

const cases: Case[] = [
  {
    name: "بحث بلهجة دون كلمة ملكية",
    body: "لاي منزل للايجار",
    check: intentIs("search_property")
  },
  {
    name: "بحث بصيغة أخرى",
    body: "لاقي منزل للايجار",
    check: intentIs("search_property")
  },
  {
    name: "تصريح ملكية صريح",
    body: "لدي منزل للايجار",
    check: intentIs("add_property")
  },
  {
    name: "بحث عام: searchText يجب ألا يحمل نوع العقار",
    body: "ابحث عن منزل للايجار",
    check: (result) => {
      if (result?.intent !== "search_property") {
        return `توقعت search_property وجاء ${result?.intent ?? "null"}`;
      }

      const text = result.searchText?.trim();
      return text && /منزل|شقة|للايجار|للإيجار|كراء/.test(text)
        ? `وضع "${text}" في searchText وهو ليس اسم مكان`
        : null;
    }
  },
  {
    name: "جواب المعلم أثناء تعبئة إعلان",
    body: "كراج لكصر",
    state: draftAwaitingLandmark,
    check: intentIsNot("search_property", "refine_search")
  },
  {
    name: "معلم يحوي كلمة عدد",
    body: "بانتيك عشرة",
    state: draftAwaitingLandmark,
    check: (result) =>
      result?.selectedIndex !== undefined
        ? `استخرج selectedIndex=${result.selectedIndex} من جملة معلم`
        : intentIsNot("search_property", "refine_search")(result)
  },
  {
    name: "اسم منطقة كجواب على سؤال المقاطعة",
    body: "عرفات",
    state: draftAwaitingArea,
    check: intentIsNot("search_property")
  },
  {
    name: "طلب المزيد",
    body: "منزل اخر",
    check: intentIsNot("add_property")
  },
  {
    name: "بحث أول يحمل ميزانية",
    body: "أريد شقة في تفرغ زينة بحد أقصى 2450",
    check: (result) => {
      if (result?.intent !== "search_property") {
        return `توقعت search_property وجاء ${result?.intent ?? "null"}`;
      }

      return result.maxPrice === 2450 ? null : `لم يستخرج الحد الأقصى، جاء ${result.maxPrice}`;
    }
  },
  {
    name: "معلم بعد كلمة قرب",
    body: "قرب المستشفى الإسباني",
    state: draftAwaitingLandmark,
    check: intentIsNot("refine_search", "search_property")
  }
];

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("لا يوجد OPENAI_API_KEY. ضعه في .env.local أو مرّره في الأمر، وإلا فلا شيء يُختبر.");
    process.exit(2);
  }

  let passed = 0;
  const failures: string[] = [];

  for (const testCase of cases) {
    const hint = testCase.state ? buildContextHint(testCase.state) : undefined;
    const result = await aiExtractMessage(testCase.body, areas, hint);
    // null means the call failed or the model answered with an unknown intent. Never treat that as a
    // pass, or a broken key would look like a clean run.
    const problem = result === null ? "لم يرجع النموذج أي نتيجة (فشل الاتصال أو نية غير معروفة)" : testCase.check(result);

    if (problem) {
      failures.push(`${testCase.name} — "${testCase.body}"\n      ${problem}`);
      console.log(`FAIL  ${testCase.name}`);
      console.log(`      "${testCase.body}" -> ${JSON.stringify(result)}`);
      console.log(`      ${problem}`);
      continue;
    }

    passed += 1;
    console.log(`PASS  ${testCase.name}  ("${testCase.body}" -> ${result?.intent})`);
  }

  console.log(`\nRESULT: ${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    console.log("\n" + failures.map((line) => `  - ${line}`).join("\n"));
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

void main();
