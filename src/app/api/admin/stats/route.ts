import { NextResponse } from "next/server";
import { loadDashboardStats } from "@/lib/dashboard-stats";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Lets the dashboard refresh its numbers in place instead of making an admin reload the page.
export async function GET() {
  const stats = await loadDashboardStats();

  return NextResponse.json(stats, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" }
  });
}
