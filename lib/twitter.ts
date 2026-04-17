/**
 * Twitter/X Self-Analysis Scraper — "Are You a Reply Guy?"
 *
 * Uses the UserTweetsAndReplies GraphQL endpoint to directly access
 * a user's Replies tab, extracting their replying behavior over the
 * last 7 days. This is dramatically more efficient than the N+1
 * TweetDetail approach (~3-5 API calls vs ~50).
 *
 * Features:
 * - UserTweetsAndReplies endpoint for direct Replies tab access
 * - 7-day rolling window analysis
 * - Reply Guy Persona assignment (Elite Glazer, Reply Demon, etc.)
 * - Intensity Score (0-100)
 * - Cookie farm rotation with auto-burn on 429
 * - Query ID auto-discovery from X's JS bundles
 * - 3-attempt silent retry loop
 */

import { queryIdCache, QUERY_ID_TTL } from "./cache";
import { unstable_cache } from "next/cache";
import Redis from "ioredis";

// ─── Redis ────────────────────────────────────────────────────────────────────
const redis =
  process.env.REDIS_URL || process.env.KV_URL
    ? new Redis(process.env.REDIS_URL || process.env.KV_URL!)
    : null;

if (!redis) {
  console.warn("[Database] No REDIS_URL or KV_URL found. Global stats will be inactive.");
}

const BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 1; // Sequential pagination — no need for parallel as we paginate one timeline

// ─── Types ────────────────────────────────────────────────────────────────────

export type PersonaType = string;

export interface TopTarget {
  handle: string;
  replyCount: number;
  percentage: number; // % of all outward replies
  latestReplyAt: number;
}

export interface IntensityAudit {
  username: string;
  displayName: string;
  avatarUrl: string;
  persona: PersonaType;
  personaEmoji: string;
  personaDescription: string;
  savageQuote: string;
  themeClass: string;
  intensityScore: number; // 0-100
  replyRatio: number; // % of all posts that are outward replies
  dailyVelocity: number; // avg replies per day
  totalRepliesAnalyzed: number;
  totalOutwardReplies: number;
  totalSelfReplies: number;
  totalOriginalTweets: number;
  totalPostsAnalyzed: number; // all posts in the window (originals + replies + self-replies)
  topTargets: TopTarget[];
  windowDays: number;
  disclaimer: string;
  cached?: boolean;
  estimatedSeconds?: number;
}

// ─── Cookie Farm ──────────────────────────────────────────────────────────────

const burnedCookies = new Map<string, number>();

export function markCookieBurned(cookie: string, reason = "Rate limited (429)") {
  burnedCookies.set(cookie, Date.now());
  console.warn(`🔥 Burned cookie [${reason}]! Rotating out for 15 minutes.`);
}

function getServerCookies(): string {
  const envKeys = Object.keys(process.env).filter((k) => k.startsWith("TWITTER_COOKIES"));

  let allRawCookies = "";
  envKeys.forEach((k) => {
    allRawCookies += (process.env[k] || "") + "\n";
  });

  const c = allRawCookies.trim();

  if (!c || c.length < 20 || c.includes("PASTE_YOUR") || c.includes("YOUR_AUTH")) {
    throw new Error("TWITTER_COOKIES_NOT_SET");
  }

  // Split by newlines
  let pools = c
    .split(/\\n|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 20);

  console.log(
    `[Cookie Farm] Auto-Discovered ${envKeys.length} variables. Total raw length: ${c.length} chars.`
  );

  // Fallback: smashed cookies
  if (pools.length === 1) {
    const candidate = pools[0];
    const tokenMatches = (candidate.match(/auth_token=/g) || []).length;
    if (tokenMatches > 1) {
      console.log(`[Cookie Farm] Smashed mode. Found ${tokenMatches} auth_tokens.`);
      pools = candidate
        .split(/(?=guest_id=)|(?=auth_token=)/g)
        .map((l) => l.trim())
        .filter((l) => l.length > 50 && l.includes("auth_token="));
    }
  }

  if (pools.length === 0) throw new Error("TWITTER_COOKIES_NOT_SET");

  // Filter out burned cookies
  const now = Date.now();
  const available = pools.filter((c) => {
    const burnedAt = burnedCookies.get(c);
    if (!burnedAt) return true;
    if (now - burnedAt > 15 * 60 * 1000) {
      burnedCookies.delete(c);
      return true;
    }
    return false;
  });

  const burnedCount = pools.length - available.length;
  console.log(
    `[Cookie Farm] 🟢 ${available.length}/${pools.length} active | 🔥 ${burnedCount} resting`
  );

  if (available.length === 0) {
    throw new Error("ALL_COOKIES_BURNED");
  }

  return available[Math.floor(Math.random() * available.length)];
}

// ─── Headers ──────────────────────────────────────────────────────────────────

function buildHeaders(cookies: string, isPost = false): Record<string, string> {
  const ct0 = cookies.match(/ct0=([^;]+)/)?.[1]?.trim() ?? "";
  const h: Record<string, string> = {
    Authorization: `Bearer ${BEARER_TOKEN}`,
    Cookie: cookies,
    "x-csrf-token": ct0,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "x-twitter-client-language": "en",
    "x-twitter-active-user": "yes",
    "x-twitter-auth-type": "OAuth2Session",
    Referer: "https://x.com/",
    Origin: "https://x.com",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
  if (isPost) h["Content-Type"] = "application/json";
  return h;
}

// ─── Query ID Management ──────────────────────────────────────────────────────

const DEFAULT_IDS = {
  UserByScreenName: "IGgvgiOx4QZndDHuD3x9TQ",
  UserTweetsAndReplies: "J1_6xm8Paoy-0DOlAEEAfg",
};

type QueryIds = typeof DEFAULT_IDS;

async function getQueryIds(): Promise<QueryIds> {
  const cached = queryIdCache.get("ids") as QueryIds | null;
  if (cached) return cached;

  let ids = { ...DEFAULT_IDS };
  try {
    const html = await fetch("https://x.com", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(5000),
    }).then((r) => r.text());

    const bundles = [
      ...new Set(
        html.match(
          /https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/[a-zA-Z0-9._-]+\.js/g
        ) ?? []
      ),
    ];

    const found: Partial<QueryIds> = {};
    for (const url of bundles.slice(0, 10)) {
      try {
        const js = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(4000),
        }).then((r) => r.text());

        for (const op of Object.keys(ids) as (keyof QueryIds)[]) {
          if (found[op]) continue;
          const m = js.match(new RegExp(`queryId:"([^"]+)",operationName:"${op}"`));
          if (m) found[op] = m[1];
        }
        if (Object.keys(found).length >= Object.keys(ids).length) break;
      } catch {
        /* skip */
      }
    }

    if (Object.keys(found).length >= 1) ids = { ...ids, ...found };
  } catch (e) {
    console.warn("[scraper] Query ID refresh skipped:", (e as Error).message);
  }

  queryIdCache.set("ids", ids, QUERY_ID_TTL);
  console.log("[scraper] Query IDs:", ids);
  return ids;
}

// ─── GQL Helpers ──────────────────────────────────────────────────────────────

const GQL_FEATURES_OBJ = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_media_download_video_enabled: false,
  premium_content_api_read_enabled: false,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_grok_share_attachment_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: false,
  rweb_video_screen_enabled: true,
  rweb_cashtags_enabled: true,
  responsive_web_profile_redirect_enabled: true,
};

const GQL_FEATURES = encodeURIComponent(JSON.stringify(GQL_FEATURES_OBJ));

const FIELD_TOGGLES = { withArticlePlainText: false };

async function gqlGet(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 8000
): Promise<Response> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 429) throw new Error("RATE_LIMITED");
  if (res.status === 401 || res.status === 403) throw new Error("AUTH_FAILED");
  return res;
}

async function gqlPost(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  timeoutMs = 12000
): Promise<Response> {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 429) throw new Error("RATE_LIMITED");
  if (res.status === 401 || res.status === 403) throw new Error("AUTH_FAILED");
  return res;
}

// ─── User Lookup ──────────────────────────────────────────────────────────────

interface UserInfo {
  id: string;
  handle: string;
  name: string;
  avatar: string;
}

async function lookupUser(
  username: string,
  headers: Record<string, string>,
  ids: QueryIds
): Promise<UserInfo> {
  const vars = encodeURIComponent(
    JSON.stringify({ screen_name: username, withSafetyModeUserFields: true })
  );
  const res = await gqlGet(
    `https://api.x.com/graphql/${ids.UserByScreenName}/UserByScreenName?variables=${vars}&features=${GQL_FEATURES}`,
    headers
  );
  if (!res.ok) throw new Error(`User lookup failed (${res.status})`);

  const data = await res.json();
  const ur = data?.data?.user?.result;
  if (!ur) throw new Error(`@${username} not found or account is private/suspended.`);

  const core = (ur.core as Record<string, string>) ?? {};
  const legacy = (ur.legacy as Record<string, string>) ?? {};
  const av = (ur.avatar as Record<string, string>) ?? {};

  return {
    id: ur.rest_id as string,
    handle: core.screen_name || legacy.screen_name || username,
    name: core.name || legacy.name || username,
    avatar: (av.image_url || legacy.profile_image_url_https || "").replace(
      "_normal",
      "_400x400"
    ),
  };
}

// ─── Parse Tweet Entry ────────────────────────────────────────────────────────

interface ParsedEntry {
  id: string;
  authorHandle: string;
  createdAt: number;
  isReply: boolean;
  isRetweet: boolean;
  inReplyToScreenName: string;
  inReplyToStatusId: string;
  fullText: string;
}

function parseTweetEntry(result: Record<string, unknown>): ParsedEntry | null {
  try {
    const actual =
      result.__typename === "TweetWithVisibilityResults"
        ? (result.tweet as Record<string, unknown>)
        : result;

    const legacy = actual.legacy as Record<string, unknown> | undefined;
    if (!legacy) return null;

    const core = actual.core as Record<string, unknown> | undefined;
    const cu = (core?.user_results as Record<string, unknown>)?.result as
      | Record<string, unknown>
      | undefined;
    const cuc = cu?.core as Record<string, unknown> | undefined;
    const authorHandle =
      (cuc?.screen_name as string) ||
      ((cu?.legacy as Record<string, unknown>)?.screen_name as string) ||
      "";

    const createdAtStr = legacy.created_at as string | undefined;
    const createdAt = createdAtStr ? new Date(createdAtStr).getTime() : 0;
    const fullText = (legacy.full_text as string) || "";

    return {
      id: actual.rest_id as string,
      authorHandle,
      createdAt,
      isReply: !!legacy.in_reply_to_status_id_str,
      isRetweet: fullText.startsWith("RT @"),
      inReplyToScreenName: (legacy.in_reply_to_screen_name as string) || "",
      inReplyToStatusId: (legacy.in_reply_to_status_id_str as string) || "",
      fullText,
    };
  } catch {
    return null;
  }
}

// ─── Fetch UserTweetsAndReplies via POST (Replies Tab) ────────────────────────
// CRITICAL: As of April 2026, X switched this endpoint from GET to POST.
// GET requests return 404. POST with queryId in the body works.

interface RawTimelineResult {
  entries: ParsedEntry[];
  reachedEnd: boolean;
  rateLimited: boolean;
}

async function fetchRepliesTab(
  userId: string,
  userHandle: string,
  headers: Record<string, string>,
  ids: QueryIds
): Promise<RawTimelineResult> {
  const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS;
  const allEntries: ParsedEntry[] = [];
  let cursor: string | undefined = undefined;
  let rateLimited = false;
  const seenIds = new Set<string>();

  // POST requires Content-Type
  const postHeaders = { ...headers, "Content-Type": "application/json" };

  // Track pages with zero new entries to detect data exhaustion
  let stalePageCount = 0;

  // Paginate up to 50 pages to cover 7 days for ultra-active users
  // (300+ replies/day users need ~50 pages × 40 entries = 2000 entries to cover 7 days)
  const MAX_PAGES = 50;
  for (let page = 0; page < MAX_PAGES; page++) {
    const variables: Record<string, unknown> = {
      userId,
      count: 40,
      includePromotedContent: true,
      withCommunity: true,
      withVoice: true,
      withV2Timeline: true,
    };
    if (cursor) variables.cursor = cursor;

    let res: Response;
    try {
      res = await gqlPost(
        `https://x.com/i/api/graphql/${ids.UserTweetsAndReplies}/UserTweetsAndReplies`,
        {
          variables,
          features: GQL_FEATURES_OBJ,
          fieldToggles: FIELD_TOGGLES,
          queryId: ids.UserTweetsAndReplies,
        },
        postHeaders,
        12000
      );
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "RATE_LIMITED") {
        rateLimited = true;
        break;
      }
      if (msg === "AUTH_FAILED") throw err;
      break; // timeout → stop pagination
    }

    if (!res.ok) {
      console.warn(`[scraper] Page ${page + 1}: HTTP ${res.status}`);
      break;
    }

    const data = await res.json();
    const instructions: Array<{ type: string; entries?: unknown[] }> =
      data?.data?.user?.result?.timeline?.timeline?.instructions ??
      data?.data?.user?.result?.timeline_v2?.timeline?.instructions ??
      [];

    type Entry = {
      entryId?: string;
      content?: {
        value?: string;
        itemContent?: {
          value?: string;
          tweet_results?: { result?: unknown };
        };
        items?: Array<{
          item?: {
            itemContent?: { tweet_results?: { result?: unknown } };
          };
        }>;
      };
    };

    const entries = instructions.flatMap((i) =>
      i.type === "TimelineAddEntries" ? ((i.entries ?? []) as Entry[]) : []
    );

    let oldestOnPage = Infinity;
    let foundEntries = false;
    let pageNewCount = 0;

    for (const e of entries) {
      // Handle single tweet entries
      if (e.entryId?.startsWith("tweet-")) {
        const r = e?.content?.itemContent?.tweet_results?.result as
          | Record<string, unknown>
          | undefined;
        if (!r) continue;
        const parsed = parseTweetEntry(r);
        if (!parsed || seenIds.has(parsed.id)) continue;
        seenIds.add(parsed.id);

        // For determining the actual timeline progress, ignore retweet timestamps,
        // since retweeting an ancient tweet shouldn't incorrectly signal the end of the 7-day window.
        if (
          !parsed.isRetweet &&
          parsed.createdAt > 0 &&
          parsed.createdAt < oldestOnPage &&
          parsed.authorHandle.toLowerCase() === userHandle.toLowerCase()
        ) {
          oldestOnPage = parsed.createdAt;
        }

        // Only include entries within the 7-day window
        if (parsed.createdAt > 0 && parsed.createdAt < sevenDaysAgo) continue;

        allEntries.push(parsed);
        foundEntries = true;
        pageNewCount++;
      }

      // Handle conversation module entries (threaded replies)
      if (e.entryId?.startsWith("profile-conversation-") || e.entryId?.startsWith("conversationthread-")) {
        const items = e.content?.items ?? [];
        for (const item of items) {
          const r = item.item?.itemContent?.tweet_results?.result as
            | Record<string, unknown>
            | undefined;
          if (!r) continue;
          const parsed = parseTweetEntry(r);
          if (!parsed || seenIds.has(parsed.id)) continue;
          seenIds.add(parsed.id);

          if (
            !parsed.isRetweet &&
            parsed.createdAt > 0 &&
            parsed.createdAt < oldestOnPage &&
            parsed.authorHandle.toLowerCase() === userHandle.toLowerCase()
          ) {
            oldestOnPage = parsed.createdAt;
          }

          if (parsed.createdAt > 0 && parsed.createdAt < sevenDaysAgo) continue;

          allEntries.push(parsed);
          foundEntries = true;
          pageNewCount++;
        }
      }
    }

    // If the oldest tweet on this page is older than 7 days, we've covered the window
    if (oldestOnPage < sevenDaysAgo) {
      console.log(`[scraper] Page ${page + 1}: Reached 7-day boundary. Stopping. (${allEntries.length} total entries)`);
      break;
    }

    // If zero new entries were found on this page, we've likely exhausted the data
    if (pageNewCount === 0 && entries.length > 0) {
      stalePageCount++;
      // After 3 pages with zero new entries, stop
      if (stalePageCount >= 3) {
        console.log(`[scraper] Page ${page + 1}: No new entries for 3 consecutive pages. Stopping. (${allEntries.length} total entries)`);
        break;
      }
    } else {
      stalePageCount = 0;
    }

    // Find next page cursor
    const bottomCursor = entries.find((e) => e.entryId?.startsWith("cursor-bottom-"));
    const nextCursor = bottomCursor?.content?.value || bottomCursor?.content?.itemContent?.value;
    if (!nextCursor) {
      console.log(`[scraper] Page ${page + 1}: No more pages. (${allEntries.length} total entries)`);
      break;
    }
    cursor = nextCursor;

    const oldestDateStr = oldestOnPage < Infinity 
      ? new Date(oldestOnPage).toISOString().slice(0, 16) 
      : "N/A";
    console.log(
      `[scraper] Page ${page + 1}: +${pageNewCount} new, ${allEntries.length} total, oldest: ${oldestDateStr}`
    );

    // Throttle between pages — 200ms keeps total time reasonable even at 50 pages
    if (page < MAX_PAGES - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return { entries: allEntries, reachedEnd: !rateLimited, rateLimited };
}

// ─── The Reply Guy Algorithm ──────────────────────────────────────────────────

interface AlgorithmResult {
  persona: PersonaType;
  personaEmoji: string;
  personaDescription: string;
  savageQuote: string;
  intensityScore: number;
  replyRatio: number;
  dailyVelocity: number;
  totalOutwardReplies: number;
  totalSelfReplies: number;
  totalOriginalTweets: number;
  totalPostsAnalyzed: number;
  topTargets: TopTarget[];
  windowDays: number;
}

type ArchetypeKey = "GHOST" | "CASUAL" | "REGULAR" | "ADDICT" | "DEMON" | "GLAZER" | "MAIN_CHARACTER";

interface ArchetypeData {
  themeClass: string;
  description: string;
  emojis: string[];
  labels: string[];
  quotes: string[];
}

const ARCHETYPES: Record<ArchetypeKey, ArchetypeData> = {
  GHOST: {
    themeClass: "persona-badge-lurker",
    description: "Barely any outward replies detected. You watch from the shadows.",
    emojis: ["👻", "🦗", "🥷", "🤫", "🕸️", "🕴️", "🌑"],
    labels: [
      "The Phantom", "Ghost in the Machine", "Lurking Legend", "Digital Monastic", "The Silent Observer",
      "Vow of Silence", "Echo in the Void", "The Unseen", "Read-Only Mode", "Data Consumer",
      "Profile Picture Only", "The Mute", "The Abstainer", "Twitter Celibate", "Timeline Voyeur",
      "The Fly on the Wall", "Schrödinger's Account", "The Ghost Town", "Zero Keystrokes", "The Stealth Bomber"
    ],
    quotes: [
      "You opened the app and chose silence.",
      "Your reply button is collecting dust.",
      "Are you sure you even USE this app?",
      "The quietest person in the room.",
      "You consume more than you create — respect the stealth.",
      "Bro is in incognito mode 24/7.",
      "Not a single digital footprint left behind.",
      "Do you even know what the reply button looks like?",
      "A literal ghost haunting the timeline.",
      "You reply so little we thought this was a bot account.",
      "Breathing requires more effort than your Twitter presence.",
      "Your keyboard is pristine, untouched by human hands.",
      "The timeline's most diligent watcher.",
      "You have a black belt in minding your own business.",
      "The digital equivalent of a tumbleweed.",
      "We had to check twice to make sure you were real.",
      "You probably read the Terms of Service for fun.",
      "A true master of the Irish Goodbye on every thread.",
      "Your drafts folder must be a graveyard of second thoughts.",
      "You let everyone else do the talking. Very demure."
    ]
  },
  CASUAL: {
    themeClass: "persona-badge-socialite",
    description: "Sparse timeline activity. You occasionally dip your toes in the water.",
    emojis: ["🍃", "☕", "🚶", "🌤️", "🧘", "🤷", "🐢"],
    labels: [
      "The Casual Scroller", "Occasional Chirp", "Fair-Weather Replier", "The Intermittent Voice", "Drive-by Replier",
      "The Restrained", "Lukewarm Take", "Weekend Warrior", "The Hesitant", "Draft Deleter",
      "The Spectator", "Picky Eater", "Casual Acquaintance", "The Window Shopper", "Tea Sipper",
      "The Browser", "The Commuter", "The Sparse Poster", "Half-Hearted Scroller", "The Part-Timer"
    ],
    quotes: [
      "You only reply when the stars align perfectly.",
      "A healthy relationship with social media? Disgusting.",
      "You exist, but just barely.",
      "You're only here for the memes, aren't you?",
      "Your takes are lukewarm at best.",
      "You type, you pause, you delete. The classic combo.",
      "You contribute just enough to prove you're alive.",
      "The 'I don't really use Twitter' final boss.",
      "Replying is a chore for you, we can tell.",
      "You treat the reply button like a sacred artifact.",
      "You step into the discourse, sniff the air, and leave.",
      "Chronically offline behavior detected.",
      "You touch grass on a regular basis. Wild.",
      "You're just passing through. Have a safe flight.",
      "A casual observer of the digital circus.",
      "You post like you're paying per character.",
      "Just enough engagement to trigger the algorithm.",
      "You keep your digital distance. Smart.",
      "A gentle breeze in a hurricane of takes.",
      "You're doing great. Keep touching that grass."
    ]
  },
  REGULAR: {
    themeClass: "persona-badge-socialite",
    description: "Balanced replier. No single target dominates your attention. Healthy!",
    emojis: ["🦋", "🤝", "🏛️", "💅", "🗣️", "🥂", "💬"],
    labels: [
      "The Socialite", "Watercooler Regular", "Timeline Small Talker", "Vibe Checker", "The Chitchatter",
      "Average Joe", "The Networker", "The Mingle Master", "Mid-Tier Poster", "The Casual Debater",
      "The Back-and-Forther", "The Participant", "The Contributor", "The Mixer", "The Social Butterfly",
      "The Balanced Diet", "The Commentator", "The Centrist", "Timeline Tenant", "The Town Square Regular"
    ],
    quotes: [
      "Spreading the love evenly — nobody gets too much attention.",
      "You reply like a diplomat — balanced and measured.",
      "A healthy reply diet! Someone's emotionally stable.",
      "You interact with everyone. How civic of you.",
      "Normal reply behavior detected. Boring, but healthy.",
      "You're the glue holding the timeline together.",
      "Just a regular person having regular conversations. Weirdo.",
      "You actually use this app for its intended purpose.",
      "The goldilocks of engagement: neither too hot nor too cold.",
      "You treat the timeline like a friendly neighborhood.",
      "A functioning member of digital society.",
      "You keep the group chats alive.",
      "Pleasant, active, completely average.",
      "You're why the servers stay on. Solid middle class of Twitter.",
      "Small talk is your native language.",
      "You reply just enough to be remembered, but not enough to be muted.",
      "You leave a comment, sip your coffee, and move on.",
      "Perfectly balanced, as all things should be.",
      "You've mastered the art of the 5-word reply.",
      "A pillar of the community, frankly."
    ]
  },
  ADDICT: {
    themeClass: "persona-badge-demon",
    description: "You reply heavily. You have an opinion on literally everything.",
    emojis: ["🗣️", "🍿", "📱", "🔋", "🛎️", "🎙️", "🔥"],
    labels: [
      "The Opinionated", "The Chatterbox", "The Frequent Flier", "The Keyboard Warmer", "The Extrovert",
      "The Active Citizen", "Always Online", "The Takes Machine", "The Local Mayor", "The Discourse Addict",
      "The Two Cents Giver", "The Mention Maniac", "The Constant Commentator", "The Yapper", "The Timeline Sheriff",
      "The Engagement Farmer", "The Notify Button", "The Too-Invested", "The Thread Unroller", "The Ping Pong Champion"
    ],
    quotes: [
      "You reply more than some people breathe.",
      "You have an opinion on literally everything.",
      "Your screen time is probably a war crime.",
      "Do you ever put the phone down?",
      "You're the reason people turn off notifications.",
      "You've never seen a take you couldn't counter.",
      "Your thumbs have six-packs.",
      "You treat every tweet like a personal invitation to speak.",
      "The timeline isn't ready for your level of yap.",
      "You've monetized the concept of 'just saying'.",
      "Bro is fighting invisible demons in the replies.",
      "Your WiFi provider is begging for mercy.",
      "You're chronically online and we're all worried.",
      "A permanent fixture in everyone's mentions.",
      "You reply so fast it's like a jump scare.",
      "You'd reply to a blank tweet just to be first.",
      "A true warrior of the digital age.",
      "The algorithm works hard, but you work harder.",
      "You have a PhD in uncalled-for opinions.",
      "You don't just read the timeline, you narrate it."
    ]
  },
  DEMON: {
    themeClass: "persona-badge-demon",
    description: "You average an insane amount of replies. Your timeline IS your replies.",
    emojis: ["💀", "😈", "👹", "☢️", "🚀", "🌪️", "🛑"],
    labels: [
      "The Reply Demon", "The Notification Terrorist", "Keyboard Warrior", "The Terminal Poster", "The Thread Hijacker",
      "The Discourse Dominator", "The Relentless", "The Screen Addict", "The Typist", "The Reply Sweats",
      "The Timeline Tyrant", "The Extremely Online", "The Incessant", "The Infinite Typewriter", "The Final Boss of Replies",
      "The Omnipresent", "The Absolute Menace", "The Digital Poltergeist", "The Touch Grass Averse", "The Keyboard Destroyer"
    ],
    quotes: [
      "Your keyboard needs therapy from the way you abuse it.",
      "Twitter should charge you a subscription just for replying.",
      "You're not on Twitter, Twitter is on YOU.",
      "Most people scroll. You type. At an alarming rate.",
      "You are a weapon of mass notification.",
      "You have achieved a state of permanent typing.",
      "A literal menace to the servers.",
      "You reply to things before they are even tweeted.",
      "Your autocorrect has given up completely.",
      "Is there a doctor present? This person hasn't blinked in days.",
      "You are the final boss of the internet.",
      "If replying burned calories, you wouldn't exist.",
      "You consider sleep a threat to your engagement.",
      "You exist purely as text on a screen at this point.",
      "The app developer didn't anticipate someone like you.",
      "You're the reason rate limits were invented.",
      "There is grass outside. Pls touch it.",
      "Total ecosystem collapse caused by your daily output.",
      "You don't just post, you deploy.",
      "The absolute pinnacle of unhinged reply guy energy."
    ]
  },
  GLAZER: {
    themeClass: "persona-badge-glazer",
    description: "Over 40% of your replies go to ONE person. That's not engagement, that's devotion.",
    emojis: ["🍩", "🥺", "👑", "🏇", "🎯", "🔭", "💫"],
    labels: [
      "The Elite Glazer", "The Professional Glazer", "The Sycophant", "The Fan Page", "The Number One Fan",
      "The Reply Guy (Obsessive)", "The Personal Hype Man", "The Orbiting Moon", "The Stan", "The Devotee",
      "The Disciple", "The Cheerleader", "The Dedicated Follower", "The Groupie", "The Worship Center",
      "The Cult Member", "The Echo", "The Shadow", "The Hype Beast", "The Loyal Subject"
    ],
    quotes: [
      "You don't reply to tweets, you write love letters.",
      "That person's notifications? That's basically YOUR profile page.",
      "You're not a fan, you're a franchise.",
      "Bro is one reply away from a restraining order.",
      "You hit reply faster than they hit tweet.",
      "They sneeze, you say bless you in the replies.",
      "You glaze them so hard they look like a donut.",
      "Does their PR team pay you, or do you do this for free?",
      "A true acolyte in the church of your top target.",
      "You're orbiting them like a satellite with a keyboard.",
      "If they jumped off a bridge, you'd reply 'W' on the way down.",
      "You're the president of their unofficial fan club.",
      "You've built your entire digital identity around someone else.",
      "You protect their replies like a secret service agent.",
      "They don't even know you exist bro. It's time to move on.",
      "The glazing is terminal. There is no cure.",
      "You reply like your life depends on their validation.",
      "You are the wind beneath their wings.",
      "The most loyal soldier in the digital trenches.",
      "You make Swifties look casually interested."
    ]
  },
  MAIN_CHARACTER: {
    themeClass: "persona-badge-main",
    description: "You mostly reply to yourself. You're having a public monologue.",
    emojis: ["🪞", "📓", "📝", "🗣️", "📖", "🎤", "🎙️"],
    labels: [
      "The Main Character", "The Monologuer", "The Journaler", "The Narcissus", "The One-Man Show",
      "The Thread Author", "The Public Diarist", "The Echo Chamber of One", "The Soliloquist", "The Self-Referential",
      "The Autobiography", "The Soapbox Proprietor", "The Lecturer", "The Solo Podcast", "The Mirror Talker",
      "The Diary Entry", "The Storyteller", "The Broadcaster", "The TED Talker", "The Lone Wolf"
    ],
    quotes: [
      "You're literally having a conversation with yourself.",
      "Your threads have more chapters than a Harry Potter book.",
      "Nobody asked but you answered... to yourself... 15 times.",
      "Self-replying isn't a hobby, it's a personality disorder.",
      "You don't need followers, you ARE your audience.",
      "Does your arm hurt from patting yourself on the back?",
      "You treat Twitter like a dear diary.",
      "You're running a solo marathon in the timeline.",
      "A one-person echo chamber of unprompted thoughts.",
      "You love the sound of your own digital voice.",
      "You supply both sides of the conversation.",
      "A self-sustaining ecosystem of replies.",
      "You've successfully eliminated the need for other people.",
      "You reply to yourself because you're the only one who listens.",
      "You're writing an autobiography one tweet at a time.",
      "Why speak to others when you can just agree with yourself?",
      "The ultimate solipsist of the social media age.",
      "You are your own biggest fan.",
      "Bro is delivering a keynote address to an empty room.",
      "You consider yourself the protagonist of reality."
    ]
  }
};

function runAlgorithm(
  entries: ParsedEntry[],
  userHandle: string
): AlgorithmResult {
  const handleLower = userHandle.toLowerCase();

  // Classify entries
  let totalOutwardReplies = 0;
  let totalSelfReplies = 0;
  let totalOriginalTweets = 0;
  const targetCounts = new Map<string, { count: number; latestAt: number }>();
  let earliestTimestamp = Infinity;
  let latestTimestamp = 0;

  for (const entry of entries) {
    // Only process entries by the target user
    if (entry.authorHandle.toLowerCase() !== handleLower) continue;

    // Track time window
    if (entry.createdAt > 0) {
      if (entry.createdAt < earliestTimestamp) earliestTimestamp = entry.createdAt;
      if (entry.createdAt > latestTimestamp) latestTimestamp = entry.createdAt;
    }

    if (entry.isRetweet) continue; // Skip retweets entirely

    if (!entry.isReply) {
      // Original tweet (not a reply to anyone)
      totalOriginalTweets++;
      continue;
    }

    // It's a reply — check if self-reply (thread) or outward reply
    if (entry.inReplyToScreenName.toLowerCase() === handleLower) {
      totalSelfReplies++;
    } else {
      totalOutwardReplies++;
      const target = entry.inReplyToScreenName.toLowerCase();
      const existing = targetCounts.get(target);
      if (existing) {
        existing.count++;
        if (entry.createdAt > existing.latestAt) existing.latestAt = entry.createdAt;
      } else {
        targetCounts.set(target, { count: 1, latestAt: entry.createdAt });
      }
    }
  }

  // Calculate window in days
  const windowMs =
    earliestTimestamp < Infinity && latestTimestamp > 0
      ? latestTimestamp - earliestTimestamp
      : SEVEN_DAYS_MS;
  const windowDaysFractional = Math.max(1, windowMs / (24 * 60 * 60 * 1000));
  const windowDays = Math.max(1, Math.ceil(windowDaysFractional));

  // Total posts by this user (originals + outward replies + self-replies)
  const totalPostsAnalyzed = totalOriginalTweets + totalOutwardReplies + totalSelfReplies;

  // Reply Ratio — what % of all posts are outward replies
  const replyRatio = totalPostsAnalyzed > 0 ? (totalOutwardReplies / totalPostsAnalyzed) * 100 : 0;

  // Daily Velocity — use fractional days for accurate calculation
  const dailyVelocity = totalOutwardReplies / windowDaysFractional;

  // Top Targets
  const sortedTargets = [...targetCounts.entries()]
    .map(([handle, data]) => ({
      handle,
      replyCount: data.count,
      percentage:
        totalOutwardReplies > 0
          ? Math.round((data.count / totalOutwardReplies) * 100)
          : 0,
      latestReplyAt: data.latestAt,
    }))
    .sort((a, b) => b.replyCount - a.replyCount)
    .slice(0, 5);

  // Target Concentration (top target's share)
  const topTargetPct = sortedTargets.length > 0 ? sortedTargets[0].percentage : 0;

  // Self-reply ratio
  const totalReplies = totalOutwardReplies + totalSelfReplies;
  const selfReplyPct = totalReplies > 0 ? (totalSelfReplies / totalReplies) * 100 : 0;

  // ─── Intensity Score (0-100) ────────────────────────────────────────────
  // Weighted formula:
  // - Daily Velocity contribution (0-40 pts): scales up to 300 replies/day
  // - Reply % contribution (0-25 pts): % of posts that are outward replies
  // - Target Concentration contribution (0-25 pts)
  // - Volume bonus (0-10 pts): scales up to 500 outward replies
  const velocityScore = Math.min(40, (dailyVelocity / 300) * 40);
  const ratioScore = Math.min(25, (replyRatio / 100) * 25);
  const concentrationScore = Math.min(25, (topTargetPct / 100) * 25);
  const volumeScore = Math.min(10, (totalOutwardReplies / 500) * 10);
  const intensityScore = Math.round(
    Math.min(100, velocityScore + ratioScore + concentrationScore + volumeScore)
  );

  // ─── Persona Assignment ─────────────────────────────────────────────────
  let archetypeKey: ArchetypeKey;
  if (topTargetPct > 40) {
    archetypeKey = "GLAZER";
  } else if (selfReplyPct > 80) {
    archetypeKey = "MAIN_CHARACTER";
  } else {
    if (intensityScore >= 86) {
      archetypeKey = "DEMON";
    } else if (intensityScore >= 61) {
      archetypeKey = "ADDICT";
    } else if (intensityScore >= 36) {
      archetypeKey = "REGULAR";
    } else if (intensityScore >= 16) {
      archetypeKey = "CASUAL";
    } else {
      archetypeKey = "GHOST";
    }
  }

  const archetype = ARCHETYPES[archetypeKey];
  // Deterministic random using score + total replies so the user gets a consistent result
  const seed = totalOutwardReplies + intensityScore;
  const label = archetype.labels[seed % archetype.labels.length];
  const quote = archetype.quotes[(seed + 1) % archetype.quotes.length];
  const emoji = archetype.emojis[(seed + 2) % archetype.emojis.length];

  return {
    persona: label,
    personaEmoji: emoji,
    personaDescription: archetype.description,
    savageQuote: quote,
    themeClass: archetype.themeClass,
    intensityScore,
    replyRatio: Math.round(replyRatio * 10) / 10,
    dailyVelocity: Math.round(dailyVelocity * 10) / 10,
    totalOutwardReplies,
    totalSelfReplies,
    totalOriginalTweets,
    totalPostsAnalyzed,
    topTargets: sortedTargets,
    windowDays,
  };
}

// ─── Global Stats Tracking ────────────────────────────────────────────────────

async function recordAudit(username: string, persona: PersonaType, score: number) {
  if (!redis) return;
  try {
    await redis.incr("replyguy:total_audits");
    await redis.zincrby("replyguy:trending", 1, username.toLowerCase());
    await redis.hset(
      "replyguy:audit_results",
      username.toLowerCase(),
      JSON.stringify({ persona, score, timestamp: Date.now() })
    );
  } catch (err) {
    console.error("[Redis] Tracking failed:", err);
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function analyzeMyReplies(username: string): Promise<IntensityAudit> {
  const clean = username.replace(/^@/, "").trim().toLowerCase();

  if (!clean || !/^[a-zA-Z0-9_]{1,50}$/.test(clean)) {
    throw new Error("Invalid username. Only letters, numbers and underscores allowed.");
  }

  const getCachedAnalysis = unstable_cache(
    async () => performActualScraping(clean),
    [`reply-intensity-v2-${clean}`],
    { revalidate: 300 } // 5 minute cache
  );

  return await getCachedAnalysis();
}

async function performActualScraping(clean: string): Promise<IntensityAudit> {
  const ids = await getQueryIds();
  let lastError: Error | null = null;

  // 3-attempt retry loop
  for (let attempt = 1; attempt <= 3; attempt++) {
    const cookies = getServerCookies();
    const headers = buildHeaders(cookies);

    try {
      console.log(`[scraper] Analysis attempt ${attempt}/3 for @${clean}...`);

      // 1. Look up user
      let user: UserInfo;
      try {
        user = await lookupUser(clean, headers, ids);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("not found") || msg.includes("suspended")) {
          // This is a real user issue, not a cookie issue — throw immediately
          throw err;
        }
        if (msg.includes("lookup failed")) {
          markCookieBurned(cookies, "User Lookup HTTP Error");
          lastError = err as Error;
          continue;
        }
        throw err;
      }

      // 2. Fetch Replies Tab (UserTweetsAndReplies)
      const { entries, rateLimited } = await fetchRepliesTab(
        user.id,
        clean,
        headers,
        ids
      );

      if (entries.length === 0 && rateLimited) {
        throw new Error("RATE_LIMITED");
      }

      if (entries.length === 0) {
        throw new Error(
          `No activity found for @${clean} in the last 7 days. The account may be private or inactive.`
        );
      }

      // 3. Run The Reply Guy Algorithm
      const result = runAlgorithm(entries, clean);

      const audit: IntensityAudit = {
        username: clean,
        displayName: user.name,
        avatarUrl: user.avatar,
        ...result,
        totalRepliesAnalyzed: entries.length,
        disclaimer: `Based on ${result.windowDays}-day activity window (${entries.length} posts analyzed).${rateLimited ? " Partial — X rate limited some requests." : ""}`,
      };

      // Record to Redis (fire and forget)
      recordAudit(clean, result.persona, result.intensityScore);

      return audit;
    } catch (err) {
      if (err instanceof Error && err.message === "RATE_LIMITED") {
        markCookieBurned(cookies, "Rate Limited (429)");
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Analysis failed after multiple attempts.");
}

// ─── Stats Helper ─────────────────────────────────────────────────────────────

export async function getGlobalStats(): Promise<{
  totalAudits: number;
  trending: string[];
}> {
  if (!redis) {
    return { totalAudits: 0, trending: [] };
  }

  try {
    const totalAudits = parseInt((await redis.get("replyguy:total_audits")) || "0", 10);
    const trending = await redis.zrevrange("replyguy:trending", 0, 4);
    return { totalAudits, trending };
  } catch (err) {
    console.error("[Stats] Error:", err);
    return { totalAudits: 0, trending: [] };
  }
}
