import { motion, useMotionValue, AnimatePresence, useTransform, animate } from 'framer-motion';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  ZoomIn, ZoomOut, Focus, Mic, Feather, Brush, Sparkles, Cloud, Flower2, Waves, Sun, Droplet, Heart, Info, Volume2, VolumeX
} from 'lucide-react';
import type { Thought, ThoughtResponse } from '../App';
import { Lantern } from './Lantern';
import { ConnectionThreads, type ConnectionThreadsHandle } from './ConnectionThreads';
import { getOwnerToken } from '../api';
import { projectId, publicAnonKey } from '../../supabase/info';


const EMOTION_ICONS: Record<string, React.ElementType> = {
  lonely: Cloud,
  grateful: Flower2,
  anxious: Waves,
  hopeful: Sun,
  grieving: Droplet,
  joyful: Sparkles,
};
import { STICKER_DATA } from './stickersData';
import { useSkyAmbientSound } from './useLanternSound';

interface MainSpaceProps {
  thoughts: Thought[];
  selectedThoughtId?: string | null;
  onInputClick: () => void;
  onThoughtClick: (thought: Thought) => void;
  onReplyClick: (thought: Thought, reply: ThoughtResponse) => void;
  onHistoryClick: () => void;
  onThoughtMove: (id: string, x: number, y: number) => void;
  aiGlowThoughtId: string | null;
  voiceCount: number;
  panToTarget: { x: number; y: number } | null;
  onPanComplete: () => void;
  tutorialStep?: 'none' | 'hud' | 'star' | 'reply' | 'complete';
  setTutorialStep?: (step: 'none' | 'hud' | 'star' | 'reply' | 'complete') => void;
  onTriggerPanToStar?: () => void;
  hasUnreadHistory?: boolean;
}


const EMOJI_TO_ICON: Record<string, string> = {
  '🤍': 'sticker_heart',
  'Heart': 'sticker_heart',
  '✨': 'sticker_sparkle',
  'Sparkles': 'sticker_sparkle',
  '🌙': 'sticker_moon',
  'Moon': 'sticker_moon',
  '⭐': 'sticker_star',
  'Star': 'sticker_star',
  '🌿': 'sticker_leaf',
  'Leaf': 'sticker_leaf',
  '🤗': 'sticker_hand',
  'Smile': 'sticker_hand',
  '🫂': 'sticker_hug',
  'HeartHandshake': 'sticker_hug',
  '🕯️': 'sticker_candle',
  'Flame': 'sticker_candle',
  '🐚': 'sticker_shell',
  'Waves': 'sticker_shell',
  '💧': 'sticker_drop',
  'Droplet': 'sticker_drop',
  '☁️': 'sticker_cloud',
  'Cloud': 'sticker_cloud',
  '🌸': 'sticker_flower',
  'Flower2': 'sticker_flower',
  '☀️': 'sticker_sun',
  'Sun': 'sticker_sun',
  '🎵': 'sticker_note',
  'Music': 'sticker_note',
  '🌺': 'sticker_flower',
  'Flower': 'sticker_flower',
};

function StickerIcon({ nameOrEmoji, size = 16, className }: { nameOrEmoji: string; size?: number; className?: string }) {
  const iconName = EMOJI_TO_ICON[nameOrEmoji] || nameOrEmoji;
  
  if (STICKER_DATA[iconName]) {
    return (
      <img
        src={STICKER_DATA[iconName]}
        alt={iconName}
        className={className}
        style={{ width: `${size}px`, height: `${size}px`, objectFit: 'contain' }}
      />
    );
  }
  return <span className={className} style={{ fontSize: `${size}px` }}>{nameOrEmoji}</span>;
}

const floatAnimationStyles = `
  @keyframes float-bob {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
  }
  .lantern-offscreen { visibility: hidden; }
  .lantern-offscreen * { animation-play-state: paused !important; }
  .animate-float-bob {
    animation: float-bob var(--float-duration, 5s) ease-in-out infinite;
    animation-delay: var(--float-delay, 0s);
    will-change: transform;
  }
  @keyframes nebula-flow-1 {
    0%, 100% { transform: translate(-30%, -35%) scale(1) rotate(0deg); opacity: 0.65; }
    50% { transform: translate(-20%, -25%) scale(1.12) rotate(180deg); opacity: 0.85; }
  }
  @keyframes nebula-flow-2 {
    0%, 100% { transform: translate(-65%, -60%) scale(1.1) rotate(0deg); opacity: 0.55; }
    50% { transform: translate(-75%, -70%) scale(0.95) rotate(-180deg); opacity: 0.75; }
  }
  @keyframes nebula-flow-3 {
    0%, 100% { transform: translate(-40%, -50%) scale(0.9) rotate(0deg); opacity: 0.5; }
    50% { transform: translate(-50%, -40%) scale(1.12) rotate(180deg); opacity: 0.7; }
  }
  .animate-nebula-1 {
    animation: nebula-flow-1 32s ease-in-out infinite;
    will-change: transform, opacity;
  }
  .animate-nebula-2 {
    animation: nebula-flow-2 40s ease-in-out infinite;
    will-change: transform, opacity;
  }
  .animate-nebula-3 {
    animation: nebula-flow-3 26s ease-in-out infinite;
    will-change: transform, opacity;
  }
  @keyframes star-twinkle {
    0%, 100% { opacity: 0.25; transform: scale(0.8) rotate(0deg); }
    50% { opacity: 1; transform: scale(1.15) rotate(45deg); }
  }
  .animate-twinkle {
    animation: star-twinkle var(--twinkle-duration, 4s) ease-in-out infinite;
    animation-delay: var(--twinkle-delay, 0s);
    will-change: opacity, transform;
  }
  @keyframes shooting-star-flow {
    0% { transform: translate(0, 0) rotate(-35deg) scaleX(0); opacity: 0; }
    1% { opacity: 1; }
    4% { transform: translate(-300px, 210px) rotate(-35deg) scaleX(1); opacity: 1; }
    8% { transform: translate(-600px, 420px) rotate(-35deg) scaleX(0.5); opacity: 0; }
    100% { transform: translate(-600px, 420px) rotate(-35deg) scaleX(0); opacity: 0; }
  }
  .animate-shooting-star {
    position: absolute;
    height: 1.5px;
    background: linear-gradient(90deg, #ffffff 0%, rgba(255,252,245,0.6) 40%, rgba(255,255,255,0) 100%);
    opacity: 0;
    animation: shooting-star-flow var(--duration, 16s) cubic-bezier(0.16, 1, 0.3, 1) infinite;
    animation-delay: var(--delay, 0s);
    will-change: transform, opacity;
  }
  @keyframes beam-flow {
    to {
      stroke-dashoffset: -24;
    }
  }
  .animate-beam {
    stroke-dasharray: 8 4;
    animation: beam-flow 1.2s linear infinite;
    stroke-linecap: round;
  }
`;

interface ThoughtCardProps {
  thought: Thought;
  onClick: (thought: Thought) => void;
  onReplyClick: (thought: Thought, reply: ThoughtResponse) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  isGlowing: boolean;
  isHovered: boolean;
  getScale: () => number;
  onHoverStart: (id: string) => void;
  onHoverEnd: () => void;
  setIsDraggingCard: (dragging: boolean) => void;
  /** Called once per animation frame while dragging, so connection threads follow live. */
  onDragMove: (id: string, dx: number, dy: number) => void;
  tutorialStep?: 'none' | 'hud' | 'star' | 'reply' | 'complete';
  dimmed?: boolean;
  isNew?: boolean;
}

const ThoughtCard = React.memo(function ThoughtCard({
  thought,
  onClick,
  onReplyClick,
  onDragEnd,
  isGlowing,
  isHovered,
  getScale,
  onHoverStart,
  onHoverEnd,
  setIsDraggingCard,
  onDragMove,
  tutorialStep = 'none',
  dimmed = false,
  isNew = false,
}: ThoughtCardProps) {
  const ageInHours = (new Date().getTime() - new Date(thought.timestamp).getTime()) / (1000 * 60 * 60);
  // Fades over the last 4 of its 24 hours; example lanterns never fade.
  const targetOpacity = !thought.isExample && ageInHours > 20 ? Math.max(0.2, 1 - (ageInHours - 20) / 4) : 1;

  const charSum = thought.id.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const duration = 4.5 + (charSum % 3);
  const delay = -(charSum % 5);

  const isTutorial = thought.id === 'thought-tutorial-1';

  // Smooth pointer drag: while dragging, move the card with a GPU transform once per animation
  // frame, written straight to the DOM. No React state per pointermove, so the Lantern subtree
  // doesn't re-render 60-120x/s and left/top don't force layout every frame.
  const cardRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const baseTransform = `rotate(${thought.rotation}deg)`;

  // After a drop, the new left/top arrives via props: only then drop the drag translate,
  // so the card never flashes back to its old spot.
  React.useLayoutEffect(() => {
    if (cardRef.current) cardRef.current.style.transform = baseTransform;
  }, [thought.x, thought.y, baseTransform]);

  // Lanterns outside the viewport (plus a 200px margin) are hidden and their animations paused:
  // with 100 lanterns most are off-screen, but their halo/flame/float/orbit kept running.
  // Toggled straight on the DOM, no React render. Threads to them still draw.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => el.classList.toggle('lantern-offscreen', !entry.isIntersecting),
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Don't drag if clicking an interactive button or reply
    if ((e.target as HTMLElement).closest('button, [data-no-drag]')) return;

    e.stopPropagation();
    if (e.nativeEvent && e.nativeEvent.stopImmediatePropagation) {
      e.nativeEvent.stopImmediatePropagation();
    }

    // The tutorial lantern can't be dragged, but it must still open on click: clicks are
    // detected here (press + release without moving), so returning early broke the tutorial.
    if (isTutorial) {
      const sx = e.clientX;
      const sy = e.clientY;
      const onUp = (upEvt: PointerEvent) => {
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        if (Math.hypot(upEvt.clientX - sx, upEvt.clientY - sy) <= 6) onClick(thought);
      };
      const onCancel = () => {
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      return;
    }

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startThoughtX = thought.x;
    const startThoughtY = thought.y;
    let didMove = false;
    let currentDx = 0;
    let currentDy = 0;

    setIsDragging(true);
    setIsDraggingCard(true);

    const onPointerMove = (moveEvt: PointerEvent) => {
      moveEvt.preventDefault();
      moveEvt.stopPropagation();
      const scale = getScale() || 1;
      const dxScreen = moveEvt.clientX - startClientX;
      const dyScreen = moveEvt.clientY - startClientY;

      if (!didMove && Math.hypot(dxScreen, dyScreen) > 4) {
        didMove = true;
      }

      if (didMove) {
        currentDx = dxScreen / scale;
        currentDy = dyScreen / scale;
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            if (cardRef.current) {
              cardRef.current.style.transform = `translate3d(${currentDx}px, ${currentDy}px, 0) ${baseTransform} scale(1.05)`;
            }
            onDragMove(thought.id, currentDx, currentDy);
          });
        }
      }
    };

    const onPointerUp = (upEvt: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      setIsDragging(false);
      setIsDraggingCard(false);

      if (didMove) {
        const finalX = Math.round(startThoughtX + currentDx);
        const finalY = Math.round(startThoughtY + currentDy);
        // Keep the card where it was dropped until the new left/top lands (layout effect above).
        if (cardRef.current) {
          cardRef.current.style.transform = `translate3d(${finalX - startThoughtX}px, ${finalY - startThoughtY}px, 0) ${baseTransform}`;
        }
        // Threads at the exact final spot, matching what React renders next.
        onDragMove(thought.id, finalX - startThoughtX, finalY - startThoughtY);
        onDragEnd(thought.id, finalX, finalY);
      } else {
        if (cardRef.current) cardRef.current.style.transform = baseTransform;
        onClick(thought);
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: false });
    window.addEventListener('pointercancel', onPointerUp, { passive: false });
  };

  return (
    <div
      ref={cardRef}
      onPointerDown={handlePointerDown}
      className={`absolute select-none outline-none ${isDragging ? 'z-50 cursor-grabbing' : (isGlowing ? 'z-40' : 'z-20')} cursor-grab`}
      style={{
        left: thought.x,
        top: thought.y,
        width: 250,
        // Tilt (and the drag scale) pivot on the tip of the lantern's stick, like a lantern
        // hanging from its string. Around the card's centre the tip swung up to ~13 px sideways,
        // away from the constellation thread tied to it.
        transformOrigin: '125px 0px',
        // transform is owned by the drag code / layout effect above, not set here,
        // so React re-renders never overwrite an in-progress drag position.
        touchAction: 'none',
        WebkitTapHighlightColor: 'transparent', // no grey tap box on mobile
        // The 250px card box itself ignores the pointer; only the lantern vessel, text and reply
        // chips (pointer-events-auto in Lantern) grab it. With 40+ lanterns the boxes covered
        // nearly the whole canvas, so pressing "empty" space dragged a lantern instead of panning.
        pointerEvents: 'none',
        opacity: targetOpacity,
        transition: isDragging ? 'none' : 'opacity 0.5s ease',
        willChange: isDragging ? 'transform' : undefined,
      }}
      onMouseEnter={() => onHoverStart(thought.id)}
      onMouseLeave={onHoverEnd}
    >
      {isTutorial && tutorialStep === 'star' && (
        <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 z-50 pointer-events-none w-[240px]">
          <div 
            className="bg-[rgba(20,15,25,0.98)] backdrop-blur-xl border border-[rgba(214,106,62,0.4)] rounded-[16px] px-4 py-3 text-center shadow-[0_12px_40px_rgba(0,0,0,0.6),_0_0_20px_rgba(214,106,62,0.15)] relative animate-pulse"
          >
            <p className="text-[#f9f3eb] text-[13px] font-medium leading-relaxed" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
              Look, a floating lantern. Click on it to read its whisper.
            </p>
            {/* Subtle arrow pointing down */}
            <div className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-[rgba(20,15,25,0.98)] border-r border-b border-[rgba(214,106,62,0.4)]" />
          </div>
        </div>
      )}
      <div 
        className="relative w-full h-full animate-float-bob"
        style={{ '--float-duration': `${duration}s`, '--float-delay': `${delay}s` } as React.CSSProperties}
      >
        <Lantern
          id={thought.id}
          lantern={thought.lantern || null}
          text={thought.text}
          emotion={thought.emotion as any}
          aiStatus={thought.aiStatus || 'waiting'}
          isExample={thought.isExample}
          responses={thought.responses || []}
          isGlowing={isGlowing}
          isHovered={isHovered}
          dimmed={dimmed}
          isNew={isNew}
          onReplyClick={(reply) => onReplyClick(thought, reply)}
          width={250}
        />
      </div>
    </div>
  );
});

/**
 * High-performance 2D Canvas Star Field
 * Replaces 600 separate animated DOM <div> nodes with a single GPU-backed canvas.
 */
const StarCanvas = React.memo(function StarCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = 4000;
    const height = 4000;
    canvas.width = width;
    canvas.height = height;

    interface StarPoint {
      x: number;
      y: number;
      size: number;
      phase: number;
      speed: number;
      isDiamond: boolean;
    }

    const starPoints: StarPoint[] = [];
    for (let i = 0; i < 600; i++) {
      const seed = i * 67.89;
      const random = (s: number) => {
        const x = Math.sin(s) * 10000;
        return x - Math.floor(x);
      };
      const isDiamond = random(seed) < 0.12;
      const size = isDiamond ? 3 : random(seed + 1) < 0.45 ? 1 : 1.8;
      starPoints.push({
        x: random(seed + 2) * width,
        y: random(seed + 3) * height,
        size,
        phase: random(seed + 5) * Math.PI * 2,
        speed: 0.0012 + random(seed + 4) * 0.002,
        isDiamond,
      });
    }

    // Drawn ONCE. Redrawing this 4000x4000 canvas every frame (16M pixels, ~64 MB re-uploaded
    // to the GPU per frame) was the single biggest per-frame cost on the canvas. The twinkle
    // now comes from a few CSS-animated stars (TwinkleStars) that run on the compositor.
    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < starPoints.length; i++) {
        const p = starPoints[i];
        const alpha = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(p.phase));

        ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;

        if (p.isDiamond) {
          ctx.beginPath();
          const r = p.size * 2.2;
          ctx.moveTo(p.x, p.y - r);
          ctx.lineTo(p.x + r * 0.35, p.y);
          ctx.lineTo(p.x + r, p.y);
          ctx.lineTo(p.x + r * 0.35, p.y + r * 0.35);
          ctx.lineTo(p.x, p.y + r);
          ctx.lineTo(p.x - r * 0.35, p.y + r * 0.35);
          ctx.lineTo(p.x - r, p.y);
          ctx.lineTo(p.x - r * 0.35, p.y - r * 0.35);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    draw();
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute pointer-events-none"
        style={{
          width: 4000,
          height: 4000,
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />
      {TWINKLERS.map(s => (
        <div
          key={s.id}
          className="absolute rounded-full bg-white animate-twinkle pointer-events-none"
          style={{
            left: s.x,
            top: s.y,
            width: s.size,
            height: s.size,
            '--twinkle-duration': s.duration,
            '--twinkle-delay': s.delay,
          } as React.CSSProperties}
        />
      ))}
    </>
  );
});

// A few twinkling stars on top of the static canvas, around the area usually in view.
// CSS opacity/transform animations run on the compositor (no per-frame JavaScript).
const TWINKLERS = Array.from({ length: 70 }, (_, i) => {
  const r = (s: number) => {
    const x = Math.sin(s * 91.37 + i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    id: i,
    x: Math.round(r(1) * 2600 - 1300),
    y: Math.round(r(2) * 2600 - 1300),
    size: r(3) < 0.2 ? 3 : 2,
    duration: `${4 + r(4) * 5}s`,
    delay: `${-r(5) * 6}s`,
  };
});


const EMOTION_CHIPS = [
  { key: 'lonely', label: 'Lonely', color: '#9DB4FF' },
  { key: 'anxious', label: 'Anxious', color: '#8FE3D8' },
  { key: 'grieving', label: 'Grieving', color: '#C9A7FF' },
  { key: 'hopeful', label: 'Hopeful', color: '#FFE7A3' },
  { key: 'joyful', label: 'Joyful', color: '#FFE08A' },
  { key: 'grateful', label: 'Grateful', color: '#D9F2B4' },
] as const;

export function MainSpace({ thoughts, selectedThoughtId, onInputClick, onThoughtClick, onReplyClick, onHistoryClick, onThoughtMove, aiGlowThoughtId, voiceCount, panToTarget, onPanComplete, tutorialStep = 'none', setTutorialStep, onTriggerPanToStar, hasUnreadHistory = false }: MainSpaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const panX = useMotionValue(0);
  const panY = useMotionValue(0);
  const [showHint, setShowHint] = useState(true);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const [hoveredThoughtId, setHoveredThoughtId] = useState<string | null>(null);
  const [focusEmotion, setFocusEmotion] = useState<string | null>(null);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showEmptyState, setShowEmptyState] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('ember_sound') !== 'off');
  useSkyAmbientSound(soundEnabled);

  const toggleSound = () => {
    const nextState = !soundEnabled;
    setSoundEnabled(nextState);
    localStorage.setItem('ember_sound', nextState ? 'on' : 'off');
  };
  const handleLogoDoubleClick = async () => {
    if (localStorage.getItem("ember_admin") === "true") {
      const deactivate = window.confirm("Deactivate Admin mode?");
      if (deactivate) {
        localStorage.removeItem("ember_admin");
        localStorage.removeItem("ember_admin_token");
        alert("Admin mode deactivated.");
        window.location.reload();
      }
      return;
    }
    const code = prompt("Enter admin passcode:");
    if (code) {
      try {
        const response = await fetch(`https://${projectId}.supabase.co/functions/v1/server/verify-admin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': publicAnonKey,
            'Authorization': `Bearer ${publicAnonKey}`
          },
          body: JSON.stringify({ passcode: code })
        });
        const result = await response.json();
        if (result.success && result.adminToken) {
          localStorage.setItem("ember_admin", "true");
          // The server's signed token (valid 12 h), sent as X-Admin-Token on deletes.
          // Storing the passcode here made every admin delete fail with 403.
          localStorage.setItem("ember_admin_token", result.adminToken);
          alert("Admin mode activated. Trash icons are now visible next to all thoughts and replies.");
          window.location.reload();
        } else {
          alert("Incorrect passcode.");
        }
      } catch (err) {
        alert("Failed to verify passcode: " + (err instanceof Error ? err.message : String(err)));
      }
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowEmptyState(false);
    }, 12000); // Hide placeholder after 12 seconds
    return () => clearTimeout(timer);
  }, []);

  const filteredThoughts = thoughts;

  const bgX = useTransform(panX, x => x * 0.12);
  const bgY = useTransform(panY, y => y * 0.12);

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const getScale = useCallback(() => scaleRef.current, []);

  // Ignore hover changes while a lantern is being dragged across others: each one would
  // re-render the canvas and every constellation thread mid-drag.
  const isDraggingCardRef = useRef(false);
  isDraggingCardRef.current = isDraggingCard;
  // Threads follow a dragged lantern live (imperative, no React render per frame).
  const threadsRef = useRef<ConnectionThreadsHandle>(null);
  const handleDragMove = useCallback((id: string, dx: number, dy: number) => {
    threadsRef.current?.moveNode(id, dx, dy);
  }, []);

  const handleHoverStart = useCallback((id: string) => {
    if (!isDraggingCardRef.current) setHoveredThoughtId(id);
  }, []);

  const handleHoverEnd = useCallback(() => {
    if (!isDraggingCardRef.current) setHoveredThoughtId(null);
  }, []);

  const emberCycleIndexRef = useRef(0);

  const handleCycleEmbers = useCallback(() => {
    if (thoughts.length === 0) return;
    const targetIdx = emberCycleIndexRef.current % thoughts.length;
    emberCycleIndexRef.current = targetIdx + 1;
    const target = thoughts[targetIdx];
    if (!target) return;

    // Smoothly pan camera to center the target ember
    animate(panX, -target.x, { duration: 1.1, ease: [0.16, 1, 0.3, 1] });
    animate(panY, -target.y, { duration: 1.1, ease: [0.16, 1, 0.3, 1] });
    setScale(1.15); // Zoom to focus on the lantern

    // Highlight the target ember and its constellation threads
    setHoveredThoughtId(target.id);
    setTimeout(() => {
      setHoveredThoughtId(current => current === target.id ? null : current);
    }, 2800);
  }, [thoughts, panX, panY]);

  const pendingZoomRef = useRef(0);
  const zoomRafRef = useRef<number | null>(null);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const isPinch = e.ctrlKey || e.metaKey;
    
    let zoomDelta = 0;
    if (isPinch) {
      zoomDelta = -e.deltaY * 0.008;
    } else if (Math.abs(e.deltaY) > 0) {
      const direction = e.deltaY > 0 ? -1 : 1;
      const step = Math.min(Math.abs(e.deltaY) * 0.0015, 0.18);
      zoomDelta = direction * Math.max(step, 0.08);
    }

    if (zoomDelta !== 0) {
      pendingZoomRef.current += zoomDelta;
      if (zoomRafRef.current === null) {
        zoomRafRef.current = requestAnimationFrame(() => {
          setScale(current => {
            const next = Math.min(Math.max(current + pendingZoomRef.current, 0.25), 3.0);
            pendingZoomRef.current = 0;
            return Math.round(next * 100) / 100;
          });
          zoomRafRef.current = null;
        });
      }
    }
  }, []);

  const initialTouchDistRef = useRef<number | null>(null);
  const initialScaleRef = useRef<number>(1);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialTouchDistRef.current = Math.hypot(dx, dy);
      // scaleRef, not scale: depending on scale re-registered all the listeners on every zoom step.
      initialScaleRef.current = scaleRef.current;
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2 && initialTouchDistRef.current !== null) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / initialTouchDistRef.current;
      const nextScale = Math.min(Math.max(initialScaleRef.current * ratio, 0.25), 3.0);
      setScale(Math.round(nextScale * 100) / 100);
    }
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (e.touches.length < 2) {
      initialTouchDistRef.current = null;
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      // Clear the flag too: a cancelled frame left it set, and every later wheel event then
      // waited for a frame that never came (wheel zoom stopped working until a reload).
      if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
      zoomRafRef.current = null;
      pendingZoomRef.current = 0;
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd]);

  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 5000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (panToTarget) {
      animate(panX, -panToTarget.x, { 
        duration: 1.2, 
        ease: [0.16, 1, 0.3, 1],
        onComplete: () => {
          if (onPanComplete) onPanComplete();
        }
      });
      animate(panY, -panToTarget.y, { duration: 1.2, ease: [0.16, 1, 0.3, 1] });
      setScale(1.15); // zoom in slightly to focus the thought card
    }
  }, [panToTarget, onPanComplete, panX, panY]);

  // Panning lives on this full-screen root, not as framer `drag` on the canvas layer:
  // - the canvas layer moves/zooms with the view, so after panning or zooming out its box no
  //   longer covered the screen and presses outside it couldn't pan;
  // - framer's native listener on the canvas fired before a lantern's React stopPropagation,
  //   so grabbing a lantern often panned too (lantern moved double, threads slid off).
  // Lantern cards and reply chips stop React propagation, so this never runs for them.
  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'DIV' && target.className.includes('origin-center')) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const newRipple = { id: Date.now(), x: e.clientX - rect.left, y: e.clientY - rect.top };
        setRipples(prev => [...prev, newRipple]);
        setTimeout(() => setRipples(prev => prev.filter(r => r.id !== newRipple.id)), 2000);
      }
    }

    if (e.button !== 0 || tutorialStep === 'hud') return;
    if (target.closest('button, a, input, textarea, select, [role="dialog"], [data-no-pan]')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const startPanX = panX.get();
    const startPanY = panY.get();
    let panning = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!panning && Math.hypot(dx, dy) < 3) return;
      panning = true;
      panX.set(startPanX + dx);
      panY.set(startPanY + dy);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const centerPan = () => {
    animate(panX, 0, { duration: 0.8, ease: [0.16, 1, 0.3, 1] });
    animate(panY, 0, { duration: 0.8, ease: [0.16, 1, 0.3, 1] });
    setScale(1);
  };



  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      className="w-full h-[100dvh] relative overflow-hidden cursor-grab active:cursor-grabbing"
      style={{
        background: 'radial-gradient(ellipse at 50% 10%, #241611 0%, #120c09 60%, #080504 100%)',
        touchAction: 'none', // one-finger pan via pointer events (pinch zoom keeps its own touch handlers)
      }}
    >
      <style>{floatAnimationStyles}</style>

      {/* Static repeating stardust texture */}
      <div
        className="absolute inset-0 opacity-[0.25] mix-blend-overlay pointer-events-none"
        style={{ backgroundImage: `url('https://www.transparenttextures.com/patterns/stardust.png')` }}
      />

      {/* Twinkling Star Field with Parallax */}
      <motion.div
        className="absolute pointer-events-none"
        style={{
          x: bgX,
          y: bgY,
          left: '50%',
          top: '50%',
        }}
      >
        <StarCanvas />
      </motion.div>

      {/* Shooting Stars (Viewport relative) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="animate-shooting-star" style={{ top: '15%', left: '85%', '--duration': '14s', '--delay': '0s' } as React.CSSProperties} />
        <div className="animate-shooting-star" style={{ top: '30%', left: '70%', '--duration': '20s', '--delay': '5s' } as React.CSSProperties} />
        <div className="animate-shooting-star" style={{ top: '5%', left: '95%', '--duration': '25s', '--delay': '12s' } as React.CSSProperties} />
      </div>

      {/* Ripples Layer */}
      {ripples.map(r => (
        <motion.div
          key={r.id}
          className="absolute rounded-full border border-[rgba(214,106,62,0.4)] pointer-events-none z-10"
          style={{ left: r.x, top: r.y, x: '-50%', y: '-50%' }}
          initial={{ width: 0, height: 0, opacity: 0.8 }}
          animate={{ width: 300, height: 300, opacity: 0 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />
      ))}

      {/* Infinite canvas */}
      <motion.div
        className={[
          "absolute inset-0 origin-center flex items-center justify-center transition-[filter,opacity] duration-500",
          tutorialStep === 'hud' ? "blur-[3px] opacity-40 pointer-events-none" : ""
        ].join(" ")}
        style={{ x: panX, y: panY, scale }}
      >
        {/* Massive Flowing Nebulae Background - Gentle warm hearth tones */}
        <div className="absolute pointer-events-none w-[3000px] h-[3000px] flex items-center justify-center">
          {/* Nebula 1: Warm Amber / Ember Glow (Center-Right) */}
          <div
            className="absolute rounded-full pointer-events-none animate-nebula-1"
            style={{
              width: '1800px',
              height: '1800px',
              background: 'radial-gradient(circle, rgba(214,106,62,0.11) 0%, rgba(214,106,62,0.035) 45%, rgba(18,12,9,0) 75%)',
              left: '30%',
              top: '20%',
            }}
          />
          {/* Nebula 2: Deep Charcoal Dusk & Soft Violet (Center-Left) */}
          <div
            className="absolute rounded-full pointer-events-none animate-nebula-2"
            style={{
              width: '2000px',
              height: '2000px',
              background: 'radial-gradient(circle, rgba(64,44,72,0.08) 0%, rgba(32,20,38,0.02) 45%, rgba(18,12,9,0) 75%)',
              left: '-20%',
              top: '-10%',
            }}
          />
          {/* Nebula 3: Warm Honey Gold Hearth Dust (Bottom-Right) */}
          <div
            className="absolute rounded-full pointer-events-none animate-nebula-3"
            style={{
              width: '1600px',
              height: '1600px',
              background: 'radial-gradient(circle, rgba(245,185,85,0.07) 0%, rgba(214,106,62,0.02) 45%, rgba(18,12,9,0) 75%)',
              left: '40%',
              top: '50%',
            }}
          />
        </div>



        {/* Thoughts & Constellation Connection Threads */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
          <ConnectionThreads
            ref={threadsRef}
            thoughts={thoughts}
            hoveredThoughtId={hoveredThoughtId}
            selectedThoughtId={selectedThoughtId ?? null}
            focusEmotion={focusEmotion}
          />

          <AnimatePresence>
            {filteredThoughts.length === 0 && showEmptyState && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 1.5 } }}
                transition={{ delay: 0.5, duration: 1 }}
                className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" 
                style={{ width: 400, height: 200, left: -200, top: -100 }}
              >
                <Sparkles size={32} className="text-[#D66A3E] opacity-50 mb-4" />
                <p className="text-[#f9f3eb] text-[22px] text-center" style={{ fontFamily: "'Alegreya', serif", fontWeight: 700 }}>
                  Be the first light tonight.
                </p>
                <p className="text-[#8a7f79] text-[15px] mt-1.5 text-center" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                  The sky is quiet. Share a thought or whisper into the dark.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {filteredThoughts.length > 0 && filteredThoughts.map(thought => {
            const isThoughtDimmed = focusEmotion !== null && thought.emotion !== focusEmotion;
            const thoughtAgeMs = Date.now() - new Date(thought.timestamp).getTime();
            // "your lantern" badge: only on lanterns THIS browser released (it holds their owner
            // token). It used to go on every lantern younger than 45 s, so a friend's new lantern
            // showed as yours.
            const isThoughtNew = thoughtAgeMs < 45000 && !thought.isExample && !!getOwnerToken(thought.id);

            return (
              <ThoughtCard
                key={thought.id}
                thought={thought}
                getScale={getScale}
                onClick={onThoughtClick}
                onReplyClick={onReplyClick}
                onDragEnd={onThoughtMove}
                setIsDraggingCard={setIsDraggingCard}
                onDragMove={handleDragMove}
                isGlowing={thought.aiStatus === 'replying' || aiGlowThoughtId === thought.id || (thought.id === 'thought-tutorial-1' && tutorialStep === 'star')}
                isHovered={hoveredThoughtId === thought.id}
                dimmed={isThoughtDimmed}
                isNew={isThoughtNew}
                onHoverStart={handleHoverStart}
                onHoverEnd={handleHoverEnd}
                tutorialStep={tutorialStep}
              />
            );
          })}
        </div>
      </motion.div>

      {/* Top Left Logo */}
      <div
        className={[
          "absolute top-[-5px] left-2 sm:top-[-10px] sm:left-6 z-30 flex items-center pointer-events-auto select-none transition-all duration-300",
          (tutorialStep === 'hud' || tutorialStep === 'star') ? "blur-[2px] opacity-40 pointer-events-none" : ""
        ].join(" ")}
      >
        <img
          src="https://i.imgur.com/5nagvWz.png"
          alt="ember.ai logo"
          onDoubleClick={handleLogoDoubleClick}
          className="h-14 sm:h-20 w-auto object-contain relative z-10 drop-shadow-[0_0_20px_rgba(214,106,62,0.25)] cursor-pointer"
        />
      </div>

      {/* Top Right History Button */}
      <div
        className={[
          "absolute top-3 right-4 sm:top-8 sm:right-10 z-30 pointer-events-auto transition-all duration-300",
          (tutorialStep === 'hud' || tutorialStep === 'star') ? "blur-[2px] opacity-40 pointer-events-none" : ""
        ].join(" ")}
      >
        <motion.button
          onClick={onHistoryClick}
          className="relative bg-[rgba(20,15,25,0.7)] backdrop-blur-md border border-[rgba(255,255,255,0.1)] text-[#f9f3eb] rounded-full px-3 h-[36px] sm:px-5 sm:h-[40px] flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D66A3E]"
          whileHover={{
            scale: 1.05,
            boxShadow: '0 0 20px rgba(214,106,62,0.4)',
            borderColor: 'rgba(214,106,62,0.5)',
            backgroundColor: 'rgba(214,106,62,0.08)'
          }}
          whileTap={{ scale: 0.95 }}
          aria-label="View History"
        >
          <span className="text-[11px] sm:text-[13px] font-bold tracking-wide" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>HISTORY</span>
          {hasUnreadHistory && (
            <span className="w-2 h-2 rounded-full bg-[#D66A3E] shadow-[0_0_8px_#D66A3E] animate-pulse" />
          )}
        </motion.button>
      </div>

      {/* Top Centered Instruction — hidden on mobile to avoid overlap */}
      <div
        className={[
          "absolute top-8 left-1/2 -translate-x-1/2 z-30 pointer-events-none text-center w-[90%] max-w-[600px] transition-all duration-300 hidden sm:block",
          (tutorialStep === 'hud' || tutorialStep === 'star') ? "blur-[2px] opacity-40 pointer-events-none" : ""
        ].join(" ")}
      >
        <p className="text-[#f9f3eb]/95 text-[17px] pointer-events-auto tracking-wide font-normal leading-relaxed italic" style={{ fontFamily: "'Alegreya', serif", textShadow: '0 2px 10px rgba(0,0,0,0.9)' }}>
          "Share your thoughts anonymously. Watch them drift and connect as glowing lanterns in the night sky."
        </p>
      </div>

      {/* Gesture hint */}
      <AnimatePresence>
        {showHint && tutorialStep === 'none' && (
          <motion.div
            className="absolute left-1/2 -translate-x-1/2 bottom-[88px] sm:bottom-[104px] pointer-events-none z-30 whitespace-nowrap bg-[rgba(0,0,0,0.7)] px-4 py-1.5 rounded-full border border-[rgba(255,255,255,0.1)]"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.8 }}
          >
            <span className="text-[13px] text-[#bda89f] tracking-wide" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
              scroll to explore · drag to move
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating HUD Dock */}
      <div
        className={[
          "absolute left-1/2 -translate-x-1/2 bottom-4 sm:bottom-8 flex items-center justify-center pointer-events-none z-30 transition-all duration-300 w-[calc(100%-2rem)] sm:w-auto",
          tutorialStep === 'star' ? "blur-[2px] opacity-40 pointer-events-none" : ""
        ].join(" ")}
      >
        <motion.div
          className="pointer-events-auto flex items-center gap-1.5 sm:gap-4 bg-[rgba(20,15,25,0.85)] backdrop-blur-md rounded-full h-[52px] sm:h-[60px] px-3 sm:px-6 border border-[rgba(255,255,255,0.1)] transition-all duration-300 w-full sm:w-auto justify-between sm:justify-start overflow-x-auto scrollbar-hide"
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.05)' }}
          whileHover={{
            boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 25px rgba(214,106,62,0.15), inset 0 1px 1px rgba(255,255,255,0.1)',
            borderColor: 'rgba(214,106,62,0.3)'
          }}
        >
          {/* Procedural Lantern Audio Toggle */}
          <motion.button
            onClick={toggleSound}
            className={`w-[36px] h-[36px] sm:w-[40px] sm:h-[40px] rounded-full border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D66A3E] flex-shrink-0 cursor-pointer ${
              soundEnabled
                ? 'bg-[rgba(214,106,62,0.15)] border-[rgba(214,106,62,0.4)] text-[#D66A3E]'
                : 'bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-[#a89992] hover:text-[#f9f3eb] hover:bg-[rgba(255,255,255,0.1)]'
            }`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            aria-label="Toggle Lantern Audio"
            title={soundEnabled ? "Procedural lantern audio enabled" : "Audio muted (click to enable)"}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </motion.button>

          {/* About Button */}
          <motion.button
            onClick={() => setShowAboutModal(true)}
            className="w-[36px] h-[36px] sm:w-[40px] sm:h-[40px] rounded-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] flex items-center justify-center text-[#a89992] hover:text-[#f9f3eb] hover:bg-[rgba(255,255,255,0.1)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D66A3E] flex-shrink-0 cursor-pointer"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            aria-label="About ember.ai"
          >
            <Info size={16} />
          </motion.button>
          
          <div className="w-[1px] h-6 sm:h-8 bg-white/10 mx-1 flex-shrink-0" />

          {/* Emotion Constellation Filters */}
          <div className="hidden md:flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            <motion.button
              onClick={() => setFocusEmotion(null)}
              className="font-medium text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D66A3E] rounded px-2 py-0.5 cursor-pointer transition-all whitespace-nowrap flex-shrink-0"
              style={{
                color: focusEmotion === null ? '#f9f3eb' : '#a89992',
                textShadow: focusEmotion === null ? '0 0 10px rgba(249,243,235,0.6)' : 'none',
              }}
              whileHover={{ scale: 1.05, color: '#f9f3eb' }}
              whileTap={{ scale: 0.95 }}
            >
              All
            </motion.button>
            <div className="w-[1px] h-4 bg-white/10 flex-shrink-0" />
            {EMOTION_CHIPS.map(chip => {
              const isSelected = focusEmotion === chip.key;
              return (
                <motion.button
                  key={chip.key}
                  onClick={() => setFocusEmotion(current => current === chip.key ? null : chip.key)}
                  className="flex items-center gap-1.5 font-medium text-xs rounded-full px-2.5 py-1 cursor-pointer transition-all whitespace-nowrap flex-shrink-0 border"
                  style={{
                    color: isSelected ? '#ffffff' : '#bda89f',
                    backgroundColor: isSelected ? `${chip.color}25` : 'rgba(255,255,255,0.02)',
                    borderColor: isSelected ? chip.color : 'rgba(255,255,255,0.08)',
                    boxShadow: isSelected ? `0 0 12px ${chip.color}50` : 'none',
                  }}
                  whileHover={{
                    scale: 1.05,
                    color: '#ffffff',
                    borderColor: chip.color,
                    boxShadow: `0 0 10px ${chip.color}40`,
                  }}
                  whileTap={{ scale: 0.95 }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: chip.color,
                      boxShadow: isSelected ? `0 0 8px ${chip.color}` : 'none',
                    }}
                  />
                  <span>{chip.label}</span>
                </motion.button>
              );
            })}
          </div>

          <div className="hidden md:block w-[1px] h-8 bg-white/10 mx-2 flex-shrink-0" />

          {/* Main share action */}
          <motion.button
            className="bg-[rgba(214,106,62,0.15)] border border-[rgba(214,106,62,0.3)] text-[#D66A3E] rounded-full px-4 sm:px-5 h-[38px] sm:h-[40px] flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D66A3E] flex-shrink-0 whitespace-nowrap"
            whileHover={{ backgroundColor: 'rgba(214,106,62,0.25)', scale: 1.05, boxShadow: '0 0 20px rgba(214,106,62,0.6)', borderColor: 'rgba(214,106,62,0.6)' }}
            whileTap={{ scale: 0.95 }}
            onClick={onInputClick}
            aria-label="Share a thought"
          >
            <Sparkles size={15} className="flex-shrink-0" />
            <span className="text-[13px] sm:text-sm font-medium whitespace-nowrap">Share</span>
          </motion.button>

          <div className="w-[1px] h-8 bg-white/10 mx-1 sm:mx-2 flex-shrink-0" />

          {/* Zoom controls */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0">
            <motion.button
              onClick={() => setScale(s => Math.max(0.25, Math.round((s - 0.2) * 10) / 10))}
              className="text-[#a89992] hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white rounded p-1 flex-shrink-0 cursor-pointer"
              aria-label="Zoom out"
              title="Zoom out (20%)"
              whileHover={{ scale: 1.2, color: '#f9f3eb', filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.6))' }}
              whileTap={{ scale: 0.9 }}
            ><ZoomOut size={16} /></motion.button>
            <motion.button
              onClick={centerPan}
              className="text-[#a89992] text-xs w-10 text-center hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white rounded py-0.5 flex-shrink-0 whitespace-nowrap cursor-pointer"
              title="Click to reset camera to center (100%)"
              whileHover={{ scale: 1.1, color: '#f9f3eb', textShadow: '0 0 8px rgba(255,255,255,0.6)' }}
              whileTap={{ scale: 0.95 }}
            >{Math.round(scale * 100)}%</motion.button>
            <motion.button
              onClick={() => setScale(s => Math.min(3.0, Math.round((s + 0.2) * 10) / 10))}
              className="text-[#a89992] hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white rounded p-1 flex-shrink-0 cursor-pointer"
              aria-label="Zoom in"
              title="Zoom in (20%)"
              whileHover={{ scale: 1.2, color: '#f9f3eb', filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.6))' }}
              whileTap={{ scale: 0.9 }}
            ><ZoomIn size={16} /></motion.button>
          </div>

          <div className="w-[1px] h-8 bg-white/10 mx-1 sm:mx-2 flex-shrink-0" />

          {/* Aura Indicator */}
          <div className="flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
            <motion.div
              className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#D66A3E] flex-shrink-0"
              style={{ boxShadow: '0 0 8px #D66A3E' }}
              animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="text-[#e2d9d1] text-[12px] sm:text-[13px] font-medium whitespace-nowrap">
              <span className="hidden sm:inline">{voiceCount} online</span>
              <span className="sm:hidden">{voiceCount}</span>
            </span>
          </div>

          <div className="w-[1px] h-6 bg-white/10 mx-1 flex-shrink-0" />

          {/* Embers Count Button - Click to travel/cycle camera to each ember */}
          <motion.button
            onClick={handleCycleEmbers}
            className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0 whitespace-nowrap cursor-pointer rounded-full px-2 sm:px-2.5 py-1 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D66A3E] hover:bg-[rgba(214,106,62,0.18)] hover:border-[rgba(214,106,62,0.35)] border border-transparent"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title={thoughts.length > 0 ? "Click to fly camera to each ember in the sky" : "No embers in the sky yet"}
            aria-label="Cycle camera to next lantern"
          >
            <motion.span
              className="text-[#D66A3E] text-[11px] sm:text-[13px] leading-none select-none"
              animate={{ rotate: [0, 15, -15, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              ✦
            </motion.span>
            <span className="text-[#e2d9d1] text-[12px] sm:text-[13px] font-medium whitespace-nowrap">
              <span className="hidden sm:inline">{thoughts.length} {thoughts.length === 1 ? 'ember' : 'embers'}</span>
              <span className="sm:hidden">{thoughts.length}</span>
            </span>
          </motion.button>
        </motion.div>
      </div>

      {/* HUD Tutorial Tooltip Overlay */}
      {tutorialStep === 'hud' && setTutorialStep && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[88px] sm:bottom-[104px] z-50 pointer-events-auto">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[rgba(20,15,25,0.95)] backdrop-blur-xl border border-[rgba(214,106,62,0.4)] rounded-[20px] px-5 py-4 text-center max-w-[340px] shadow-[0_12px_40px_rgba(0,0,0,0.6),_0_0_20px_rgba(214,106,62,0.15)] flex flex-col items-center"
          >
            <p className="text-[#f9f3eb] text-[15px] font-medium leading-relaxed" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
              This is your Hearth control dock. Filter thoughts by mood, zoom the sky, or share an anonymous whisper.
            </p>
            <motion.button
              onClick={() => {
                setTutorialStep('star');
                if (onTriggerPanToStar) onTriggerPanToStar();
              }}
              className="mt-3 px-5 py-1.5 bg-[#D66A3E] text-white rounded-full text-xs font-bold shadow-[0_0_10px_rgba(214,106,62,0.3)] cursor-pointer"
              whileHover={{ scale: 1.05, backgroundColor: '#bd5e37' }}
              whileTap={{ scale: 0.95 }}
            >
              Continue
            </motion.button>
          </motion.div>
        </div>
      )}



      {/* About Ember Modal */}
      <AnimatePresence>
        {showAboutModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="absolute inset-0 bg-[rgba(5,3,8,0.75)] backdrop-blur-sm" onClick={() => setShowAboutModal(false)} />
            
            <motion.div
              className="relative w-full max-w-[440px] bg-[rgba(255,255,255,0.03)] backdrop-blur-3xl border border-[rgba(255,255,255,0.15)] shadow-[0_20px_60px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.1)] rounded-[28px] p-6 flex flex-col items-center text-center overflow-hidden"
              initial={{ y: 20, scale: 0.95 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 20, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Top Close Button */}
              <button
                onClick={() => setShowAboutModal(false)}
                className="absolute top-4 right-4 w-[28px] h-[28px] rounded-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.15)] cursor-pointer"
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1L11 11M11 1L1 11" stroke="#f9f3eb" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>

              <div className="w-12 h-12 rounded-full bg-[rgba(214,106,62,0.1)] border border-[rgba(214,106,62,0.2)] flex items-center justify-center text-[#D66A3E] mb-4 mt-2">
                <Info size={24} />
              </div>

              <h3 className="text-[#f9f3eb] text-[22px] font-bold tracking-wide mb-3" style={{ fontFamily: "'Alegreya', serif" }}>
                About ember.ai
              </h3>

              <p className="text-[#e2d9d1] text-[15px] leading-relaxed mb-6 opacity-90" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                ember.ai is an anonymous emotional sanctuary for those moments when feelings are hard to put into words. It provides a peaceful night sky where you can release your thoughts as glowing lanterns, connect with others through voice, drawing, or stickers, and know that you are never screaming into a silent void.
              </p>

              <div className="w-full h-[1px] bg-white/10 mb-5" />

              <p className="text-[#8a7f79] text-[12px] font-medium tracking-wider uppercase" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                Developed by Alen Joby
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
