/**
 * Checks what is read out of a video file's bytes. Runs offline: `npm run check:mp4`.
 *
 * The last thing left after every other check passed. WhatsApp relays H.264 with AAC and nothing
 * else, but it accepts the upload of anything, acknowledges the send, and then declines to deliver
 * -- which from the server is indistinguishable from a video that arrived. A file that a phone
 * recorded always passes; one exported from an editor may not.
 */
import { inspectMp4 } from "../src/lib/mp4-inspect";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

/** A minimal MP4: a box header, an ftyp brand, then whatever four-character codes are asked for. */
function mp4({ brand = "isom", moov = true, codes = [] as string[] }) {
  const parts = [Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`, "latin1"), Buffer.from("\0".repeat(8), "latin1")];

  if (moov) {
    parts.push(Buffer.from("moov", "latin1"));
  }

  for (const code of codes) {
    parts.push(Buffer.from(`\0\0\0\0${code}`, "latin1"));
  }

  return new Uint8Array(Buffer.concat(parts));
}

// What a phone records, and what WhatsApp relays without complaint.
const phone = inspectMp4(mp4({ codes: ["avc1", "mp4a"] }));

check("a phone recording is an mp4", phone.isMp4, true);
check("its track data is present", phone.hasMoov, true);
check("the video codec is read", phone.videoCodec, "H.264");
check("the audio codec too", phone.audioCodec, "AAC");
check("and nothing is wrong with it", phone.problems.length, 0);

// The suspect: an editor export. Everything else about the file looks perfect.
const hevc = inspectMp4(mp4({ codes: ["hvc1", "mp4a"] }));

check("an HEVC export is still a valid mp4", hevc.isMp4, true);
check("and its codec is named", hevc.videoCodec, "H.265 / HEVC");
check("but it is reported as a problem", hevc.problems.length, 1);
check("naming H.264 as the fix", hevc.problems[0].includes("H.264"), true);

check("an AV1 export is refused too", inspectMp4(mp4({ codes: ["av01", "mp4a"] })).problems.length, 1);
check("and VP9", inspectMp4(mp4({ codes: ["vp09", "mp4a"] })).problems.length, 1);

// Audio WhatsApp will not take, with video it will.
const opus = inspectMp4(mp4({ codes: ["avc1", "Opus"] }));

check("unsupported audio is caught", opus.problems.length, 1);
check("and named", opus.problems[0].includes("Opus"), true);

// A copy that stopped partway usually loses the metadata box, which sits at the end.
const truncated = inspectMp4(mp4({ moov: false, codes: [] }));

check("a truncated file is caught", truncated.hasMoov, false);
check("and called truncated rather than blamed on a codec", truncated.problems[0].includes("بُتِر"), true);
check("with no codec invented for it", truncated.videoCodec, undefined);

// Something that is not a video at all -- an error page saved as .mp4, say.
const notVideo = inspectMp4(new Uint8Array(Buffer.from("<!doctype html><html>not a video</html>", "latin1")));

check("a non-mp4 is refused", notVideo.isMp4, false);
check("and says so plainly", notVideo.problems[0].includes("ليس MP4"), true);

check("an empty file does not throw", inspectMp4(new Uint8Array()).isMp4, false);

/**
 * The verdict this was built to predict, in Meta's own words, from a real delivery-status callback:
 *
 *   (#131053) Media upload error — Video file uploaded with mimetype as video/mp4, however on
 *   processing it is of type video/mp4, videoCodec=hevc, audioCodec=aac. Please choose a different file.
 *
 * Everything else about that file was sound: 0.6MB, video/mp4, reachable, uploaded, acknowledged
 * with a media id. Only the codec differed, and only after delivery had already silently failed.
 */
const asMetaSawIt = inspectMp4(mp4({ codes: ["hvc1", "mp4a"] }));

check("the codec Meta rejected is the one flagged", asMetaSawIt.videoCodec, "H.265 / HEVC");
check("the audio Meta accepted is not flagged", asMetaSawIt.audioCodec, "AAC");
check("and exactly one problem is raised", asMetaSawIt.problems.length, 1);
check("about the video, not the audio", asMetaSawIt.problems[0].includes("الفيديو"), true);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
