/**
 * What the storage server said, in words that name the fix.
 *
 * The browser uploads straight to Supabase storage, so its refusals arrive as raw JSON in the middle
 * of an Arabic page -- and the one that actually happens is the bucket's own MIME list: it was
 * created for property videos, and a voice note is refused with a 415 that says nothing about where
 * the rule lives or how to change it.
 *
 * Pure, so the page and the checks read the same sentences.
 */

/** The types the bucket has to allow for a campaign to carry every kind of file. */
export const allowedUploadTypes = [
  "video/mp4",
  "video/3gpp",
  "video/quicktime",
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/amr",
  "application/pdf"
];

/** The one line to run in Supabase when the bucket refuses a type it should carry. */
export const allowMimeTypesSql = `update storage.buckets set allowed_mime_types = array[${allowedUploadTypes
  .map((type) => `'${type}'`)
  .join(", ")}], file_size_limit = 104857600 where id = 'property-media';`;

/**
 * Turns a storage refusal into a sentence with an instruction in it.
 *
 * Anything unrecognised keeps the server's own words: a rejected key, a blocked request and a
 * dropped connection all look the same without them, and a guess dressed up as an explanation is
 * worse than the raw text.
 */
export function explainStorageUpload(status: number, body: string) {
  const text = String(body ?? "");

  if (status === 415 || text.includes("invalid_mime_type") || text.includes("InvalidMimeType")) {
    const type = text.match(/mime type ([\w./+-]+)/i)?.[1];

    return `المخزن يرفض نوع الملف${type ? ` (${type})` : ""} لأن قائمة الأنواع المسموحة في bucket واسمه property-media لا تشمله. شغّل في محرر SQL بـ Supabase: ${allowMimeTypesSql}`;
  }

  if (status === 413 || text.includes("Payload too large") || text.includes("exceeded the maximum")) {
    return "الملف أكبر من الحد المسموح في المخزن. صغّر الملف، أو ارفع حد الحجم في إعدادات bucket المسمى property-media.";
  }

  if (status === 403 || text.includes("Unauthorized") || text.includes("signature")) {
    return "انتهت صلاحية رابط الرفع قبل أن يكتمل. أعد المحاولة، وإن تكرر فالاتصال بطيء جدًا لهذا الملف.";
  }

  return `تعذر الرفع إلى المخزن (${status}). ${text.slice(0, 200)}`;
}
