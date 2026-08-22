/**
 * Checks which provider getWhatsAppProvider picks. Runs offline: `npm run check:provider`.
 *
 * This is the case that broke production: the deployment runs on Meta, WHATSAPP_PROVIDER was not
 * set, resolution fell back to Twilio, and Twilio without credentials dropped every proactive
 * message without throwing. Renters stopped receiving the owner number after topping up.
 */
import { getWhatsAppProvider } from "../src/lib/whatsapp/provider";
import { metaWhatsAppProvider } from "../src/lib/whatsapp/meta";
import { twilioWhatsAppProvider } from "../src/lib/whatsapp/twilio";

type Env = { provider?: string; metaToken?: string; metaPhoneId?: string };

function resolve({ provider, metaToken, metaPhoneId }: Env) {
  if (provider === undefined) delete process.env.WHATSAPP_PROVIDER;
  else process.env.WHATSAPP_PROVIDER = provider;

  if (metaToken === undefined) delete process.env.META_WHATSAPP_TOKEN;
  else process.env.META_WHATSAPP_TOKEN = metaToken;

  if (metaPhoneId === undefined) delete process.env.META_PHONE_NUMBER_ID;
  else process.env.META_PHONE_NUMBER_ID = metaPhoneId;

  const picked = getWhatsAppProvider();

  if (picked === metaWhatsAppProvider) return "meta";
  if (picked === twilioWhatsAppProvider) return "twilio";
  return "unknown";
}

const metaCreds = { metaToken: "token", metaPhoneId: "12345" };

const cases: Array<[string, Env, string]> = [
  ["explicit meta", { provider: "meta", ...metaCreds }, "meta"],
  ["explicit twilio wins over Meta credentials", { provider: "twilio", ...metaCreds }, "twilio"],
  ["case and spacing tolerated", { provider: "  META  ", ...metaCreds }, "meta"],
  ["unset falls back to Meta when its credentials exist", { ...metaCreds }, "meta"],
  ["empty string falls back to Meta when its credentials exist", { provider: "", ...metaCreds }, "meta"],
  ["typo falls back to Meta rather than dropping messages", { provider: "metaa", ...metaCreds }, "meta"],
  ["unset with no Meta credentials stays on Twilio", {}, "twilio"],
  ["half-configured Meta stays on Twilio", { metaToken: "token" }, "twilio"]
];

let failures = 0;

for (const [name, env, expected] of cases) {
  const actual = resolve(env);
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
