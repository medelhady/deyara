/**
 * Checks that a video link is one WhatsApp can actually deliver.
 *
 * Meta fetches a `link` itself and does it after answering us, so a dead URL is accepted with a 200
 * and then quietly dropped: the renter who asked to see the house gets nothing, and no error ever
 * reaches a log. That is how a listing whose stored URL had expired looked exactly like a listing
 * whose video sent fine.
 *
 * Checking first turns that silence into a reason we can act on, and lets the caller send something
 * rather than nothing.
 */

/** WhatsApp refuses video past this, and refuses it the same silent way. */
export const maxVideoBytes = 16 * 1024 * 1024;

export type VideoCheck =
  | { ok: true; bytes?: number; contentType?: string }
  | { ok: false; reason: string; status?: number };

/**
 * A HEAD request, falling back to a one-byte ranged GET.
 *
 * Some storage backends answer HEAD with 405, some with 400 or 403, while serving GET perfectly
 * well. Any of those read as a broken file would reject a video that works -- and rejecting it here
 * is not a loud failure: the caller sends a bare link instead, which WhatsApp then drops for reasons
 * of its own. So a refused HEAD is never the verdict; the GET is.
 */
export async function checkVideoUrl(url: string, timeoutMs = 8000): Promise<VideoCheck> {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: "الرابط ليس عنوانًا كاملًا — غالبًا مسار تخزين لم يُوقَّع." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response = await fetch(url, { method: "HEAD", signal: controller.signal });

    if (!response.ok) {
      response = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: controller.signal });
    }

    if (!response.ok && response.status !== 206) {
      // 403 is what an expired signature looks like; 404 is a path that no longer exists.
      const reason =
        response.status === 403
          ? "الرابط منتهي الصلاحية أو ممنوع الوصول (403)."
          : response.status === 404
            ? "الملف غير موجود في التخزين (404)."
            : `الرابط لا يستجيب (${response.status}).`;

      return { ok: false, reason, status: response.status };
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    const length = response.headers.get("content-range")?.split("/")[1] ?? response.headers.get("content-length");
    const bytes = length && /^\d+$/.test(length) ? Number(length) : undefined;

    if (contentType && !contentType.startsWith("video/")) {
      return { ok: false, reason: `الملف ليس فيديو (${contentType}).` };
    }

    if (bytes !== undefined && bytes > maxVideoBytes) {
      const megabytes = Math.round((bytes / (1024 * 1024)) * 10) / 10;

      return { ok: false, reason: `حجم الفيديو ${megabytes} ميجابايت، وواتساب لا يقبل أكثر من 16.` };
    }

    return { ok: true, bytes, contentType };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);

    return { ok: false, reason: raw.includes("abort") ? "انتهت مهلة الوصول للرابط." : `تعذر الوصول للرابط: ${raw}` };
  } finally {
    clearTimeout(timer);
  }
}
