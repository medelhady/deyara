/**
 * Where a screenshot came from.
 *
 * Kept apart from the office reader so the page can import it without pulling the database client
 * and the OpenAI call into the browser bundle.
 */
export const officePlatforms = ["فيسبوك", "تيك توك", "واتساب", "إنستغرام", "مجموعة واتساب", "أخرى"];
