/**
 * Reads what an MP4 actually contains, from its own bytes.
 *
 * Written because every other check passed and the video still never arrived. WhatsApp relays H.264
 * video with AAC audio and nothing else; it takes the upload regardless, accepts the send, and then
 * declines to deliver. From the outside that is indistinguishable from success, so the only place
 * left to look is inside the file.
 *
 * A deliberately small parser: it walks the top-level boxes for structure and scans for the codec
 * four-character codes rather than descending the full tree. Enough to answer "will WhatsApp take
 * this", which is the only question being asked.
 */

export type Mp4Report = {
  /** False when the bytes are not an MP4 at all. */
  isMp4: boolean;
  /** The moov box holds the track metadata. A truncated upload usually loses it. */
  hasMoov: boolean;
  brand?: string;
  videoCodec?: string;
  audioCodec?: string;
  /** Empty when nothing is wrong with the file as far as WhatsApp is concerned. */
  problems: string[];
};

const videoCodecs: Array<{ fourcc: string; name: string; accepted: boolean }> = [
  { fourcc: "avc1", name: "H.264", accepted: true },
  { fourcc: "avc3", name: "H.264", accepted: true },
  { fourcc: "hvc1", name: "H.265 / HEVC", accepted: false },
  { fourcc: "hev1", name: "H.265 / HEVC", accepted: false },
  { fourcc: "av01", name: "AV1", accepted: false },
  { fourcc: "vp09", name: "VP9", accepted: false },
  { fourcc: "mp4v", name: "MPEG-4 Part 2", accepted: false }
];

const audioCodecs: Array<{ fourcc: string; name: string; accepted: boolean }> = [
  { fourcc: "mp4a", name: "AAC", accepted: true },
  { fourcc: "Opus", name: "Opus", accepted: false },
  { fourcc: "ac-3", name: "AC-3", accepted: false }
];

export function inspectMp4(bytes: Uint8Array): Mp4Report {
  // latin1 maps each byte to one character, so a four-character code in the bytes is a four-character
  // substring here. Any other encoding would fold bytes together and lose them.
  const text = Buffer.from(bytes).toString("latin1");
  const problems: string[] = [];

  const ftypAt = text.indexOf("ftyp");
  const isMp4 = ftypAt > 0 && ftypAt < 64;

  if (!isMp4) {
    return { isMp4: false, hasMoov: false, problems: ["الملف ليس MP4 — لا يحمل ترويسة ftyp."] };
  }

  const brand = text.slice(ftypAt + 4, ftypAt + 8).trim();
  const hasMoov = text.includes("moov");

  if (!hasMoov) {
    problems.push("الملف ناقص: لا يحتوي على بيانات المسارات (moov)، أي أنه بُتِر أثناء النسخ.");
  }

  const video = videoCodecs.find((codec) => text.includes(codec.fourcc));
  const audio = audioCodecs.find((codec) => text.includes(codec.fourcc));

  if (!video) {
    if (hasMoov) {
      problems.push("لم أتعرّف على ترميز الفيديو داخل الملف.");
    }
  } else if (!video.accepted) {
    problems.push(`ترميز الفيديو ${video.name}، وواتساب لا يقبل غير H.264. أعد تصدير الفيديو بترميز H.264.`);
  }

  if (audio && !audio.accepted) {
    problems.push(`ترميز الصوت ${audio.name}، وواتساب يقبل AAC فقط.`);
  }

  return {
    isMp4: true,
    hasMoov,
    brand: brand || undefined,
    videoCodec: video?.name,
    audioCodec: audio?.name,
    problems
  };
}
