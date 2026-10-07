import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Feather, Mic, Brush, Sparkles, Loader2, Heart,
  Leaf, Trash2, Shield, Download, Check
} from 'lucide-react';
import type { Thought, ThoughtResponse } from '../App';
import { ScreenGlow } from './ScreenGlow';
import { StickerIcon as BaseStickerIcon } from './StickerIcon';
import { detectNegativity, getVoiceReminder } from '../safeSpace';
import { SafeSpaceGuard, SafeSpaceInline } from './SafeSpaceGuard';
import { SendingStatus } from './SendingStatus';
import { getOwnerToken } from '../api';
import { AiLabel } from './AiLabel';
import { CrisisCard } from './CrisisCard';
import { useLanternSound } from './useLanternSound';

interface Props {
  thought: Thought;
  allThoughts?: Thought[];
  onClose: () => void;  
  onAddResponse: (response: Omit<ThoughtResponse, 'id' | 'timestamp'>) => Promise<void> | void;
  onOpenDraw: () => void;
  onDeleteThought?: (id: string) => void;
  onDeleteReply?: (thoughtId: string, replyId: string) => void;
  onThankReply?: (thoughtId: string, reply: ThoughtResponse) => Promise<boolean> | void;
  tutorialStep?: 'none' | 'hud' | 'star' | 'reply' | 'complete';
}

type ResponseMode = 'note' | 'voice' | 'draw' | 'sticker';

const STICKERS = [
  { icon: 'sticker_heart', label: 'Heart' },
  { icon: 'sticker_sparkle', label: 'Sparkle' },
  { icon: 'sticker_moon', label: 'Moon' },
  { icon: 'sticker_star', label: 'Star' },
  { icon: 'sticker_leaf', label: 'Leaf' },
  { icon: 'sticker_hand', label: 'Hand' },
  { icon: 'sticker_hug', label: 'Hug' },
  { icon: 'sticker_candle', label: 'Candle' },
  { icon: 'sticker_shell', label: 'Shell' },
  { icon: 'sticker_drop', label: 'Drop' },
  { icon: 'sticker_cloud', label: 'Cloud' },
  { icon: 'sticker_flower', label: 'Flower' },
  { icon: 'sticker_sun', label: 'Sun' },
  { icon: 'sticker_note', label: 'Note' },
  { icon: 'sticker_globe', label: 'Globe' }
];

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

function StickerIcon({ nameOrEmoji, size = 24, className }: { nameOrEmoji: string; size?: number; className?: string }) {
  const iconName = EMOJI_TO_ICON[nameOrEmoji] || nameOrEmoji;
  return <BaseStickerIcon name={iconName} size={size} className={className} />;
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function NoteTab({ onSend }: { onSend: (text: string) => Promise<void> | void }) {
  const [text, setText] = useState('');
  const [showGuard, setShowGuard] = useState(false);
  const [guardMessage, setGuardMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Real-time negativity detection as user types
  const safeCheck = useMemo(() => detectNegativity(text), [text]);

  const handleSend = async () => {
    if (!text.trim() || isSending) return;
    const result = detectNegativity(text);
    if (!result.allowed) {
      setGuardMessage(result.reason);
      setShowGuard(true);
      return;
    }
    setIsSending(true);
    try {
      await onSend(text.trim());
      setText('');
    } catch (err) {
      console.warn("Could not send note, preserving text:", err);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="relative flex flex-col gap-2.5">
      <div className="relative bg-white/[0.03] border border-white/[0.08] focus-within:border-[#D66A3E]/60 focus-within:ring-2 focus-within:ring-[#D66A3E]/15 rounded-[22px] p-3.5 transition-all duration-200">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Whisper something gentle... (Enter to send)"
          maxLength={240}
          readOnly={isSending}
          className="w-full bg-transparent resize-none outline-none text-[#fcf8f2] placeholder-[#8a7f79]/70 text-[15px] leading-[1.55] transition-all"
          style={{ fontFamily: "'Alegreya Sans', sans-serif", fontWeight: 400, minHeight: 74 }}
        />
        
        {/* Real-time inline SafeSpace warning */}
        <AnimatePresence>
          {!safeCheck.allowed && text.trim() && (
            <div className="mb-2">
              <SafeSpaceInline severity={safeCheck.severity} message={safeCheck.reason} />
            </div>
          )}
        </AnimatePresence>

        <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
          <span
            className="text-[#8a7f79]/80 text-[11px] font-medium"
            style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
          >
            {text.length} / 240
          </span>
          <motion.button
            onClick={handleSend}
            disabled={!text.trim() || !safeCheck.allowed || isSending}
            className={[
              'px-5 h-[36px] rounded-[14px] text-[13px] font-bold transition-all duration-200 flex items-center gap-1.5 justify-center',
              text.trim() && safeCheck.allowed
                ? 'bg-gradient-to-r from-[#D66A3E] to-[#F28A4B] text-[#fffcf9] shadow-[0_0_15px_rgba(214,106,62,0.4)] cursor-pointer hover:brightness-110 active:scale-95'
                : 'bg-white/[0.05] text-[#8a7f79]/50 cursor-not-allowed border border-white/[0.05]'
            ].join(' ')}
            style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
            whileHover={text.trim() && safeCheck.allowed ? { scale: 1.03 } : {}}
            whileTap={text.trim() && safeCheck.allowed ? { scale: 0.96 } : {}}
          >
            {isSending ? (
              <>
                <Loader2 size={13} className="animate-spin text-white" />
                <span>Sending…</span>
              </>
            ) : !safeCheck.allowed && text.trim() ? (
              <>
                <Shield size={13} />
                <span>Blocked</span>
              </>
            ) : (
              <span>Send whisper</span>
            )}
          </motion.button>
        </div>
      </div>

      {isSending && <SendingStatus steps={['Reading it gently…', 'Sending your words…', 'Almost there…']} />}

      {/* Fullscreen SafeSpace Guard overlay */}
      <SafeSpaceGuard
        visible={showGuard}
        severity={safeCheck.severity}
        message={guardMessage}
        onDismiss={() => setShowGuard(false)}
      />
    </div>
  );
}

type VoiceState = 'idle' | 'recording' | 'recorded';
type Severity = 'mild' | 'severe';

const MAX_VOICE_SECONDS = 60; // server limit (and 2 MB)

function VoiceTab({ onSend }: { onSend: (text: string, url: string, durationSec: number) => Promise<void> | void }) {
  const [loading, setLoading] = useState(false);
  const [showGuard, setShowGuard] = useState(false);
  const [guardMessage, setGuardMessage] = useState('');
  const [guardSeverity, setGuardSeverity] = useState<Severity>('severe');

  const [recordState, setRecordState] = useState<VoiceState>('idle');
  const [duration, setDuration] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string>('');

  useEffect(() => {
    if (recordState === 'recording') {
      intervalRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [recordState]);

  useEffect(() => {
    if (recordState === 'recording' && duration >= MAX_VOICE_SECONDS) stopRecording();
  }, [duration, recordState]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const mime = (mediaRecorder.mimeType || 'audio/webm').split(';')[0];
        const audioBlob = new Blob(audioChunksRef.current, { type: mime });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          setRecordedAudioUrl(base64Audio);
          setRecordState('recorded');
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setRecordState('recording');
      setDuration(0);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      alert('Could not access microphone. Please check permissions.');
      setRecordState('idle');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleSendRecorded = async () => {
    if (!recordedAudioUrl) return;
    
    setLoading(true);
    try {
      const finalTranscript = `Voice message (${formatTime(duration)})`;
      await onSend(finalTranscript, recordedAudioUrl, Math.max(1, duration));
      setRecordState('idle');
      setDuration(0);
      setRecordedAudioUrl('');
    } catch (err) {
      console.error('Audio send error:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative bg-white/[0.03] border border-white/[0.08] rounded-[22px] p-4 flex flex-col items-center text-center">
        <p
          className="text-[#fcf8f2] text-[14px] font-bold mb-0.5"
          style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
        >
          {recordState === 'idle'
            ? 'Whisper with your voice'
            : recordState === 'recording'
            ? 'Listening... speak gently'
            : 'Voice whisper ready'}
        </p>
        <p
          className="text-[#8a7f79] text-[11.5px] mb-2.5"
          style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
        >
          {recordState === 'idle'
            ? 'When words on a screen aren\'t enough'
            : recordState === 'recording'
            ? 'Recording up to 60 seconds'
            : `Recorded (${formatTime(duration)})`}
        </p>

        {/* SafeSpace voice reminder */}
        <div
          className="rounded-[10px] px-3 py-1 mb-2 flex items-center gap-2 max-w-xs"
          style={{ background: 'rgba(214,165,62,0.06)', border: '1px solid rgba(214,165,62,0.12)' }}
        >
          <Shield size={12} className="text-[#d6a53e] flex-shrink-0" />
          <span
            className="text-[11px] text-[#d6a53e] leading-[1.3]"
            style={{ fontFamily: "'Alegreya Sans', sans-serif", fontWeight: 500 }}
          >
            {getVoiceReminder()}
          </span>
        </div>

        {/* Pulsing Voice Orb */}
        <div className="relative w-[64px] h-[64px] flex items-center justify-center my-1.5">
          {recordState === 'recording' && (
            <motion.div
              className="absolute inset-0 rounded-full bg-[#D66A3E]/20 border border-[#D66A3E]/50"
              animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0.1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          <button
            onClick={recordState === 'idle' ? startRecording : recordState === 'recording' ? stopRecording : undefined}
            className={[
              'relative z-10 w-[52px] h-[52px] rounded-full flex items-center justify-center transition-all cursor-pointer shadow-lg',
              recordState === 'recording'
                ? 'bg-gradient-to-tr from-[#D66A3E] to-[#F28A4B] text-white shadow-[0_0_20px_rgba(214,106,62,0.6)]'
                : recordState === 'recorded'
                ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                : 'bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-amber-200/80 hover:text-white'
            ].join(' ')}
          >
            {recordState === 'recording' ? (
              <div className="w-3.5 h-3.5 rounded-sm bg-white" />
            ) : recordState === 'recorded' ? (
              <Mic size={20} className="text-emerald-300" />
            ) : (
              <Mic size={20} className="text-[#D66A3E]" />
            )}
          </button>
        </div>

        {recordState !== 'idle' && (
          <span
            className="text-[#D66A3E] text-[12px] font-bold tracking-wider mb-2"
            style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
          >
            {formatTime(duration)}
          </span>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2.5 mt-1.5">
          {recordState === 'idle' && (
            <button
              onClick={startRecording}
              className="px-5 h-[34px] rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-white text-[12px] font-bold tracking-wide transition-all cursor-pointer"
              style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
            >
              Start Recording
            </button>
          )}
          {recordState === 'recording' && (
            <button
              onClick={stopRecording}
              className="px-5 h-[34px] rounded-full bg-[#D66A3E] text-white text-[12px] font-bold tracking-wide transition-all cursor-pointer shadow-[0_0_12px_rgba(214,106,62,0.5)]"
              style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
            >
              Finish Note
            </button>
          )}
          {recordState === 'recorded' && (
            <>
              <button
                onClick={() => { setRecordState('idle'); setDuration(0); setRecordedAudioUrl(''); }}
                disabled={loading}
                className="disabled:opacity-40 disabled:cursor-not-allowed px-4 h-[34px] rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-white/70 text-[12px] transition-all cursor-pointer"
                style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
              >
                Re-record
              </button>
              <motion.button
                onClick={handleSendRecorded}
                disabled={loading}
                className="px-5 h-[34px] rounded-full bg-gradient-to-r from-[#D66A3E] to-[#F28A4B] text-white text-[12px] font-bold shadow-[0_0_15px_rgba(214,106,62,0.4)] cursor-pointer flex items-center gap-1.5"
                style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
              >
                {loading ? <><Loader2 size={13} className="animate-spin" /> Sending…</> : 'Send voice'}
              </motion.button>
            </>
          )}
        </div>
        {loading && (
          <SendingStatus
            className="mt-3"
            steps={['Listening to your voice…', 'Making sure it feels safe…', 'Almost there…']}
          />
        )}
      </div>

      <SafeSpaceGuard
        visible={showGuard}
        severity={guardSeverity}
        message={guardMessage}
        onDismiss={() => setShowGuard(false)}
      />
    </div>
  );
}

function StickerTab({ onSend }: { onSend: (iconName: string) => void }) {
  return (
    <div className="max-w-full overflow-x-hidden">
      <p
        className="text-[#8a7f79] text-[12px] mb-3 text-center"
        style={{ fontFamily: "'Alegreya Sans', sans-serif", fontWeight: 400 }}
      >
        Tap to send warmth anonymously
      </p>
      <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {STICKERS.map(s => (
          <motion.button
            key={s.icon}
            onClick={() => onSend(s.icon)}
            className="bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-amber-500/40 rounded-[14px] h-[54px] sm:h-[62px] flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors"
            whileHover={{ scale: 1.06, boxShadow: '0 0 15px rgba(214,106,62,0.2)' }}
            whileTap={{ scale: 0.94 }}
            transition={{ duration: 0.14 }}
          >
            <StickerIcon nameOrEmoji={s.icon} size={22} />
            <span
              className="text-[#8a7f79] text-[10px]"
              style={{ fontFamily: "'Alegreya Sans', sans-serif", fontWeight: 500 }}
            >
              {s.label}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function VoicePlayer({
  response,
  isAI,
  timeStr,
  thought,
  onDeleteReply,
  onThankReply,
}: {
  response: ThoughtResponse;
  isAI?: boolean;
  timeStr: string;
  thought: Thought;
  onDeleteReply?: (id: string) => void;
  onThankReply?: (thoughtId: string, reply: ThoughtResponse) => Promise<boolean> | void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isThanked, setIsThanked] = useState(() => {
    try {
      const thanked = JSON.parse(localStorage.getItem('ember_thanked_replies') || '[]');
      return !!response.thanked || (Array.isArray(thanked) && thanked.includes(response.id));
    } catch {
      return !!response.thanked;
    }
  });
  const [showThanks, setShowThanks] = useState(false);
  useEffect(() => { if (response.thanked) setIsThanked(true); }, [response.thanked]);
  // Only the lantern's author can thank (the server checks too), and not their own replies.
  const canThank = !!getOwnerToken(thought.id) && !(response.authorId && response.authorId === thought.authorId);

  const handleThank = async () => {
    if (isThanked || !canThank) return;
    setIsThanked(true);
    setShowThanks(true);
    setTimeout(() => setShowThanks(false), 2000);
    const ok = onThankReply ? await onThankReply(thought.id, response) : true;
    if (ok === false) {
      setIsThanked(false); // not sent: let them try again
      return;
    }
    try {
      const raw = localStorage.getItem('ember_thanked_replies');
      const list = raw ? JSON.parse(raw) : [];
      if (!list.includes(response.id)) {
        list.push(response.id);
        localStorage.setItem('ember_thanked_replies', JSON.stringify(list));
      }
    } catch {}
  };

  const togglePlay = () => {
    if (!response.audioUrl) return;
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      if (!audioRef.current) {
        audioRef.current = new Audio(response.audioUrl);
        audioRef.current.onended = () => {
          setIsPlaying(false);
        };
      }
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(e => console.error("Error playing audio:", e));
    }
  };

  return (
    <>
      {isAI && <ScreenGlow isPlaying={isPlaying} />}
      <div 
        className={[
          'rounded-[18px] px-4.5 py-4 flex flex-col gap-3 transition-all duration-300',
          isAI 
            ? 'bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.03] border border-amber-500/25 shadow-[0_4px_25px_rgba(214,106,62,0.08),inset_0_1px_0_rgba(255,255,255,0.06)]' 
            : 'bg-white/[0.025] hover:bg-white/[0.04] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]'
        ].join(' ')}
      >
        {/* Transcript text on top */}
        <p 
          className="text-[#fcf8f2] text-[14.5px] leading-[1.6] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
          style={{ fontFamily: "'Alegreya Sans', sans-serif", fontWeight: 400 }}
        >
          {response.content}
        </p>

        {/* Player controls row */}
        <div className="flex items-center gap-3 bg-black/25 rounded-[14px] px-3.5 py-2.5 border border-white/[0.03]">
          <button 
            onClick={togglePlay}
            className="w-[34px] h-[34px] rounded-full bg-gradient-to-tr from-[#D66A3E] to-[#F28A4B] text-white flex items-center justify-center hover:brightness-110 transition-all duration-200 cursor-pointer shadow-[0_0_12px_rgba(214,106,62,0.4)] flex-shrink-0"
            aria-label={isPlaying ? "Pause voice message" : "Play voice message"}
          >
            {isPlaying ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="2" y="1" width="2" height="8" rx="0.5" fill="white" />
                <rect x="6" y="1" width="2" height="8" rx="0.5" fill="white" />
              </svg>
            ) : (
              <svg width="10" height="12" viewBox="0 0 12 14" fill="none" className="ml-0.5">
                <path d="M2 1L10 7L2 13V1Z" fill="white" />
              </svg>
            )}
          </button>

          {/* Waveform container with glowing bars */}
          <div className="flex items-end gap-[3px] h-[22px] flex-1 min-w-0 px-1 select-none">
            {Array.from({ length: 30 }, (_, i) => {
              const h = 4 + (Math.sin(i * 0.4) * 8) + ((i * 3) % 6);
              return (
                <motion.div
                  key={i}
                  className={[
                    'w-[3px] rounded-full',
                    isAI ? 'bg-[#D66A3E]' : 'bg-white/40'
                  ].join(' ')}
                  style={{ minHeight: '4px' }}
                  animate={isPlaying ? {
                    height: [h, Math.max(3, h * 0.25), h * 1.35, h],
                    opacity: [0.85, 0.4, 1, 0.85],
                    boxShadow: isAI 
                      ? ['0 0 0px transparent', '0 0 8px rgba(214,106,62,0.6)', '0 0 0px transparent']
                      : ['0 0 0px transparent', '0 0 4px rgba(255,255,255,0.4)', '0 0 0px transparent']
                  } : { height: h, opacity: 0.65 }}
                  transition={isPlaying ? {
                    duration: 0.9,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.025,
                  } : { duration: 0.2 }}
                />
              );
            })}
          </div>
        </div>

        {/* Footer row */}
        <div className="flex items-center justify-between text-[11px] text-[#8a7f79] relative">
          <span className="flex items-center gap-1 font-bold" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
            {isAI ? (
              <AiLabel />
            ) : (
              'someone'
            )}
          </span>
          <div className="flex items-center gap-2.5">
            {localStorage.getItem('ember_admin') === 'true' && onDeleteReply && (
              <button
                onClick={() => onDeleteReply(response.id)}
                className="text-red-400 hover:text-red-300 transition-colors focus:outline-none cursor-pointer p-0.5"
                title="Delete voice message"
              >
                <Trash2 size={12} />
              </button>
            )}
            <span style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
              {timeStr}
            </span>
            {!isAI && (canThank || isThanked) && (
              <button
                onClick={handleThank}
                disabled={isThanked}
                className="flex items-center gap-1 text-[#D66A3E] hover:text-[#bd5e37] transition-colors focus:outline-none cursor-pointer p-0.5"
                title={isThanked ? (canThank ? "Thanked" : "The author thanked this reply") : "Send thanks"}
              >
                <Heart size={12} fill={isThanked || showThanks ? "#D66A3E" : "none"} />
              </button>
            )}
          </div>
          {/* Floating Heart Animation */}
          <AnimatePresence>
            {showThanks && (
              <motion.div
                initial={{ opacity: 0, y: 0, scale: 0.5 }}
                animate={{ opacity: [0, 1, 0], y: -26, scale: 1.4 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1 }}
                className="absolute right-0 bottom-4 pointer-events-none text-[#D66A3E]"
              >
                <Heart size={15} fill="#D66A3E" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

function ResponseItem({
  response,
  index,
  thought,
  onDeleteReply,
  onThankReply,
}: {
  response: ThoughtResponse;
  index: number;
  thought: Thought;
  onDeleteReply?: (replyId: string) => void;
  onThankReply?: (thoughtId: string, reply: ThoughtResponse) => Promise<boolean> | void;
}) {
  const timeStr = relativeTime(response.timestamp);
  const isAI = response.isAI;
  const [isThanked, setIsThanked] = useState(() => {
    try {
      const thanked = JSON.parse(localStorage.getItem('ember_thanked_replies') || '[]');
      return !!response.thanked || (Array.isArray(thanked) && thanked.includes(response.id));
    } catch {
      return !!response.thanked;
    }
  });
  const [showThanks, setShowThanks] = useState(false);
  useEffect(() => { if (response.thanked) setIsThanked(true); }, [response.thanked]);
  // Only the lantern's author can thank (the server checks too), and not their own replies.
  const canThank = !!getOwnerToken(thought.id) && !(response.authorId && response.authorId === thought.authorId);

  const handleThank = async () => {
    if (isThanked || !canThank) return;
    setIsThanked(true);
    setShowThanks(true);
    setTimeout(() => setShowThanks(false), 2000);
    const ok = onThankReply ? await onThankReply(thought.id, response) : true;
    if (ok === false) {
      setIsThanked(false); // not sent: let them try again
      return;
    }
    try {
      const raw = localStorage.getItem('ember_thanked_replies');
      const list = raw ? JSON.parse(raw) : [];
      if (!list.includes(response.id)) {
        list.push(response.id);
        localStorage.setItem('ember_thanked_replies', JSON.stringify(list));
      }
    } catch {}
  };

  const wrapper = (children: React.ReactNode) => (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );

  if (response.type === 'sticker') {
    return wrapper(
      <div className="flex items-center gap-3.5 bg-white/[0.02] border border-white/[0.05] rounded-[18px] p-3 px-4">
        <div className="bg-white/[0.05] border border-white/[0.08] rounded-[14px] w-[46px] h-[46px] flex items-center justify-center shadow-md flex-shrink-0">
          <StickerIcon nameOrEmoji={response.content} size={26} className="drop-shadow-md" />
        </div>
        <div className="flex items-center justify-between w-full relative min-w-0">
          <span
            className="text-[#8a7f79] text-[12px] flex items-center gap-1.5 truncate"
            style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
          >
            {isAI ? <AiLabel /> : 'someone'} sent a sticker · {timeStr}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            {localStorage.getItem('ember_admin') === 'true' && onDeleteReply && (
              <button
                onClick={() => onDeleteReply(response.id)}
                className="text-red-400 hover:text-red-300 transition-colors focus:outline-none cursor-pointer"
                title="Delete reply"
              >
                <Trash2 size={12} />
              </button>
            )}
            {!isAI && (canThank || isThanked) && (
              <button
                onClick={handleThank}
                disabled={isThanked}
                className="flex items-center gap-1 text-[#D66A3E] hover:text-[#bd5e37] transition-colors focus:outline-none cursor-pointer"
                title={isThanked ? (canThank ? "Thanked" : "The author thanked this reply") : "Send thanks"}
              >
                <Heart size={13} fill={isThanked || showThanks ? "#D66A3E" : "none"} />
              </button>
            )}
          </div>
          {/* Floating Heart Animation */}
          <AnimatePresence>
            {showThanks && (
              <motion.div
                initial={{ opacity: 0, y: 0, scale: 0.5 }}
                animate={{ opacity: [0, 1, 0], y: -26, scale: 1.4 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1 }}
                className="absolute right-0 bottom-4 pointer-events-none text-[#D66A3E]"
              >
                <Heart size={15} fill="#D66A3E" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  if (response.type === 'drawing') {
    return wrapper(
      <div className="bg-white/[0.025] border border-white/[0.06] rounded-[18px] p-4 flex flex-col gap-3">
        <div className="w-full bg-black/40 rounded-[14px] overflow-hidden border border-white/[0.04] flex items-center justify-center p-2">
          <img
            src={response.drawingData}
            alt="Drawing reply"
            className="max-h-[180px] w-auto object-contain drop-shadow-md"
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-[#8a7f79] relative">
          <span className="font-bold" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
            {isAI ? <AiLabel /> : 'someone drew this'}
          </span>
          <div className="flex items-center gap-2.5">
            <span style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>{timeStr}</span>
            {localStorage.getItem('ember_admin') === 'true' && onDeleteReply && (
              <button
                onClick={() => onDeleteReply(response.id)}
                className="text-red-400 hover:text-red-300 transition-colors focus:outline-none cursor-pointer"
                title="Delete reply"
              >
                <Trash2 size={12} />
              </button>
            )}
            {!isAI && (canThank || isThanked) && (
              <button
                onClick={handleThank}
                disabled={isThanked}
                className="flex items-center gap-1 text-[#D66A3E] hover:text-[#bd5e37] transition-colors focus:outline-none cursor-pointer ml-1"
                title={isThanked ? (canThank ? "Thanked" : "The author thanked this reply") : "Send thanks"}
              >
                <Heart size={12} fill={isThanked || showThanks ? "#D66A3E" : "none"} />
              </button>
            )}
          </div>
          {/* Floating Heart Animation */}
          <AnimatePresence>
            {showThanks && (
              <motion.div
                initial={{ opacity: 0, y: 0, scale: 0.5 }}
                animate={{ opacity: [0, 1, 0], y: -26, scale: 1.4 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1 }}
                className="absolute right-0 bottom-4 pointer-events-none text-[#D66A3E]"
              >
                <Heart size={15} fill="#D66A3E" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  if (response.type === 'voice') {
    return wrapper(
      <VoicePlayer
        response={response}
        isAI={isAI}
        timeStr={timeStr}
        thought={thought}
        onDeleteReply={onDeleteReply}
        onThankReply={onThankReply}
      />
    );
  }

  // Note
  return wrapper(
    <div
      className={[
        'rounded-[18px] px-4.5 py-4 transition-all duration-300',
        isAI
          ? 'bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.03] border border-amber-500/25 shadow-[0_4px_25px_rgba(214,106,62,0.08),inset_0_1px_0_rgba(255,255,255,0.06)]'
          : 'bg-white/[0.025] hover:bg-white/[0.04] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]',
      ].join(' ')}
    >
      <p
        className="text-[#fcf8f2] text-[14.5px] leading-[1.6] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
        style={{ fontFamily: "'Alegreya Sans', sans-serif", fontWeight: 400 }}
      >
        {response.content}
      </p>
      <div className="flex items-center justify-between text-[11px] text-[#8a7f79] mt-3 relative">
        <span className="flex items-center gap-1 font-bold" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
          {isAI ? (
            <AiLabel />
          ) : (
            'someone'
          )}
        </span>
        <div className="flex items-center gap-2.5">
          {localStorage.getItem('ember_admin') === 'true' && onDeleteReply && (
            <button
              onClick={() => onDeleteReply(response.id)}
              className="text-red-400 hover:text-red-300 transition-colors focus:outline-none cursor-pointer"
              title="Delete reply"
            >
              <Trash2 size={12} />
            </button>
          )}
          <span style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
            {timeStr}
          </span>
          {!isAI && (canThank || isThanked) && (
            <button
              onClick={handleThank}
              disabled={isThanked}
              className="flex items-center gap-1 text-[#D66A3E] hover:text-[#bd5e37] transition-colors focus:outline-none cursor-pointer"
              title={isThanked ? (canThank ? "Thanked" : "The author thanked this reply") : "Send thanks"}
            >
              <Heart size={12} fill={isThanked || showThanks ? "#D66A3E" : "none"} />
            </button>
          )}
        </div>
        {/* Floating Heart Animation */}
        <AnimatePresence>
          {showThanks && (
            <motion.div
              initial={{ opacity: 0, y: 0, scale: 0.5 }}
              animate={{ opacity: [0, 1, 0], y: -26, scale: 1.4 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1 }}
              className="absolute right-0 bottom-4 pointer-events-none text-[#D66A3E]"
            >
              <Heart size={15} fill="#D66A3E" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

async function exportQuoteCard(thought: Thought) {
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      await document.fonts.ready;
    } catch {
      // Font loading fallback
    }
  }

  const canvas = document.createElement('canvas');
  const size = 1080;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 1. Deep Celestial Background
  const bgGrad = ctx.createLinearGradient(0, 0, size, size);
  bgGrad.addColorStop(0, '#0a0612');
  bgGrad.addColorStop(0.5, '#120a1f');
  bgGrad.addColorStop(1, '#1b0e2b');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  // 2. Radial Lantern Glow
  const glowColor = thought.lantern?.palette?.[0] || '#D66A3E';
  const glowGrad = ctx.createRadialGradient(size * 0.5, size * 0.44, 30, size * 0.5, size * 0.44, size * 0.6);
  glowGrad.addColorStop(0, `${glowColor}38`);
  glowGrad.addColorStop(0.5, `${glowColor}15`);
  glowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, size, size);

  // 3. Subtle background stars / specks
  ctx.save();
  for (let i = 0; i < 54; i++) {
    const sx = ((i * 197 + 43) % size);
    const sy = ((i * 311 + 89) % size);
    const sr = (i % 4 === 0) ? 1.8 : 1.0;
    const sa = 0.15 + ((i % 5) * 0.12);
    ctx.fillStyle = `rgba(255, 245, 230, ${sa})`;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 4. Elegant Card Border Frame with Rounded Corners
  const pad = 64;
  const cardRadius = 36;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.lineWidth = 1.5;
  drawRoundRect(ctx, pad, pad, size - pad * 2, size - pad * 2, cardRadius);
  ctx.stroke();

  // Inner accent line
  ctx.strokeStyle = `${glowColor}28`;
  ctx.lineWidth = 1;
  drawRoundRect(ctx, pad + 14, pad + 14, size - (pad + 14) * 2, size - (pad + 14) * 2, cardRadius - 8);
  ctx.stroke();
  ctx.restore();

  // 5. Header: Ember Logo Mark & Emotion Pill
  ctx.save();
  ctx.fillStyle = '#D66A3E';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('✦', size * 0.5, pad + 72);

  ctx.fillStyle = '#f5efe6';
  ctx.font = '700 21px "Alegreya Sans", sans-serif';
  ctx.fillText('E M B E R', size * 0.5, pad + 110);

  if (thought.emotion) {
    const emotionText = `${thought.emotion.toUpperCase()} · ${(thought.lantern?.shape || 'lantern').toUpperCase()}`;
    ctx.fillStyle = '#D66A3E';
    ctx.font = '600 13px "Alegreya Sans", sans-serif';
    ctx.fillText(emotionText, size * 0.5, pad + 138);
  }
  ctx.restore();

  // 6. Center: Decorative quote mark & Thought text
  ctx.save();
  ctx.fillStyle = `${glowColor}30`;
  ctx.font = 'italic 110px "Alegreya", serif';
  ctx.textAlign = 'center';
  ctx.fillText('“', size * 0.5, pad + 245);
  ctx.restore();

  // Smart word wrap for thought text
  ctx.save();
  ctx.fillStyle = '#fffcf9';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const text = thought.text.trim();
  let fontSize = 38;
  let lineHeight = 54;
  if (text.length > 250) {
    fontSize = 26;
    lineHeight = 38;
  } else if (text.length > 140) {
    fontSize = 32;
    lineHeight = 46;
  } else if (text.length < 60) {
    fontSize = 44;
    lineHeight = 62;
  }
  ctx.font = `400 ${fontSize}px "Alegreya", Georgia, serif`;

  const maxWidth = size - pad * 2 - 130;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  const aiReply = thought.responses.find(r => r.isAI && r.content);
  const totalTextHeight = lines.length * lineHeight;
  let startY = Math.max(pad + 265, (size * 0.48) - (totalTextHeight * 0.5) - (aiReply ? 45 : 0));

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], size * 0.5, startY + (i * lineHeight));
  }
  ctx.restore();

  // If there's an Ember reply, render an elegant ember whisper box
  if (aiReply) {
    ctx.save();
    const replyY = startY + totalTextHeight + 42;
    if (replyY < size - pad - 140) {
      // Small divider
      ctx.strokeStyle = 'rgba(214, 106, 62, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(size * 0.5 - 60, replyY);
      ctx.lineTo(size * 0.5 + 60, replyY);
      ctx.stroke();

      // Ember whisper
      ctx.fillStyle = '#ffb380';
      ctx.font = 'italic 400 20px "Alegreya", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      const replyWords = aiReply.content.split(/\s+/);
      const replyLines: string[] = [];
      let curReply = '';
      for (const w of replyWords) {
        const test = curReply ? `${curReply} ${w}` : w;
        if (ctx.measureText(test).width > maxWidth - 60 && curReply) {
          replyLines.push(curReply);
          curReply = w;
        } else {
          curReply = test;
        }
      }
      if (curReply) replyLines.push(curReply);

      const shownReplyLines = replyLines.slice(0, 3);
      for (let j = 0; j < shownReplyLines.length; j++) {
        const lineText = (j === 0 ? '✦ ember.ai: ' : '') + shownReplyLines[j] + (j === 2 && replyLines.length > 3 ? '...' : '');
        ctx.fillText(lineText, size * 0.5, replyY + 22 + (j * 28));
      }
    }
    ctx.restore();
  }

  // 7. Footer:
  ctx.save();
  const footerY = size - pad - 42;
  ctx.fillStyle = 'rgba(235, 226, 218, 0.55)';
  ctx.font = '400 15px "Alegreya Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Every whisper finds light', pad + 36, footerY);

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(214, 106, 62, 0.85)';
  ctx.font = '500 15px "Alegreya Sans", sans-serif';
  ctx.fillText('ember.ai', size - pad - 36, footerY);
  ctx.restore();

  // 8. Trigger Download
  const dataUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = `ember-whisper-${thought.id.slice(0, 8)}.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function ThoughtDetailModal({ thought, allThoughts, onClose, onAddResponse, onOpenDraw, onDeleteThought, onDeleteReply, onThankReply, tutorialStep = 'none' }: Props) {
  const [mode, setMode] = useState<ResponseMode>(tutorialStep === 'reply' ? 'sticker' : 'note');
  const [sentSticker, setSentSticker] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [hasSavedCard, setHasSavedCard] = useState(false);
  const responsesEndRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [showHugPulse, setShowHugPulse] = useState(false);

  const handleExportCard = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await exportQuoteCard(thought);
      setHasSavedCard(true);
      setTimeout(() => setHasSavedCard(false), 2200);
    } catch (e) {
      console.error('Failed to export quote card:', e);
    } finally {
      setIsExporting(false);
    }
  };

  const sameFeelingCount = useMemo(() => {
    if (!allThoughts) return 0;
    if (thought.emotion) {
      return allThoughts.filter(t => !t.isExample && t.id !== thought.id && t.emotion === thought.emotion).length;
    }
    return allThoughts.filter(t => !t.isExample && t.id !== thought.id && !t.emotion).length;
  }, [allThoughts, thought.id, thought.emotion]);

  // Hook up Tone.js soundscape for opened thought
  const soundEnabled = localStorage.getItem('ember_sound') !== 'off';
  useLanternSound(thought.lantern || null, soundEnabled);

  useEffect(() => {
    responsesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thought.responses.length]);

  const handleSendNote = useCallback((text: string) => {
    return onAddResponse({ type: 'note', content: text });
  }, [onAddResponse]);

  const handleSendVoice = useCallback((text: string, url: string, durationSec: number) => {
    return onAddResponse({ type: 'voice', content: text, audioUrl: url, durationSec });
  }, [onAddResponse]);

  const handleSendSticker = useCallback((emoji: string) => {
    onAddResponse({ type: 'sticker', content: emoji });
    setSentSticker(emoji);
    setTimeout(() => setSentSticker(null), 1600);
  }, [onAddResponse]);

  const handleHug = useCallback(() => {
    setShowHugPulse(true);
    setTimeout(() => setShowHugPulse(false), 2000);
    onAddResponse({ type: 'sticker', content: 'sticker_hug' });
  }, [onAddResponse]);

  const tabs: { id: ResponseMode; label: string; icon: React.ReactNode }[] = [
    { id: 'note', label: 'Note', icon: <Feather size={13} /> },
    { id: 'voice', label: 'Voice', icon: <Mic size={13} /> },
    { id: 'draw', label: 'Draw', icon: <Brush size={13} /> },
    { id: 'sticker', label: 'Sticker', icon: <Sparkles size={13} /> },
  ];

  return (
    <motion.div
      className="fixed inset-0 z-40 flex justify-end"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Dark Dim Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Side Sheet Sanctuary Drawer */}
      <motion.div
        className="relative w-full sm:max-w-[460px] h-[100dvh] bg-[#0c0812]/95 backdrop-blur-2xl border-l border-white/[0.08] shadow-[-20px_0_60px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden"
        initial={{ x: "100%" }}
        animate={{ x: "0%" }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Soft atmospheric ambient backlight in corner */}
        <div
          className="absolute -top-24 -right-24 w-80 h-80 rounded-full pointer-events-none opacity-20 blur-3xl"
          style={{
            background: thought.lantern ? thought.lantern.palette[0] : '#D66A3E'
          }}
        />

        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 relative z-20">
          <div className="flex items-center gap-2">
            <span
              className="text-[12px] font-bold text-[#f9f3eb]/70 tracking-widest uppercase"
              style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
            >
              Whisper
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Save Card / Download Button */}
            <motion.button
              onClick={handleExportCard}
              disabled={isExporting}
              aria-label="Save shareable quote card"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-[#e8e2dd] hover:text-white transition-all cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-[12px] font-medium"
              style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Save shareable quote card"
            >
              {hasSavedCard ? (
                <>
                  <Check size={13} className="text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">Saved</span>
                </>
              ) : isExporting ? (
                <>
                  <Loader2 size={13} className="animate-spin text-[#D66A3E]" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Download size={13} className="text-[#D66A3E]" />
                  <span>Save card</span>
                </>
              )}
            </motion.button>

            {/* Delete thought button (visible to author OR admin) */}
            {(thought.authorId === localStorage.getItem('anon_user_id') || localStorage.getItem('ember_admin') === 'true') && onDeleteThought && (
              <motion.button
                onClick={() => onDeleteThought(thought.id)}
                aria-label="Return thought to ash"
                className="w-[30px] h-[30px] rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 hover:text-red-300 transition-all cursor-pointer shadow-[0_0_10px_rgba(239,68,68,0.2)]"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                title="Return thought to ash"
              >
                <Trash2 size={13} />
              </motion.button>
            )}

            {/* Close button */}
            <motion.button
              onClick={onClose}
              aria-label="Close modal"
              className="w-[30px] h-[30px] rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[#e8e2dd] hover:text-white transition-all cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:bg-white/10"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </motion.button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className={tutorialStep === 'reply' ? 'flex-1 flex flex-col min-h-0 blur-[3px] opacity-40 pointer-events-none transition-all duration-300' : 'flex-1 flex flex-col min-h-0 transition-all duration-300'}>
          {/* Crisis Help Card if flagged */}
          {thought.showHelp && (
            <div className="px-4 pt-2 sm:px-6">
              <CrisisCard inline />
            </div>
          )}

          {/* Thought display — Luminous Sanctuary Card */}
          <div className="px-4 pt-2 pb-3 sm:px-6 sm:pt-3 sm:pb-3">
            <div
              ref={cardRef}
              className="rounded-[22px] p-5 sm:p-5.5 relative overflow-hidden transition-all duration-300 border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.015] shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]"
              style={thought.lantern ? {
                borderColor: `${thought.lantern.palette[1]}35`,
                boxShadow: `0 12px 40px rgba(0,0,0,0.5), 0 0 35px ${thought.lantern.palette[1]}15, inset 0 1px 0 rgba(255,255,255,0.06)`,
              } : undefined}
            >
              {/* Subtle ambient light gradient in top corner */}
              <div
                className="absolute top-0 right-0 w-36 h-36 rounded-full pointer-events-none opacity-20 blur-2xl"
                style={{
                  background: thought.lantern ? thought.lantern.palette[0] : '#D66A3E'
                }}
              />

              {/* Hug pulse animation */}
              <AnimatePresence>
                {showHugPulse && (
                  <motion.div
                    className="absolute inset-0 z-0 bg-[#D66A3E]"
                    initial={{ opacity: 0.4, scale: 0.95 }}
                    animate={{ opacity: 0, scale: 1.15 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.4, ease: "easeOut" }}
                  />
                )}
              </AnimatePresence>

              {/* Top metadata row: Emotion pill + Hug button */}
              <div className="flex items-center justify-between gap-3 mb-3 relative z-10">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full animate-pulse flex-shrink-0"
                    style={{
                      backgroundColor: thought.lantern?.palette[0] || '#FFB347',
                      boxShadow: `0 0 10px ${thought.lantern?.palette[1] || '#D66A3E'}`
                    }}
                  />
                  {thought.emotion && (
                    <span
                      className="text-[11px] uppercase tracking-widest font-bold text-[#f9f3eb]/75 whitespace-nowrap"
                      style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
                    >
                      {thought.emotion} · {thought.lantern?.shape || 'lantern'}
                    </span>
                  )}
                </div>

                {/* Hug Button */}
                <motion.button
                  onClick={handleHug}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 hover:bg-amber-500/20 text-[#FFB347] border border-amber-500/25 transition-all cursor-pointer shadow-[0_0_12px_rgba(255,179,71,0.15)]"
                  whileTap={{ scale: 0.92 }}
                  whileHover={{ scale: 1.05 }}
                  aria-label="Send a hug"
                >
                  <Heart size={13} fill={showHugPulse ? "#FFB347" : "none"} /> 
                  <span className="text-[11.5px] font-bold" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>Hug</span>
                </motion.button>
              </div>

              {/* Network Connection context from ember-network */}
              <div className="flex items-center gap-2 px-3 py-1 rounded-[12px] bg-white/[0.03] border border-white/[0.06] mb-3 relative z-10 w-fit">
                <span className="text-[#FFB347] text-xs">✦</span>
                <span className="text-[11.5px] text-[#ffd9c2]/90 tracking-wide" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                  {thought.emotion ? (
                    sameFeelingCount > 0
                      ? `Connected to ${sameFeelingCount} other ${sameFeelingCount === 1 ? 'person' : 'people'} who felt ${thought.emotion} tonight.`
                      : `The first ${thought.emotion} light tonight.`
                  ) : (
                    sameFeelingCount > 0
                      ? `Connected to ${sameFeelingCount} other quiet ${sameFeelingCount === 1 ? 'light' : 'lights'} tonight.`
                      : `Drifting quietly under the sky tonight.`
                  )}
                </span>
              </div>

              {/* The Whisper content */}
              <p
                className="text-[#fffcf9] select-text relative z-10 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                style={{
                  fontFamily: "'Alegreya', serif",
                  fontWeight: 400,
                  fontSize: 'clamp(15px, 3.8vw, 18.5px)',
                  lineHeight: '1.65',
                  textShadow: '0 2px 8px rgba(0,0,0,0.5)'
                }}
              >
                {thought.text}
              </p>

              {/* Ambient thin divider */}
              <div
                className="my-3 relative z-10 h-[1px] bg-gradient-to-r from-[#D66A3E]/40 to-transparent w-[90px]"
              />

              <p
                className="text-[#8a7f79] text-[11.5px] relative z-10 tracking-wide"
                style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
              >
                released {relativeTime(thought.timestamp)} · {thought.responses.length}{' '}
                {thought.responses.length === 1 ? 'response' : 'responses'}
              </p>
            </div>
          </div>

          {/* Responses Feed with Custom Ember Scrollbar */}
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-2 sm:px-6 min-h-0 max-w-full ember-scrollbar"
            aria-live="polite"
            role="log"
            aria-label="Responses"
          >
            {thought.responses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center opacity-70">
                <Leaf size={30} className="mb-2.5 text-[#10b981] drop-shadow-[0_0_15px_rgba(16,185,129,0.4)]" />
                <p
                  className="text-[#e8e2dd] text-[14px] font-bold"
                  style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
                >
                  Be the first to respond
                </p>
                <p
                  className="text-[#8a7f79] text-[12px] mt-0.5 max-w-[240px]"
                  style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
                >
                  A note, a sticker, a drawing — any warmth counts.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 max-w-full">
                {thought.responses.map((r, i) => (
                  <ResponseItem
                    key={r.id}
                    response={r}
                    index={i}
                    thought={thought}
                    onDeleteReply={(replyId) => onDeleteReply && onDeleteReply(thought.id, replyId)}
                    onThankReply={onThankReply}
                  />
                ))}
                <div ref={responsesEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Sticker sent celebration animation */}
        <AnimatePresence>
          {sentSticker && (
            <motion.div
              className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1.15 }}
              exit={{ opacity: 0, scale: 0.85, y: -24 }}
              transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            >
              <StickerIcon nameOrEmoji={sentSticker} size={110} className="drop-shadow-[0_0_40px_rgba(214,106,62,0.6)]" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Whisper Input Dock */}
        <div 
          className={[
            "border-t px-4 pt-3.5 pb-4 sm:px-6 sm:pt-4 sm:pb-5 transition-all duration-300 relative bg-[#0e0a14]/90 backdrop-blur-md",
            tutorialStep === 'reply' 
              ? "border-[#D66A3E] bg-[rgba(214,106,62,0.06)] shadow-[0_0_30px_rgba(214,106,62,0.15)] z-30" 
              : "border-white/[0.06]"
          ].join(" ")}
        >
          {tutorialStep === 'reply' && (
            <div className="absolute top-[-92px] left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-[320px] pointer-events-none">
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[rgba(20,15,25,0.98)] backdrop-blur-xl border border-[rgba(214,106,62,0.4)] rounded-[20px] px-5 py-4 text-center shadow-[0_12px_40px_rgba(0,0,0,0.6),_0_0_20px_rgba(214,106,62,0.15)] relative"
              >
                <p className="text-[#f9f3eb] text-[13.5px] font-medium leading-relaxed" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                  ember.ai is about quiet support. Tap a sticker to send it and complete the tour!
                </p>
                <div className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-[rgba(20,15,25,0.98)] border-r border-b border-[rgba(214,106,62,0.4)]" />
              </motion.div>
            </div>
          )}

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {/* Minimalist Segmented Tab Pills */}
            <div className="flex gap-1.5 p-1 rounded-[16px] bg-white/[0.03] border border-white/[0.06] mb-3">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setMode(tab.id);
                    if (tab.id === 'draw') onOpenDraw();
                  }}
                  className="relative flex-1 h-[34px] sm:h-[36px] rounded-[12px] overflow-hidden transition-all cursor-pointer"
                >
                  {/* Sliding active pill with subtle warm glow */}
                  {mode === tab.id && (
                    <motion.div
                      layoutId="tab-pill"
                      className="absolute inset-0 rounded-[12px] bg-gradient-to-r from-[#D66A3E]/25 to-[#F28A4B]/20 border border-[#D66A3E]/45 shadow-[0_0_12px_rgba(214,106,62,0.2)]"
                      transition={{ type: 'spring', bounce: 0.18, duration: 0.38 }}
                    />
                  )}
                  <span
                    className={[
                      'relative z-10 flex items-center justify-center gap-1.5 h-full text-[11.5px] sm:text-[12.5px] transition-colors duration-200',
                      mode === tab.id ? 'text-[#fffcf9] font-bold drop-shadow' : 'text-[#8a7f79] hover:text-[#e8e2dd] font-medium',
                    ].join(' ')}
                    style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
                  >
                    {tab.icon}
                    {tab.label}
                  </span>
                </button>
              ))}
            </div>

            {/* Active Tab Content */}
            <AnimatePresence mode="wait">
              {mode === 'note' && (
                <motion.div
                  key="note"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                >
                  <NoteTab onSend={handleSendNote} />
                </motion.div>
              )}
              {mode === 'voice' && (
                <motion.div
                  key="voice"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                >
                  <VoiceTab onSend={handleSendVoice} />
                </motion.div>
              )}
              {mode === 'sticker' && (
                <motion.div
                  key="sticker"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                >
                  <StickerTab onSend={handleSendSticker} />
                </motion.div>
              )}
              {mode === 'draw' && (
                <motion.div
                  key="draw"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                  className="flex flex-col items-center justify-center py-4 text-center"
                >
                  <p
                    className="text-[#8a7f79] text-[13px] mb-3"
                    style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
                  >
                    Draw a small lantern sketch to send warmth
                  </p>
                  <button
                    onClick={onOpenDraw}
                    className="px-5 h-[36px] rounded-[14px] bg-gradient-to-r from-[#D66A3E] to-[#F28A4B] text-white font-bold text-[13px] shadow-[0_0_15px_rgba(214,106,62,0.35)] cursor-pointer hover:brightness-110 active:scale-95 transition-all flex items-center gap-1.5"
                    style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
                  >
                    <Brush size={14} />
                    Open Drawing Canvas
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}
