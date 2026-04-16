import { NextResponse } from "next/server";
import { getGlobalStats } from "@/lib/twitter";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await getGlobalStats();
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[Stats API] Error:", err);
    return NextResponse.json({ totalAudits: 0, trending: [] });
  }
}
