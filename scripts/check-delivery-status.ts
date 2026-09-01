/**
 * Checks that a delivery failure is read off the webhook. Runs offline: `npm run check:deliverystatus`.
 *
 * A house video was uploaded to Meta, given a media id, and the send was acknowledged with a 200 --
 * and it never arrived. Meta decides whether it can deliver *after* it has answered us, and reports
 * that decision only in a status callback. Without reading those, a message that is refused after
 * acceptance is indistinguishable from one that was delivered and read.
 */
import { parseMetaStatuses } from "../src/lib/whatsapp/meta";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

type Status = {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
};

function payload(statuses: Status[]) {
  return { entry: [{ changes: [{ value: { statuses } }] }] };
}

// The shape Meta sends when it gives up on a message it already accepted.
const failed = parseMetaStatuses(
  payload([
    {
      id: "wamid.HBgLMjIyNDg0MDQwMzc",
      status: "failed",
      recipient_id: "22248404037",
      errors: [
        {
          code: 131053,
          title: "Media upload error",
          message: "Unable to download the media",
          error_data: { details: "Media file could not be processed" }
        }
      ]
    }
  ])
);

check("one status is read", failed.length, 1);
check("its outcome is failure", failed[0].status, "failed");
check("the recipient is normalised like every other phone", failed[0].recipient, "whatsapp:+22248404037");
check("the error code survives", failed[0].error?.includes("(#131053)"), true);
check("and the title", failed[0].error?.includes("Media upload error"), true);
check("and the detail, which is the part that names the cause", failed[0].error?.includes("could not be processed"), true);

// A delivered message reports no error, and must not be mistaken for one.
const delivered = parseMetaStatuses(payload([{ id: "wamid.X", status: "delivered", recipient_id: "22248404037" }]));

check("a delivered status carries no error", delivered[0].error, undefined);
check("and is not marked failed", delivered[0].status, "delivered");

// An ordinary incoming message has no statuses at all.
check("a plain message payload yields nothing", parseMetaStatuses({ entry: [{ changes: [{ value: {} }] }] }).length, 0);
check("an empty payload does not throw", parseMetaStatuses({}).length, 0);

// Several statuses can arrive in one delivery, and each has to be seen.
const many = parseMetaStatuses(
  payload([
    { id: "a", status: "sent", recipient_id: "22200000001" },
    { id: "b", status: "failed", recipient_id: "22200000002", errors: [{ code: 131047, title: "Re-engagement message" }] }
  ])
);

check("every status in a batch is read", many.length, 2);
check("and the failure among them is found", many.filter((item) => item.status === "failed").length, 1);
check("with its own reason", many[1].error?.includes("131047"), true);

// A failure with no error array must still be reportable rather than dropped.
const bare = parseMetaStatuses(payload([{ id: "c", status: "failed", recipient_id: "22200000003" }]));

check("a reasonless failure is still a failure", bare[0].status, "failed");
check("and leaves the caller to say so", bare[0].error, undefined);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
