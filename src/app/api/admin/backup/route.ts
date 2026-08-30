import { buildBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Downloads the whole database as one JSON file.
 *
 * Exists because the command-line version needed the service key copied out of Vercel first, and a
 * backup with a setup step in front of it is one that never gets taken.
 */
export async function GET() {
  const backup = await buildBackup();
  const stamp = backup.takenAt.replace(/[:.]/g, "-").slice(0, 19);

  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="deyara-${stamp}.json"`,
      "Cache-Control": "no-store"
    }
  });
}
