# Ember.ai

<p align="center">
  <img src="assets/readme/hero.png" alt="Ember.ai: someone on a rooftop at night releases a glowing lantern into a sky full of lanterns. Release what you feel. Someone will answer." width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React 18" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white" alt="Vite 6" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind 4" />
  <img src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20Edge%20Functions-3ECF8E?logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/AI-Featherless%20%C2%B7%20Gemini-8A2BE2" alt="AI: Featherless and Gemini" />
  <img src="https://img.shields.io/badge/voice-ElevenLabs-000000" alt="ElevenLabs voice" />
  <img src="https://img.shields.io/badge/hosted%20on-Vercel-000000?logo=vercel&logoColor=white" alt="Hosted on Vercel" />
  <img src="https://img.shields.io/badge/ForgeHacks%202026-AI%20%2B%20Creativity-D66A3E" alt="ForgeHacks 2026, AI + Creativity" />
</p>

<p align="center"><b>An anonymous night sky where every feeling becomes a lantern of light and sound, and someone always answers.</b></p>

<p align="center">
  <a href="https://ember-ai-beta.vercel.app"><img src="https://img.shields.io/badge/%E2%9C%A6%20TRY%20IT-ember--ai--beta.vercel.app-D66A3E?style=for-the-badge" alt="Try it" /></a>
  <a href="#"><img src="https://img.shields.io/badge/%E2%96%B6%20WATCH-demo%20video-1a1a1a?style=for-the-badge" alt="Watch the demo video" /></a>
  <a href="#"><img src="https://img.shields.io/badge/DEVPOST-Ember.ai-003E54?style=for-the-badge&logo=devpost&logoColor=white" alt="Devpost" /></a>
</p>

Built for **ForgeHacks Online 2026**, track **AI + Creativity**:
*"Build an AI-powered experience that introduces a new way for people to create, collaborate, express ideas, or experience art and media."*

> Ember is a place to be heard, not a replacement for professional care.
> If you're in danger right now, call your local helpline: **India 14416 (Tele-MANAS) · US 988 · UK 116 123 (Samaritans)**.

---

## Inspiration

It's 3 a.m. and something is heavy, but you can't say it to anyone you know. About 1 in 6 people worldwide feel lonely, and most of the people who die by suicide never told anyone how they felt (WHO).

Social media asks you to perform: profiles, likes, followers. We wanted the opposite: a quiet, anonymous place where saying how you feel is itself a small creative act, and where someone, a stranger or a gentle AI, answers.

## What it does

1. **Release a feeling.** Write a few honest words and optionally tag a feeling (lonely, anxious, grieving, hopeful, joyful, grateful).
2. **It becomes a lantern.** AI turns the words into a unique lantern: its colours, glow, flicker, shape and its own ambient soundscape (rain, wind, chimes, piano…). The sky becomes a shared, living artwork.
3. **Constellations.** Lanterns with the same feeling are joined by glowing threads, so you can see you're not alone. Right after you release, Ember tells you how many others felt the same tonight.
4. **Others answer.** Anyone can reply with a note, a voice note, a drawing or a sticker. You get a notification when someone answers, and you can send the replier a thank-you heart.
5. **Ember answers if no one does.** After a short wait, Ember (the AI) replies with a warm, short message and reads it aloud in a calm voice. Every AI reply is clearly labelled **✦ Ember (AI)**.
6. **It fades.** Lanterns fade after 24 hours. Say it, let it go.

### Safety, built in

- **Moderation on the server for everything:** text (rules + AI), voice notes (transcribed and checked), and drawings (image check). Hate and harassment are blocked with a gentle message; pain is always welcome.
- **Crisis care:** messages that sound like a crisis are never blocked or silenced. The writer immediately sees a warning card with the right helpline for their country, a guided breathing exercise and a list of international helplines, and Ember's calming reply arrives right away.
- **Anonymous by design:** no accounts, no profiles, no likes. Ownership (to delete your own lantern or get notified) is proven with a private token stored only in your browser.
- **Rate limits** on releasing, replying and AI usage; an admin can remove any message.

## How we built it

| Layer | What |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind, Framer Motion, Tone.js; a pannable/zoomable canvas with SVG lanterns and constellation threads |
| Backend | Supabase: Postgres (row-level security, the browser is read-only), Realtime, Storage, and one Deno/Hono **Edge Function** that owns every write |
| AI: text | [Featherless](https://featherless.ai) (Qwen 2.5 32B Instruct) for lantern design, moderation and Ember's replies, with Google **Gemini** as backup |
| AI: voice & images | **Gemini** transcribes and checks voice notes and checks drawings |
| AI: speech | **ElevenLabs** gives Ember its voice |
| Hosting | Vercel (frontend), Supabase (backend) |

**Architecture in short:**

```
Browser ──reads──▶ Postgres (get_feed RPC, read-only, RLS) ──Realtime──▶ all browsers refresh
   │
   └──writes──▶ Edge Function (Deno + Hono)
                  ├─ moderation: rules + Featherless/Gemini (text), Gemini (voice, drawings)
                  ├─ lantern design: AI → colours, glow, shape, sound, inferred feeling
                  ├─ Ember reply: AI text → ElevenLabs voice → Storage
                  ├─ crisis detection → helpline for the writer's country
                  └─ notifications, thank-you hearts, rate limits, admin
```

Highlights:
- **Fast under load:** the feed is one SQL function read straight from Postgres (about 4× faster than going through the function), with jittered realtime refreshes. Load-tested with 100 simultaneous users; a performance mode (`?perf=100`) renders 100 test lanterns.
- **Graceful when AI is down:** every AI step has a fallback (keyword rules for moderation and feelings, preset lanterns, gentle preset replies), so the app never stops working.
- **AI models rest after errors** and the next model takes over; voice checks start a backup model in parallel if the first is slow.

## Challenges we ran into

- **Safety without silencing.** A message like *"I don't think I can do this anymore"* must never be blocked, but must get help instantly. We combined rules and AI so crisis messages always reach the person with a helpline and a calm reply.
- **Latency.** Two AI checks in a row made posting feel stuck. We added clear loading states, cached moderation verdicts, and parallel uploads.
- **Anonymous ownership.** Without accounts we still needed "delete my lantern", notifications and thank-you hearts that only the real author can use: solved with hashed owner tokens.
- **Making AI feel humane.** Prompts that keep Ember short, warm and never preachy, always labelled as AI.

## Accomplishments we're proud of

- A real, live, working product: release, replies in four formats, notifications, crisis care, all deployed.
- Every feeling becomes a different piece of light and sound: the sky is genuinely a shared artwork.
- Safety that is caring rather than punishing.

## What we learned

How to design AI features around people's wellbeing: moderation, crisis detection, honest AI labelling, and fallbacks so the experience never breaks for someone who needs it.

## What's next

- More languages and local helplines (verified by country).
- Optional accounts across devices that keep anonymity.
- Moderator tools and community guidelines co-written with mental-health professionals.

---

## Run it locally

**Requirements:** Node.js 18+, and the [Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase`) for the backend.

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build in dist/
```

The frontend uses the project's public Supabase URL and publishable key (`supabase/info.tsx`); no frontend environment variables are needed.

### Backend (Supabase)

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push                        # tables, feed function, example lanterns
npx supabase functions deploy server
```

Set the function's secrets with `npx supabase secrets set NAME=value` (see [.env.example](.env.example); never commit real values):

| Secret | Purpose |
|---|---|
| `FEATHERLESS_API_KEY` | text AI (moderation, lanterns, Ember's replies) |
| `GEMINI_API_KEY` | backup text AI; voice and drawing checks |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Ember's voice |
| `ADMIN_PASSCODE` | admin mode (double-click the logo) |
| `ALLOWED_ORIGINS` | frontend URLs allowed to write (e.g. your Vercel URL) |
| `DEMO_MODE` | `false` disables simulated people (use `false` in production) |

## Project structure

```
app/                     React frontend (App.tsx, components/, api.ts)
supabase/functions/server/   Edge Function: API, moderation, lanterns, Ember replies
supabase/migrations/     Database schema, feed function, example lanterns
fixtures/                Example lanterns (also seeded into the database)
assets/                  Images and the ambient music
```

## Team

- **Alen Joby** ([@alenjoby](https://github.com/alenjoby)): frontend, design, sound
- **Ejin** ([@ejinbt](https://github.com/ejinbt)): backend, AI pipeline, safety, deployment, demo video
