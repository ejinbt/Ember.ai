/**
 * SafeSpace — Client-side negativity & toxicity detection
 * 
 * Ember is a sanctuary for people who can't put feelings into words.
 * This module ensures that the space remains warm, safe, and free from
 * negativity, toxicity, hate speech, and harmful content.
 * 
 * 100% client-side — no external API latency.
 */

// ─── Severity levels ────────────────────────────────────────────────
export type Severity = 'clean' | 'mild' | 'moderate' | 'severe';

export interface SafeSpaceResult {
  allowed: boolean;
  severity: Severity;
  score: number; // 0–100
  reason: string; // Human-readable compassionate message
  matchedPatterns: string[]; // For debugging only
  isCrisis?: boolean; // True if self-harm or crisis patterns detected
}

// ─── Word lists with weights ────────────────────────────────────────
// Weight 1 = mild negativity, 2 = moderate, 3 = severe/toxic

const CRISIS_PATTERNS: RegExp[] = [
  /\b(suicide|self[\s-]*harm|cut\s*myself|end\s*(my|it)\s*all)\b/i,
  /\bk[i1]ll\s*myself\b/i,
  /\b(want\s*to\s*die|can'?t\s*do\s*this\s*anymore|giving\s*up\s*on\s*life)\b/i
];

const TOXIC_PATTERNS: { pattern: RegExp; weight: number; category: string }[] = [
  // Severe: Slurs, extreme hate, threats
  { pattern: /\bk[i1]ll\s*(your|my|him|her|them|yourself|ourselves)\b/i, weight: 3, category: 'threat' },
  { pattern: /\b(kill\s*yourself|kys)\b/i, weight: 3, category: 'threat' },
  { pattern: /\b(go\s*die|hope\s*you\s*die)\b/i, weight: 3, category: 'threat' },
  { pattern: /\bf+u+c+k+\s*(you|off|u|yo|ya)\b/i, weight: 3, category: 'profanity' },
  { pattern: /\bfuck(ing|ed)?\s*(idiot|moron|loser|bitch|cunt|retard)\b/i, weight: 3, category: 'insult' },
  { pattern: /\b(n[i1!]gg|f[a@]gg?[o0]t|tr[a@]nn[yi1]e?|r[e3]t[a@]rd)\b/i, weight: 3, category: 'slur' },
  { pattern: /\b(wh[o0]re|sl[u!]t|c[u!]nt)\b/i, weight: 3, category: 'slur' },
  { pattern: /\bi['']?ll\s*(kill|destroy|hurt|murder)\b/i, weight: 3, category: 'threat' },

  // Moderate: Strong insults, harassment, bullying
  { pattern: /\b(shut\s*(the\s*)?f+u+c+k+\s*up|stfu)\b/i, weight: 2, category: 'harassment' },
  { pattern: /\byou('re|r|\s+are)\s*(stupid|dumb|worthless|useless|pathetic|disgusting|ugly|trash|garbage)\b/i, weight: 2, category: 'insult' },
  { pattern: /\b(nobody\s*(loves|likes|cares\s*about)\s*(you|u))\b/i, weight: 2, category: 'bullying' },
  { pattern: /\b(loser|moron|idiot|imbecile|scum|scumbag)\b/i, weight: 2, category: 'insult' },
  { pattern: /\bfu+ck\b/i, weight: 2, category: 'profanity' },
  { pattern: /\bsh[i1!]t\b/i, weight: 2, category: 'profanity' },
  { pattern: /\bass\s*h[o0]le\b/i, weight: 2, category: 'profanity' },
  { pattern: /\bbitch(es|ing)?\b/i, weight: 2, category: 'profanity' },
  { pattern: /\bdamn\s*(you|it|this)\b/i, weight: 2, category: 'profanity' },
  { pattern: /\b(i\s*hate)\b/i, weight: 2, category: 'negativity' },
  { pattern: /\b(kill|murder|destroy|attack)\s*(all|every|them|those)\b/i, weight: 2, category: 'threat' },
  { pattern: /\b(racist|sexist|bigot)\b/i, weight: 2, category: 'discrimination' },

  // Mild: Negative energy, mild profanity, pessimism directed at others
  { pattern: /\b(suck[s]?|sucks|sucky)\b/i, weight: 1, category: 'negativity' },
  { pattern: /\b(crap|crappy)\b/i, weight: 1, category: 'profanity' },
  { pattern: /\b(hell|damn|dammit|damnit)\b/i, weight: 1, category: 'profanity' },
  { pattern: /\b(piss|pissed)\s*(off|at|on)\b/i, weight: 1, category: 'negativity' },
  { pattern: /\b(you\s*suck)\b/i, weight: 1, category: 'insult' },
  { pattern: /\b(worst|terrible|horrible|disgusting)\s*(person|human|people|thing)\b/i, weight: 1, category: 'negativity' },
  { pattern: /\b(shut\s*up)\b/i, weight: 1, category: 'negativity' },
  { pattern: /\b(get\s*lost|go\s*away|leave\s*me\s*alone)\b/i, weight: 1, category: 'negativity' },
];

// ─── Allowlist — emotions that SOUND negative but are valid feelings ───
// These are expressions of personal pain, NOT directed negativity
const ALLOWLIST_PATTERNS: RegExp[] = [
  /\bi\s*(feel|am|'m)\s*(sad|lonely|hurt|broken|lost|empty|anxious|scared|afraid|worried|depressed|tired|exhausted|overwhelmed)/i,
  /\bi\s*(can'?t|cannot)\s*(sleep|breathe|think|stop\s*crying|cope)/i,
  /\b(my\s*heart\s*(hurts|aches|is\s*broken))\b/i,
  /\b(i\s*miss\s*(you|them|her|him|my))\b/i,
  /\b(i'?m\s*(struggling|suffering|grieving|mourning|healing))\b/i,
  /\b(it\s*hurts|this\s*hurts|everything\s*hurts)\b/i,
  /\b(i\s*(hate|don'?t\s*like)\s*(myself|my\s*life|my\s*body|this\s*feeling))\b/i, // self-directed is vulnerable expression
  /\b(i\s*feel\s*like\s*(giving\s*up|nobody\s*cares|i'?m\s*invisible|i\s*don'?t\s*matter))\b/i,
  /\b(crying|tears|sobbing|weeping)\b/i,
  /\b(grief|loss|pain|sorrow|heartbreak)\b/i,
  /\b(i\s*need\s*(help|someone|a\s*hug|support))\b/i,
];

// ─── Compassionate messages by severity ─────────────────────────────
const COMPASSIONATE_MESSAGES: Record<Severity, string[]> = {
  clean: [],
  mild: [
    "This space is built on kindness. Could you soften this a little?",
    "ember.ai is a sanctuary — let's keep the energy warm and gentle.",
    "Your feelings are valid, but let's express them without harsh words.",
  ],
  moderate: [
    "This ember carries energy that might hurt someone. Let's try again with warmth.",
    "Everyone here is carrying something heavy. Let's choose words that heal, not hurt.",
    "ember.ai is a place for honest feelings, not harsh ones. Try expressing what's underneath the anger.",
  ],
  severe: [
    "This content can't be released into the sky. ember.ai is a safe space for everyone.",
    "Words that harm aren't welcome here. But what you're feeling underneath? That matters. Try again.",
    "ember.ai protects every soul in this space. This message can't be sent, but your real feelings can.",
  ],
};

// ─── Scoring & Detection ────────────────────────────────────────────
const THRESHOLD_MILD = 1;
const THRESHOLD_MODERATE = 3;
const THRESHOLD_SEVERE = 5;

export function detectNegativity(text: string): SafeSpaceResult {
  if (!text || !text.trim()) {
    return { allowed: true, severity: 'clean', score: 0, reason: '', matchedPatterns: [] };
  }

  const normalized = text
    .replace(/[.]{2,}/g, '.')
    .replace(/[!]{2,}/g, '!')
    .replace(/(.)\1{3,}/g, '$1$1$1'); // collapse repeated chars (fuuuuuck -> fuuuck)

  // Check for Crisis / Self-Harm first
  for (const pattern of CRISIS_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        allowed: true, // Never block a crisis cry for help
        severity: 'clean',
        score: 0,
        reason: "You matter. You are not alone. If you need immediate support, confidential help is available 24/7 at findahelpline.com or via your local emergency services.",
        matchedPatterns: ['crisis'],
        isCrisis: true
      };
    }
  }

  // Check allowlist first — personal vulnerability is always allowed
  for (const pattern of ALLOWLIST_PATTERNS) {
    if (pattern.test(normalized)) {
      // Even if other patterns match, if it's a personal vulnerability expression,
      // we reduce the score significantly
      const result = scoreText(normalized);
      if (result.score < THRESHOLD_SEVERE) {
        return { allowed: true, severity: 'clean', score: 0, reason: '', matchedPatterns: [] };
      }
      // Only block if it's ALSO severely toxic (e.g. "I feel sad and also f*** you")
    }
  }

  return scoreText(normalized);
}

function scoreText(text: string): SafeSpaceResult {
  let totalWeight = 0;
  const matchedPatterns: string[] = [];

  for (const { pattern, weight, category } of TOXIC_PATTERNS) {
    // Count all matches
    const matches = text.match(new RegExp(pattern.source, pattern.flags + 'g'));
    if (matches) {
      totalWeight += weight * matches.length;
      matchedPatterns.push(`${category}:${matches[0]}`);
    }
  }

  let severity: Severity;
  if (totalWeight >= THRESHOLD_SEVERE) {
    severity = 'severe';
  } else if (totalWeight >= THRESHOLD_MODERATE) {
    severity = 'moderate';
  } else if (totalWeight >= THRESHOLD_MILD) {
    severity = 'mild';
  } else {
    severity = 'clean';
  }

  const allowed = severity === 'clean';
  const score = Math.min(100, totalWeight * 10);

  const messages = COMPASSIONATE_MESSAGES[severity];
  const reason = messages.length > 0
    ? messages[Math.floor(Math.random() * messages.length)]
    : '';

  return { allowed, severity, score, reason, matchedPatterns };
}

// ─── Drawing safety check (content policy reminder) ─────────────────
export function getDrawingReminder(): string {
  return "Express freely — but remember, this space is built on kindness.";
}

// ─── Voice recording safety disclaimer ──────────────────────────────
export function getVoiceReminder(): string {
  return "Speak your truth — with warmth and care for others in this space.";
}
