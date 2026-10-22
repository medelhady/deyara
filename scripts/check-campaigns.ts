/**
 * Checks which messages trigger a partner campaign. Runs offline: `npm run check:campaigns`.
 *
 * A campaign is a word from an advert and the answer it deserves, and it has to survive the two ways
 * it can go wrong: never firing, because the person wrote the word with a hamza or a typo; and
 * firing at everyone, because the word appears inside ordinary sentences about houses.
 */
import {
  campaignKeywordHint,
  matchCampaign,
  minimumKeywordLength,
  normalizeCampaignText,
  parseKeywords
} from "../src/lib/campaigns";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

// The keywords box, as an admin types it: commas, Arabic commas, or one per line.
check("commas separate keywords", parseKeywords("تاجر، تجار، شراكة").length, 3);
check("a latin comma works too", parseKeywords("تاجر, شراكة").length, 2);
check("as do line breaks", parseKeywords("تاجر\nشراكة").length, 2);
check("blanks are dropped", parseKeywords("تاجر،،، ").length, 1);
check("and the same word twice is one keyword", parseKeywords("تاجر، تاجر").length, 1);

// Short words catch everything, so they are refused before they can answer a renter with an advert.
check("a two-letter trigger is refused", parseKeywords("لو").length, 0);
check("the minimum is three", minimumKeywordLength, 3);

// The way people actually type: hamzas, diacritics and ة are not obstacles to being answered.
check("a hamza is not an obstacle", normalizeCampaignText("أهلا"), normalizeCampaignText("اهلا"));
check("nor is a taa marbuta", normalizeCampaignText("شراكة"), normalizeCampaignText("شراكه"));

const merchants = { id: "1", keywords: parseKeywords("تاجر، تجار"), active: true };
const partners = { id: "2", keywords: parseKeywords("شراكة، مسوق"), active: true };
const specific = { id: "3", keywords: parseKeywords("شراكة تجارية"), active: true };
const campaigns = [merchants, partners, specific];

const idOf = (body: string) => matchCampaign(body, campaigns)?.id ?? null;

// The word straight from the advert, alone or inside a sentence.
check("the bare word triggers its campaign", idOf("تاجر"), "1");
check("and so does a sentence containing it", idOf("انا تاجر وحاب اشتغل معكم"), "1");
check("a different campaign is not confused with it", idOf("مسوق"), "2");
check("spelling it with a taa marbuta still works", idOf("شراكه"), "2");
check("one typo is forgiven", idOf("شراكه معكم"), "2");

// The failure that matters more: an advert for merchants answering someone looking for a house.
check("an unrelated message triggers nothing", idOf("ندور دار في لكصر"), null);
check("an empty message triggers nothing", idOf("   "), null);
check("a keyword buried inside another word does not fire", idOf("متاجرة"), null);

// The longest matching keyword wins, so a specific advert is not swallowed by a general one.
check("the more specific campaign wins", idOf("عندي شراكة تجارية"), "3");

// A paused campaign is off, which is the whole point of pausing rather than deleting.
check(
  "a paused campaign never answers",
  matchCampaign("تاجر", [{ ...merchants, active: false }])?.id ?? null,
  null
);

// The word the bot asks people to write, when it is running one offer and nothing else.
const live = [
  { keywords: ["ويفي", "انترنت"], active: true },
  { keywords: ["شراكة"], active: true },
  { keywords: ["تاجر"], active: false }
];

check("the hint names the first keyword of a campaign", campaignKeywordHint([live[0]]), "ويفي");
check("a paused campaign is not offered", campaignKeywordHint([live[2]]), "");
check("two live campaigns are joined", campaignKeywordHint(live), "ويفي أو شراكة");
check(
  "at most three words, so the line stays readable",
  campaignKeywordHint([
    { keywords: ["أ"], active: true },
    { keywords: ["ب"], active: true },
    { keywords: ["ج"], active: true },
    { keywords: ["د"], active: true }
  ]).split(" أو ").length,
  3
);
check("no campaigns at all leaves it empty", campaignKeywordHint([]), "");

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
