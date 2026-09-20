/**
 * Checks what a file is taken to be, and what WhatsApp is told it is. Runs offline:
 * `npm run check:mediakinds`.
 *
 * A campaign answers with whatever explains it best -- a video of the work, a voice note in the
 * dialect people speak, a picture of the price list. Each of those is a different kind of WhatsApp
 * message, and sending one as another is how a file is accepted and then silently never delivered:
 * a recording sent as a document arrives as something to download rather than something to press
 * play on, and a type outside Meta's list is refused outright.
 */
import { extensionForMedia, mediaKindFor, mediaSizeLimits, metaMediaType } from "../src/lib/media-kinds";
import { readAttachments } from "../src/lib/campaigns";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

// What the browser says, when it says anything.
check("a video is a video", mediaKindFor("video/mp4", "clip.mp4"), "video");
check("a picture is a picture", mediaKindFor("image/jpeg", "price.jpg"), "image");
check("a recording is audio", mediaKindFor("audio/mpeg", "voice.mp3"), "audio");
check("a pdf is a document", mediaKindFor("application/pdf", "terms.pdf"), "document");

// A phone recording and a file picked on Windows both arrive with no type at all.
check("an untyped voice note is read from its name", mediaKindFor("", "PTT-20260920.opus"), "audio");
check("an untyped video too", mediaKindFor("", "VID_2026.mp4"), "video");
check("and an octet-stream picture", mediaKindFor("application/octet-stream", "IMG_0421.JPG"), "image");
check("anything unrecognised is a document", mediaKindFor("", "notes.rtf"), "document");

// The label handed to Meta, which refuses anything outside its list.
check("quicktime is sent as mp4", metaMediaType("video", "video/quicktime", "clip.mov"), "video/mp4");
check("3gpp is left alone", metaMediaType("video", "video/3gpp", "clip.3gp"), "video/3gpp");
check("webp is sent as jpeg", metaMediaType("image", "image/webp", "a.webp"), "image/jpeg");
check("png stays png", metaMediaType("image", "image/png", "a.png"), "image/png");

// Audio containers are genuinely different, so an accepted one is passed through untouched.
check("ogg stays ogg", metaMediaType("audio", "audio/ogg", "v.ogg"), "audio/ogg");
check("m4a stays mp4 audio", metaMediaType("audio", "audio/mp4", "v.m4a"), "audio/mp4");
check("an untyped .opus is called ogg", metaMediaType("audio", "", "v.opus"), "audio/ogg");
check("a charset suffix does not break the match", metaMediaType("audio", "audio/ogg; codecs=opus", "v.ogg"), "audio/ogg");

// What comes back out of the bucket has to be what went in.
check("a voice note keeps its extension", extensionForMedia("audio", "audio/mp4", "note.m4a"), "m4a");
check("a nameless recording still gets one", extensionForMedia("audio", "audio/ogg", ""), "ogg");
check("and a nameless video", extensionForMedia("video", "video/mp4", ""), "mp4");

// The ceilings WhatsApp enforces, kept where the form can refuse before the upload.
check("a picture is capped at 5MB", mediaSizeLimits.image, 5 * 1024 * 1024);
check("a video at 16MB", mediaSizeLimits.video, 16 * 1024 * 1024);

// A campaign saved before attachments existed carries its video in the old column, and must go on
// working exactly as it did.
check("an old campaign keeps its video", readAttachments([], "campaigns/1.mp4").length, 1);
check("read as a video", readAttachments([], "campaigns/1.mp4")[0].kind, "video");
check("a campaign with neither has nothing", readAttachments([], null).length, 0);

const stored = [
  { type: "audio", path: "campaigns/voice.m4a", name: "voice.m4a" },
  { type: "image", path: "campaigns/price.jpg", name: "" }
];

check("stored attachments are read in order", readAttachments(stored, null)[0].kind, "audio");
check("with the file name kept", readAttachments(stored, null)[0].name, "voice.m4a");
check("and the old column ignored once there are any", readAttachments(stored, "campaigns/1.mp4").length, 2);

// Rubbish in the column must not reach the sender as an attachment with no file behind it.
check("an entry with no path is dropped", readAttachments([{ type: "image" }], null).length, 0);
check("a broken type falls back to the path", readAttachments([{ path: "a/b.mp3" }], null)[0].kind, "audio");
check("and a non-list is survivable", readAttachments("nonsense", null).length, 0);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
