// Ember edge function. Contract: docs/01-API-CONTRACT.md. The server owns every write.
import { type Context, Hono } from "npm:hono@4";
import { cors } from "npm:hono@4/cors";
import { logger } from "npm:hono@4/logger";
import { bodyLimit } from "npm:hono@4/body-limit";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";
import {
  EMOTIONS,
  MEDIA_BUCKET,
  pickPosition,
  removeMedia,
  type ReplyRow,
  supabase,
  type ThoughtRow,
  toReply,
  toThought,
  uploadMedia,
  VARIANTS,
} from "./db.ts";
import { helplineFor } from "./helplines.ts";
import { AiUnavailableError, aiConfigured, generate, probeFeatherless, probeGemini } from "./llm.ts";
import { moderateImage, moderateText, moderateVoice, VoiceUnclearError } from "./moderation.ts";
import { detectNegativity } from "./safeSpace.ts";
import { isRateLimited } from "./rateLimit.ts";
import {
  issueAdminToken,
  randomToken,
  safeEqual,
  sha256Hex,
  verifyAdminPasscode,
  verifyAdminToken,
} from "./security.ts";
import { generateLantern, guessEmotion } from "./lantern.ts";
import { probeTts, scheduleAiReply } from "./aiReply.ts";
import { demoAutopilotTick, demoEnabled, demoKilled, demoOnline, scheduleDemoReplies, setDemoEnabled } from "./demo.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/** Run work after the response is sent (Supabase background tasks). */
function background(label: string, work: Promise<unknown>) {
  const guarded = work.catch((err) => console.error(`[${label}] background task failed:`, err));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(guarded);
}

// ─── Constants ──────────────────────────────────────────────────────

const MAX_TEXT = 600;
const MAX_VOICE_BYTES = 2 * 1024 * 1024;
const MAX_VOICE_SECONDS = 60;
const MAX_DRAWING_BYTES = 1.5 * 1024 * 1024;
const VOICE_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};
const STICKERS = new Set([
  "sticker_candle", "sticker_cloud", "sticker_drop", "sticker_flower", "sticker_globe",
  "sticker_hand", "sticker_heart", "sticker_hug", "sticker_leaf", "sticker_moon",
  "sticker_note", "sticker_shell", "sticker_sparkle", "sticker_star", "sticker_sun",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Helpers ────────────────────────────────────────────────────────

function fail(c: Context, status: number, code: string, message: string) {
  return c.json({ error: { code, message } }, status as 400);
}

function blocked(c: Context, reason: string, severity: "mild" | "moderate" | "severe") {
  return c.json({ blocked: true, reason, severity }, 422);
}

const tooFast = (c: Context, which: "minute" | "day" = "minute") =>
  which === "day"
    ? fail(c, 429, "rate_limited", "You've released a lot today. Rest a little, and come back tomorrow.")
    : fail(c, 429, "rate_limited", "Take a breath, try again in a minute.");

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function cleanAuthorId(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null;
}

function parseDataUrl(s: unknown): { mime: string; bytes: Uint8Array } | null {
  if (typeof s !== "string") return null;
  const m = /^data:([a-z]+\/[a-z0-9.+-]+)((?:;[^;,]+)*);base64,([A-Za-z0-9+/=\s]+)$/i.exec(s);
  if (!m) return null;
  try {
    return { mime: m[1].toLowerCase(), bytes: decodeBase64(m[3].replace(/\s/g, "")) };
  } catch {
    return null;
  }
}

const isPng = (b: Uint8Array) =>
  b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v);

async function createOwner(itemId: string, kind: "thought" | "reply"): Promise<string> {
  const token = randomToken();
  const { error } = await supabase.from("owners").insert({
    item_id: itemId,
    kind,
    token_hash: await sha256Hex(token),
  });
  if (error) throw new Error(`owner insert failed: ${error.message}`);
  return token;
}

async function canDelete(c: Context, itemId: string, kind: "thought" | "reply"): Promise<boolean> {
  if (await verifyAdminToken(c.req.header("X-Admin-Token"))) return true;
  return await isOwner(c.req.header("X-Owner-Token"), itemId, kind);
}

async function isOwner(token: string | undefined, itemId: string, kind: "thought" | "reply"): Promise<boolean> {
  if (!token) return false;
  const { data } = await supabase
    .from("owners")
    .select("token_hash")
    .eq("item_id", itemId)
    .eq("kind", kind)
    .maybeSingle();
  return !!data && safeEqual(await sha256Hex(token), data.token_hash);
}

// ─── App ────────────────────────────────────────────────────────────

const app = new Hono().basePath("/server");

const allowedOrigins = [
  "http://localhost:5173",
  ...(Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
];
// Entries may contain "*" for one host label, e.g. https://ember-*-team.vercel.app
const originMatchers = allowedOrigins.map((o) =>
  new RegExp("^" + o.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-z0-9-]+") + "$", "i")
);

app.use("*", logger(console.log));
app.use(
  "*",
  cors({
    origin: (origin) => (originMatchers.some((re) => re.test(origin)) ? origin : null),
    allowHeaders: ["Content-Type", "Authorization", "apikey", "x-client-info", "X-Owner-Token", "X-Admin-Token"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    maxAge: 600,
  }),
);

// Any successful write clears the shared GET /thoughts cache (see below).
app.use("*", async (c, next) => {
  await next();
  // POST /notifications only reads (it's a POST to keep owner tokens out of URLs).
  if (c.req.path.endsWith("/notifications")) return;
  if (c.req.method !== "GET" && c.req.method !== "OPTIONS" && c.res.status < 300) invalidateThoughtsCache();
});

app.onError((err, c) => {
  console.error("[server] unhandled error:", err);
  return fail(c, 500, "internal", "Something went quiet on our side. Please try again.");
});
app.notFound((c) => fail(c, 404, "not_found", "Nothing here."));

// Health
// ?deep=1 makes one small real LLM call and reports timing or a short error (never the key)
app.get("/health", async (c) => {
  if (!aiConfigured()) return c.json({ ok: true, ai: "down" });
  if (c.req.query("deep") === "featherless") return c.json({ ok: true, featherless: await probeFeatherless() });
  if (c.req.query("deep") === "tts") return c.json({ ok: true, tts: await probeTts() });
  if (c.req.query("deep") === "gemini") {
    return c.json({ ok: true, gemini: await probeGemini(c.req.query("models")?.split(",")) });
  }
  if (c.req.query("deep") !== "1") return c.json({ ok: true, ai: "up" });
  const t0 = Date.now();
  try {
    await generate('Return JSON only: {"ok": true}', { json: true, timeoutMs: 15000 });
    return c.json({ ok: true, ai: "up", llmMs: Date.now() - t0 });
  } catch (err) {
    return c.json({ ok: true, ai: "error", llm: (err as Error).message.slice(0, 300) });
  }
});

// List thoughts (newest 200 visible, replies oldest first)
// Only lanterns from the last 24 h (plus examples). With DEMO_MODE off, simulated thoughts and
// replies (authorId demo_*) are hidden too. Nothing is deleted.
//
// Every write fires a realtime event and every open browser then refetches this list, so with
// 100 people online one reply meant ~100 identical queries within a second. Responses are
// shared for THOUGHTS_CACHE_MS per instance; writes handled by this instance clear it.
const THOUGHTS_CACHE_MS = 2000;
let thoughtsCache: { body: string; demo: boolean; at: number } | null = null;
// Single-flight: requests that arrive while a query is running share it instead of each
// starting their own (a burst of 100 all missed the empty cache at once).
let thoughtsInFlight: { demo: boolean; promise: Promise<string> } | null = null;
let thoughtsGeneration = 0;
export function invalidateThoughtsCache() {
  thoughtsCache = null;
  thoughtsInFlight = null;
  thoughtsGeneration++;
}

app.get("/thoughts", async (c) => {
  const t0 = performance.now();
  // Server-Timing / X-Cache: lets the browser devtools (and load tests) see server time vs network.
  const timing = (cache: string) => ({
    "Content-Type": "application/json",
    "X-Cache": cache,
    "Server-Timing": `app;dur=${(performance.now() - t0).toFixed(1)}`,
  });
  const demo = await demoEnabled();
  if (demo) background("demoAutopilot", demoAutopilotTick());
  if (thoughtsCache && thoughtsCache.demo === demo && Date.now() - thoughtsCache.at < THOUGHTS_CACHE_MS) {
    return c.body(thoughtsCache.body, 200, timing("hit"));
  }
  const shared = !!thoughtsInFlight && thoughtsInFlight.demo === demo;
  if (!shared) {
    const generation = thoughtsGeneration;
    const promise = loadThoughts(demo).then((body) => {
      // Don't cache a result that a write made stale while it was loading.
      if (generation === thoughtsGeneration) thoughtsCache = { body, demo, at: Date.now() };
      return body;
    }).finally(() => {
      if (thoughtsInFlight?.promise === promise) thoughtsInFlight = null;
    });
    thoughtsInFlight = { demo, promise };
  }
  const body = await thoughtsInFlight!.promise;
  return c.body(body, 200, timing(shared ? "shared" : "miss"));
});

// Same SQL function the browser calls directly (migration 20261006000000_get_feed.sql):
// one query, and the API and the browser can never disagree about what's visible.
// `demo` keys the cache; demoEnabled() (called first) has already synced app_settings.
async function loadThoughts(_demo: boolean): Promise<string> {
  const { data, error } = await supabase.rpc("get_feed");
  if (error) throw new Error(error.message);
  return JSON.stringify(data ?? []);
}

// Create a thought
app.post("/thoughts", async (c) => {
  const limited = await isRateLimited(c.req.raw, "thought");
  if (limited) return tooFast(c, limited);
  const body = await readJson(c);
  if (!body) return fail(c, 400, "bad_request", "That didn't come through right. Try again?");

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 1 || text.length > MAX_TEXT) {
    return fail(c, 400, "invalid_text", `Your thought needs 1 to ${MAX_TEXT} characters.`);
  }
  const emotion = body.emotion ?? null;
  if (emotion !== null && !EMOTIONS.includes(emotion as typeof EMOTIONS[number])) {
    return fail(c, 400, "invalid_emotion", "That feeling tag isn't one we know.");
  }

  // Find a spot on the canvas while moderation runs (placement uses the instant rules check only).
  const placeAs = (emotion as string | null) ?? (detectNegativity(text).isCrisis ? null : guessEmotion(text));
  // Demo mode spends no AI credits: rules-only moderation, preset lantern, canned Ember reply.
  const useLlm = !(await demoEnabled());
  const [verdict, pos] = await Promise.all([moderateText(text, useLlm), pickPosition(placeAs)]);
  if (!verdict.allowed) return blocked(c, verdict.reason, verdict.severity as "mild");

  const { data: row, error } = await supabase
    .from("thoughts")
    .insert({
      text,
      emotion,
      author_id: cleanAuthorId(body.authorId),
      x: pos.x,
      y: pos.y,
      rotation: Math.round((Math.random() * 10 - 5) * 10) / 10,
      width: 280 + Math.floor(Math.random() * 61),
      variant: VARIANTS[Math.floor(Math.random() * VARIANTS.length)],
      show_help: verdict.isCrisis,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  let ownerToken: string;
  try {
    ownerToken = await createOwner(row.id, "thought");
  } catch (err) {
    await supabase.from("thoughts").delete().eq("id", row.id);
    throw err;
  }

  background("lantern", generateLantern(row.id, text, emotion as string | null, verdict.isCrisis, useLlm));
  background("aiReply", scheduleAiReply(row.id, useLlm, verdict.isCrisis));
  // Demo video only: simulated peers. Never on crisis thoughts.
  if (!verdict.isCrisis && !useLlm) background("demo", scheduleDemoReplies(row.id, emotion as string | null));

  return c.json(
    {
      thought: toThought({ ...row, replies: [] } as ThoughtRow),
      ownerToken,
      ...(verdict.isCrisis ? { helpline: helplineFor(body.country) } : {}),
    },
    201,
  );
});

// Delete a thought (owner or admin)
app.delete("/thoughts/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return fail(c, 404, "not_found", "That thought is already gone.");
  const { data: thought } = await supabase.from("thoughts").select("id").eq("id", id).maybeSingle();
  if (!thought) return fail(c, 404, "not_found", "That thought is already gone.");
  if (!(await canDelete(c, id, "thought"))) return fail(c, 403, "forbidden", "Only the person who released this can remove it.");

  const { data: replies } = await supabase
    .from("replies")
    .select("id, audio_url, drawing_url")
    .eq("thought_id", id);
  const { error } = await supabase.from("thoughts").delete().eq("id", id);
  if (error) throw new Error(error.message);

  const replyIds = (replies ?? []).map((r) => r.id);
  await supabase.from("owners").delete().in("item_id", [id, ...replyIds]);
  background("media", removeMedia((replies ?? []).flatMap((r) => [r.audio_url, r.drawing_url])));
  return c.body(null, 204);
});

// Admin: wipe the sky. Every thought (replies cascade), every owner token, and every uploaded
// voice note, drawing and Ember voice reply. The example lanterns stay, with their seeded replies
// (people's replies on them go). The demo-voice cache stays (it is reused, not user data).
app.delete("/thoughts", async (c) => {
  if (!(await verifyAdminToken(c.req.header("X-Admin-Token")))) {
    return fail(c, 403, "forbidden", "Only an admin can clear the sky.");
  }
  const { count, error } = await supabase.from("thoughts").delete({ count: "exact" }).eq("is_example", false);
  if (error) throw new Error(error.message);
  const { error: replyErr } = await supabase.from("replies").delete().eq("seeded", false);
  if (replyErr) throw new Error(replyErr.message);
  await supabase.from("owners").delete().not("item_id", "is", null);
  background("media", removeFolders(["voice", "drawing", "ai"]));
  return c.json({ deleted: count ?? 0 });
});

async function removeFolders(folders: string[]) {
  const bucket = supabase.storage.from(MEDIA_BUCKET);
  for (const folder of folders) {
    // list() returns at most `limit` files; removing them shrinks the list, so keep going until empty.
    for (let round = 0; round < 50; round++) {
      const { data, error } = await bucket.list(folder, { limit: 1000 });
      if (error || !data?.length) break;
      const { error: rmError } = await bucket.remove(data.map((f) => `${folder}/${f.name}`));
      if (rmError) {
        console.warn(`[media] wipe ${folder} failed:`, rmError.message);
        break;
      }
    }
  }
}

// Add a reply. Media bodies are base64 JSON: cap the raw body a little above 2 MB * 4/3.
app.post(
  "/thoughts/:id/replies",
  bodyLimit({
    maxSize: 3 * 1024 * 1024,
    onError: (c) => fail(c, 413, "too_large", "That's a bit too long, try a shorter recording."),
  }),
  async (c) => {
    const thoughtId = c.req.param("id");
    if (!UUID_RE.test(thoughtId)) return fail(c, 404, "not_found", "That thought is no longer here.");
    const limited = await isRateLimited(c.req.raw, "reply");
    if (limited) return tooFast(c, limited);
    const body = await readJson(c);
    if (!body) return fail(c, 400, "bad_request", "That didn't come through right. Try again?");

    const { data: thought } = await supabase
      .from("thoughts")
      .select("id, ai_status, author_id, hidden, show_help")
      .eq("id", thoughtId)
      .maybeSingle();
    if (!thought || thought.hidden) return fail(c, 404, "not_found", "That thought is no longer here.");

    const authorId = cleanAuthorId(body.authorId);
    const insert: Partial<ReplyRow> = { thought_id: thoughtId, author_id: authorId, is_ai: false };

    switch (body.type) {
      case "note": {
        const content = typeof body.content === "string" ? body.content.trim() : "";
        if (content.length < 1 || content.length > MAX_TEXT) {
          return fail(c, 400, "invalid_text", `Your reply needs 1 to ${MAX_TEXT} characters.`);
        }
        const verdict = await moderateText(content, !(await demoEnabled()));
        if (!verdict.allowed) return blocked(c, verdict.reason, verdict.severity as "mild");
        Object.assign(insert, { type: "note", content });
        break;
      }
      case "sticker": {
        if (typeof body.content !== "string" || !STICKERS.has(body.content)) {
          return fail(c, 400, "invalid_sticker", "That sticker isn't one we know.");
        }
        Object.assign(insert, { type: "sticker", content: body.content });
        break;
      }
      case "voice": {
        const media = parseDataUrl(body.audioData);
        if (!media || !VOICE_TYPES[media.mime]) {
          return fail(c, 400, "invalid_audio", "That recording didn't come through. Try again?");
        }
        // A missing/invalid durationSec used to count as "too long" (NaN failed the check), which
        // refused every voice note from a client that didn't send it. The 2 MB cap always applies.
        const duration = Number(body.durationSec);
        if (media.bytes.length > MAX_VOICE_BYTES) {
          return fail(c, 413, "too_large", "That recording is too big. Try one under a minute.");
        }
        if (Number.isFinite(duration) && duration > MAX_VOICE_SECONDS + 1) {
          return fail(c, 413, "too_long", "That's a bit too long. Voice notes can be up to a minute.");
        }
        // Upload while the check runs (saves the upload time); the file is removed if it's refused.
        const upload = uploadMedia(`voice/${crypto.randomUUID()}.${VOICE_TYPES[media.mime]}`, media.bytes, media.mime)
          .then((url) => ({ url }), (err: Error) => ({ err }));
        const discard = () => upload.then((u) => ("url" in u ? removeMedia([u.url]) : undefined));
        let verdict;
        try {
          verdict = await moderateVoice(media.bytes, media.mime);
        } catch (err) {
          background("media", discard());
          if (err instanceof AiUnavailableError) {
            return fail(c, 503, "ai_unavailable", "Voice replies are resting right now. Try a note?");
          }
          if (err instanceof VoiceUnclearError) {
            return blocked(c, "Couldn't hear that clearly, try again.", "mild");
          }
          throw err;
        }
        if (!verdict.allowed) {
          background("media", discard());
          return blocked(c, verdict.reason, verdict.severity as "mild");
        }
        const uploaded = await upload;
        if ("err" in uploaded) throw uploaded.err;
        const audioUrl = uploaded.url;
        Object.assign(insert, { type: "voice", content: verdict.transcript, audio_url: audioUrl });
        break;
      }
      case "drawing": {
        const media = parseDataUrl(body.drawingData);
        if (!media || media.mime !== "image/png" || !isPng(media.bytes)) {
          return fail(c, 400, "invalid_drawing", "That drawing didn't come through. Try again?");
        }
        if (media.bytes.length > MAX_DRAWING_BYTES) {
          return fail(c, 413, "too_large", "That drawing is a bit too big. Try a simpler one?");
        }
        const verdict = await moderateImage(media.bytes);
        if (!verdict.allowed) return blocked(c, verdict.reason, "moderate");
        const drawingUrl = await uploadMedia(`drawing/${crypto.randomUUID()}.png`, media.bytes, "image/png");
        Object.assign(insert, { type: "drawing", content: "", drawing_url: drawingUrl });
        break;
      }
      default:
        return fail(c, 400, "invalid_type", "Replies can be a note, voice, drawing or sticker.");
    }

    const { data: row, error } = await supabase.from("replies").insert(insert).select("*").single();
    if (error) {
      await removeMedia([insert.audio_url, insert.drawing_url]);
      throw new Error(error.message);
    }

    let ownerToken: string;
    try {
      ownerToken = await createOwner(row.id, "reply");
    } catch (err) {
      await supabase.from("replies").delete().eq("id", row.id);
      await removeMedia([row.audio_url, row.drawing_url]);
      throw err;
    }

    // A human (other than the author) answered: Ember stays quiet. Never for crisis messages:
    // Ember's calming reply always comes.
    if (thought.ai_status === "waiting" && !thought.show_help && (!authorId || authorId !== thought.author_id)) {
      await supabase.from("thoughts").update({ ai_status: "skipped" }).eq("id", thoughtId).eq("ai_status", "waiting");
    }

    return c.json({ reply: toReply(row as ReplyRow), ownerToken }, 201);
  },
);

// Delete a reply (owner or admin)
app.delete("/thoughts/:id/replies/:replyId", async (c) => {
  const thoughtId = c.req.param("id");
  const replyId = c.req.param("replyId");
  if (!UUID_RE.test(thoughtId) || !UUID_RE.test(replyId)) {
    return fail(c, 404, "not_found", "That reply is already gone.");
  }
  const { data: reply } = await supabase
    .from("replies")
    .select("id, audio_url, drawing_url")
    .eq("id", replyId)
    .eq("thought_id", thoughtId)
    .maybeSingle();
  if (!reply) return fail(c, 404, "not_found", "That reply is already gone.");
  if (!(await canDelete(c, replyId, "reply"))) return fail(c, 403, "forbidden", "Only the person who sent this can remove it.");

  const { error } = await supabase.from("replies").delete().eq("id", replyId);
  if (error) throw new Error(error.message);
  await supabase.from("owners").delete().eq("item_id", replyId);
  background("media", removeMedia([reply.audio_url, reply.drawing_url]));
  return c.body(null, 204);
});

// Optional live pre-check while typing. The final decision is always on POST.
app.post("/moderate", async (c) => {
  const limited = await isRateLimited(c.req.raw, "moderate");
  if (limited) return tooFast(c, limited);
  const body = await readJson(c);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ allowed: true, severity: "clean", reason: "", isCrisis: false });
  if (text.length > MAX_TEXT) return fail(c, 400, "invalid_text", `Keep it under ${MAX_TEXT} characters.`);
  return c.json(await moderateText(text, !(await demoEnabled())));
});

// Thank-you heart: the lantern's author thanks a reply. Proven with the lantern's owner token
// (X-Owner-Token), so only the real author can. The replier sees it via POST /notifications.
app.post("/thoughts/:id/replies/:replyId/thanks", async (c) => {
  const thoughtId = c.req.param("id");
  const replyId = c.req.param("replyId");
  if (!UUID_RE.test(thoughtId) || !UUID_RE.test(replyId)) return fail(c, 404, "not_found", "That reply is already gone.");
  const limited = await isRateLimited(c.req.raw, "reply");
  if (limited) return tooFast(c, limited);
  const { data: reply } = await supabase
    .from("replies")
    .select("id, is_ai, thanked_at")
    .eq("id", replyId)
    .eq("thought_id", thoughtId)
    .maybeSingle();
  if (!reply) return fail(c, 404, "not_found", "That reply is already gone.");
  if (!(await isOwner(c.req.header("X-Owner-Token"), thoughtId, "thought"))) {
    return fail(c, 403, "forbidden", "Only the person who released this lantern can thank its replies.");
  }
  if (reply.is_ai) return fail(c, 400, "bad_request", "ember.ai doesn't need thanks, but it's glad you're here.");
  if (!reply.thanked_at) {
    const { error } = await supabase.from("replies").update({ thanked_at: new Date().toISOString() }).eq("id", replyId);
    if (error) throw new Error(error.message);
  }
  return c.json({ thanked: true });
});

// Notifications for the popup, from the owner tokens this browser saved ({ itemId: ownerToken },
// lantern and reply tokens mixed), so only the real author sees them:
// - kind "reply": new replies to your lanterns. Your own replies are left out; Ember's are
//   included (isAI) so the popup can say "Ember answered".
// - kind "thanks": the author of a lantern you replied to thanked your reply.
const MAX_NOTIFY_ITEMS = 200;
const NOTIFY_WINDOW_MS = 24 * 60 * 60 * 1000;
app.post("/notifications", async (c) => {
  const now = new Date().toISOString(); // before the queries, so nothing slips between two polls
  const body = await readJson(c);
  const owned = body?.owned && typeof body.owned === "object" ? body.owned as Record<string, unknown> : {};
  const entries = Object.entries(owned)
    .filter((e): e is [string, string] => UUID_RE.test(e[0]) && typeof e[1] === "string")
    // The browser adds tokens as it goes, so the newest are last: keep those.
    .slice(-MAX_NOTIFY_ITEMS);
  if (!entries.length) return c.json({ notifications: [], now });
  const sinceMs = Date.parse(String(body?.since ?? ""));
  const floor = Date.now() - NOTIFY_WINDOW_MS;
  const since = new Date(Number.isFinite(sinceMs) ? Math.max(sinceMs, floor) : floor).toISOString();

  const { data: owners } = await supabase
    .from("owners")
    .select("item_id, kind, token_hash")
    .in("item_id", entries.map(([id]) => id));
  const byItem = new Map((owners ?? []).map((o) => [o.item_id as string, o]));
  const myThoughts: string[] = [];
  const myReplies: string[] = [];
  for (const [id, token] of entries) {
    const o = byItem.get(id);
    if (!o || !safeEqual(await sha256Hex(token), o.token_hash)) continue;
    (o.kind === "thought" ? myThoughts : myReplies).push(id);
  }
  if (!myThoughts.length && !myReplies.length) return c.json({ notifications: [], now });

  const none = { data: [] as Record<string, any>[] };
  const [{ data: thoughts }, { data: replies }, { data: thanked }, demo] = await Promise.all([
    myThoughts.length
      ? supabase.from("thoughts").select("id, text, author_id").in("id", myThoughts).eq("hidden", false)
      : none,
    myThoughts.length
      ? supabase
        .from("replies")
        .select("id, thought_id, type, content, is_ai, author_id, created_at")
        .in("thought_id", myThoughts)
        .gt("created_at", since)
        .order("created_at", { ascending: true })
        .limit(50)
      : none,
    myReplies.length
      ? supabase
        .from("replies")
        .select("id, thought_id, type, content, thanked_at, thoughts!inner(text, hidden)")
        .in("id", myReplies)
        .gt("thanked_at", since)
        .eq("thoughts.hidden", false)
        .limit(20)
      : none,
    demoEnabled(),
  ]);
  const byId = new Map((thoughts ?? []).map((t) => [t.id as string, t]));
  const replyNotes = (replies ?? [])
    .filter((r) => {
      const t = byId.get(r.thought_id);
      if (!t) return false;
      if (r.author_id && r.author_id === t.author_id) return false; // the author's own reply
      if (!demo && r.author_id?.startsWith("demo_")) return false; // same rule as the feed
      return true;
    })
    .map((r) => ({
      kind: "reply" as const,
      thoughtId: r.thought_id as string,
      thoughtText: byId.get(r.thought_id)!.text as string,
      replyId: r.id as string,
      type: r.type as string,
      isAI: !!r.is_ai,
      preview: r.type === "note" || r.type === "voice" ? String(r.content).slice(0, 120) : "",
      timestamp: r.created_at as string,
    }));
  const thanksNotes = (thanked ?? []).map((r) => ({
    kind: "thanks" as const,
    thoughtId: r.thought_id as string,
    thoughtText: String((r.thoughts as { text?: string } | null)?.text ?? ""),
    replyId: r.id as string,
    type: r.type as string,
    isAI: false,
    preview: r.type === "note" || r.type === "voice" ? String(r.content).slice(0, 120) : "",
    timestamp: r.thanked_at as string,
  }));
  const notifications = [...replyNotes, ...thanksNotes]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-20);
  return c.json({ notifications, now });
});

// Helpline for the viewer's country
app.get("/helpline", (c) => c.json(helplineFor(c.req.query("country"))));

// Demo mode: how many dummy people the frontend adds to its live online count
// The browser reads the feed from the database directly, so while demo mode is on it polls
// this endpoint (every 30 s) and that drives the autopilot instead of GET /thoughts.
app.get("/demo", async (c) => {
  const enabled = await demoEnabled();
  if (enabled) background("demoAutopilot", demoAutopilotTick());
  return c.json({ enabled, online: enabled ? demoOnline() : 0 });
});

// Admin toggle for demo mode (X-Admin-Token from /verify-admin)
app.post("/demo", async (c) => {
  if (!(await verifyAdminToken(c.req.header("X-Admin-Token")))) {
    return fail(c, 403, "forbidden", "Only an admin can change demo mode.");
  }
  const body = await readJson(c);
  if (typeof body?.enabled !== "boolean") return fail(c, 400, "bad_request", "Send { enabled: true | false }.");
  if (body.enabled && demoKilled()) {
    return fail(c, 409, "demo_disabled", "Demo is switched off on the server (DEMO_MODE=false).");
  }
  await setDemoEnabled(body.enabled);
  return c.json({ enabled: body.enabled, online: body.enabled ? demoOnline() : 0 });
});

// Admin: exchange the passcode for a short-lived token (sent as X-Admin-Token on deletes)
app.post("/verify-admin", async (c) => {
  const limited = await isRateLimited(c.req.raw, "admin");
  if (limited) return tooFast(c, limited);
  const body = await readJson(c);
  if (!verifyAdminPasscode(body?.passcode)) {
    return c.json({ success: false, error: { code: "forbidden", message: "Incorrect passcode." } }, 401);
  }
  return c.json({ success: true, adminToken: await issueAdminToken() });
});

Deno.serve(app.fetch);
