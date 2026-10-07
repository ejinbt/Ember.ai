// Rate limits by sha256(ip + daily salt), stored in `rate_events`.
import { supabase } from "./db.ts";
import { sha256Hex } from "./security.ts";

export type RateKind = "thought" | "reply" | "moderate" | "admin" | "tts";

const LIMITS: Record<Exclude<RateKind, "tts">, { perMinute: number; perDay?: number }> = {
  // 200 a day per address: a venue or campus can share one IP (30 ran out during a day of testing).
  thought: { perMinute: 5, perDay: 200 },
  reply: { perMinute: 20 },
  moderate: { perMinute: 60 },
  admin: { perMinute: 5, perDay: 30 },
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";
}

async function ipHash(ip: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const salt = Deno.env.get("RATE_SALT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return await sha256Hex(`${ip}|${day}|${salt}`);
}

async function countSince(hash: string, kind: string, sinceMs: number): Promise<number> {
  const { count, error } = await supabase
    .from("rate_events")
    .select("*", { count: "exact", head: true })
    .eq("ip_hash", hash)
    .eq("kind", kind)
    .gte("created_at", new Date(Date.now() - sinceMs).toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Records the event; returns which limit the caller is over ("minute" or "day"), or false.
 * Fails open on database errors (availability over strictness), but logs them.
 */
export async function isRateLimited(req: Request, kind: Exclude<RateKind, "tts">): Promise<false | "minute" | "day"> {
  try {
    const hash = await ipHash(clientIp(req));
    const limit = LIMITS[kind];
    const [minute, day] = await Promise.all([
      countSince(hash, kind, MINUTE),
      limit.perDay ? countSince(hash, kind, DAY) : Promise.resolve(0),
    ]);
    if (limit.perDay && day >= limit.perDay) return "day";
    if (minute >= limit.perMinute) return "minute";
    await supabase.from("rate_events").insert({ ip_hash: hash, kind });
    if (Math.random() < 0.02) void cleanupOldEvents();
    return false;
  } catch (err) {
    console.error("[rateLimit] check failed, allowing:", err);
    return false;
  }
}

/** Global daily budget for paid TTS calls. Returns true (and records) if one is available. */
export async function takeTtsBudget(): Promise<boolean> {
  const max = Number(Deno.env.get("TTS_DAILY_LIMIT") ?? 200);
  try {
    if (await countSince("global", "tts", DAY) >= max) return false;
    await supabase.from("rate_events").insert({ ip_hash: "global", kind: "tts" });
    return true;
  } catch (err) {
    console.error("[rateLimit] tts budget check failed:", err);
    return false;
  }
}

async function cleanupOldEvents() {
  const { error } = await supabase
    .from("rate_events")
    .delete()
    .lt("created_at", new Date(Date.now() - DAY - MINUTE).toISOString());
  if (error) console.warn("[rateLimit] cleanup failed:", error.message);
}
