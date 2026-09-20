/**
 * What a file is, and what WhatsApp will take it as.
 *
 * A campaign answers with whatever explains it best -- a video of the work, a voice note in the
 * dialect people actually speak, a picture of the price list, a PDF. Each of those is a different
 * kind of WhatsApp message, and sending one as another is how a file is accepted and then silently
 * never delivered.
 *
 * Pure and dependency-free: the page needs the same names and limits as the sender.
 */

export type MediaKind = "image" | "video" | "audio" | "document";

/** What each kind is called where an admin reads it, and the icon that stands for it in a list. */
export const mediaKindLabels: Record<MediaKind, { label: string; icon: string }> = {
  video: { label: "فيديو", icon: "🎥" },
  image: { label: "صورة", icon: "🖼️" },
  audio: { label: "تسجيل صوتي", icon: "🎙️" },
  document: { label: "ملف", icon: "📄" }
};

/**
 * WhatsApp's size ceilings, per kind.
 *
 * Refused before the upload rather than after it: the admin is on a phone connection, and finding
 * out at the end of a forty-megabyte upload is finding out too late.
 */
export const mediaSizeLimits: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024
};

const extensionKinds: Array<{ pattern: RegExp; kind: MediaKind }> = [
  { pattern: /\.(mp4|3gp|mov|m4v)$/, kind: "video" },
  { pattern: /\.(jpg|jpeg|png|webp)$/, kind: "image" },
  { pattern: /\.(ogg|opus|mp3|m4a|aac|amr|wav)$/, kind: "audio" },
  { pattern: /\.(pdf|docx?|xlsx?|pptx?|txt)$/, kind: "document" }
];

/**
 * Which kind a file is.
 *
 * The browser's own type is trusted first, and the extension is the fallback -- a file picked on
 * Windows or recorded on a phone can arrive with an empty type or as application/octet-stream, and
 * refusing those means telling someone their voice note is not a voice note.
 *
 * Anything unrecognised is a document, which is the kind WhatsApp accepts without asking what is
 * inside it.
 */
export function mediaKindFor(contentType: string, fileName = ""): MediaKind {
  const type = String(contentType ?? "").toLowerCase();
  const name = String(fileName ?? "").toLowerCase();

  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";

  for (const { pattern, kind } of extensionKinds) {
    if (pattern.test(name)) {
      return kind;
    }
  }

  return "document";
}

/**
 * The type WhatsApp is told the file is.
 *
 * It refuses a type outside its list outright -- video/quicktime being the one that cost us a whole
 * campaign -- so a file whose real bytes are fine is relabelled to the accepted name for its kind.
 * An audio type it already accepts is passed through untouched, because ogg and m4a and mpeg are
 * genuinely different containers and calling one another breaks playback rather than fixing it.
 */
export function metaMediaType(kind: MediaKind, storedType: string, fileName = ""): string {
  const type = String(storedType ?? "").toLowerCase().split(";")[0].trim();
  const name = String(fileName ?? "").toLowerCase();

  if (kind === "video") {
    return type === "video/3gpp" ? type : "video/mp4";
  }

  if (kind === "image") {
    return type === "image/png" ? type : "image/jpeg";
  }

  if (kind === "audio") {
    const accepted = ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"];

    if (accepted.includes(type)) {
      return type;
    }

    // A recording arriving with no type at all: named by its extension, which is all there is.
    if (/\.(ogg|opus)$/.test(name)) return "audio/ogg";
    if (/\.(m4a|mp4)$/.test(name)) return "audio/mp4";
    if (/\.aac$/.test(name)) return "audio/aac";
    if (/\.amr$/.test(name)) return "audio/amr";

    return "audio/mpeg";
  }

  return type || "application/pdf";
}

/** The file extension to store a file under, so what comes back out is what went in. */
export function extensionForMedia(kind: MediaKind, contentType: string, fileName = "") {
  const fromName = String(fileName ?? "").toLowerCase().match(/\.([a-z0-9]{2,5})$/);

  if (fromName) {
    return fromName[1];
  }

  const type = String(contentType ?? "").toLowerCase();

  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("3gpp")) return "3gp";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("aac")) return "aac";
  if (type.includes("pdf")) return "pdf";

  return kind === "video" ? "mp4" : kind === "audio" ? "m4a" : kind === "image" ? "jpg" : "bin";
}
