import { NextRequest, NextResponse } from "next/server";
import { analyzeMyReplies } from "@/lib/twitter";

export const maxDuration = 60;
export const runtime = "nodejs";

// ─── Per-IP Rate Limiting ─────────────────────────────────────────────────────
const ipRequestLog = new Map<string, number[]>();
const MAX_REQUESTS_PER_IP = 15;
const WINDOW_MS = 60 * 1000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (ipRequestLog.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (timestamps.length >= MAX_REQUESTS_PER_IP) return true;
  ipRequestLog.set(ip, [...timestamps, now]);
  return false;
}

// ─── Waitlist Queue ───────────────────────────────────────────────────────────
let activeScrapes = 0;
let waitlistCount = 0;
const MAX_CONCURRENT_SCRAPES = 4;

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests! Please wait a moment. 🐢" },
      { status: 429 }
    );
  }

  let username: string;
  try {
    const body = await request.json();
    username = body?.username;
    if (!username || typeof username !== "string") throw new Error("bad");
  } catch {
    return NextResponse.json({ error: "Username is required." }, { status: 400 });
  }

  // HTTP 202 Waitlist Protocol
  const isRetry = request.headers.get("x-is-retry") === "true";

  if (activeScrapes >= MAX_CONCURRENT_SCRAPES) {
    if (!isRetry) waitlistCount++;
    const displayPos = Math.min(waitlistCount, 12);
    const estimatedWait = displayPos * 8; // ~8 seconds per position
    return NextResponse.json(
      { queued: true, position: displayPos, estimatedWait },
      { status: 202 }
    );
  }

  if (!isRetry && waitlistCount > 0) waitlistCount--;
  activeScrapes++;

  try {
    const result = await analyzeMyReplies(username.trim());
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Analysis failed.";

    if (message === "TWITTER_COOKIES_NOT_SET" || message === "ALL_COOKIES_BURNED") {
      return NextResponse.json(
        { error: "Server isn't configured yet — cookies not set. 🔑" },
        { status: 503 }
      );
    }
    if (message === "RATE_LIMITED") {
      return NextResponse.json(
        {
          error:
            "X is rate-limiting our requests right now 🚦 Try again in a minute.",
        },
        { status: 429 }
      );
    }
    if (message === "AUTH_FAILED") {
      return NextResponse.json(
        { error: "Authentication failed — cookies may have expired. 🔑" },
        { status: 401 }
      );
    }
    if (message.includes("not found") || message.includes("suspended")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("private") || message.includes("inactive")) {
      return NextResponse.json({ error: message }, { status: 422 });
    }

    console.error("[analyze] Error:", message);
    return NextResponse.json(
      { error: `Analysis failed: ${message}` },
      { status: 500 }
    );
  } finally {
    activeScrapes--;
  }
}
