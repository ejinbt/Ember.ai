import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MainSpace } from './components/MainSpace';
// Modals are split into their own chunks: the canvas renders first, modals load right after
// (prefetched on idle below), so the first paint doesn't wait for code nobody has opened yet.
const loadCompose = () => import('./components/ComposeModal');
const loadThoughtDetail = () => import('./components/ThoughtDetailModal');
const loadDraw = () => import('./components/DrawModal');
const loadHistory = () => import('./components/HistoryModal');
const loadReplyDetail = () => import('./components/ReplyDetailModal');
const ComposeModal = lazy(() => loadCompose().then(m => ({ default: m.ComposeModal })));
const ThoughtDetailModal = lazy(() => loadThoughtDetail().then(m => ({ default: m.ThoughtDetailModal })));
const DrawModal = lazy(() => loadDraw().then(m => ({ default: m.DrawModal })));
const HistoryModal = lazy(() => loadHistory().then(m => ({ default: m.HistoryModal })));
const ReplyDetailModal = lazy(() => loadReplyDetail().then(m => ({ default: m.ReplyDetailModal })));
import { projectId, publicAnonKey } from '../supabase/info';
import { supabase } from './supabaseClient';
import { ScreenGlow } from './components/ScreenGlow';
import { Onboarding } from './components/Onboarding';
import { Sparkles } from 'lucide-react';
import { api, getOwnerToken } from './api';
import fixtureThoughts from '../fixtures/thoughts.json';
import { CrisisCard, detectBrowserCountry } from './components/CrisisCard';
import { SafeSpaceGuard } from './components/SafeSpaceGuard';

/** Thrown after the popup is shown, so the compose/reply UI keeps the user's text or recording. */
class ShownToUserError extends Error {}
import type { Helpline } from './types';
import { isPerfThought, makePerfThoughts, perfCountFromUrl, PerfOverlay } from './perfMode';

const getAnonUserId = () => {
  let uid = localStorage.getItem('anon_user_id');
  if (!uid) {
    uid = 'user_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('anon_user_id', uid);
  }
  return uid;
};

const SERVER_URL = `https://${projectId}.supabase.co/functions/v1/server`;

export interface ThoughtResponse {
  id: string;
  type: 'note' | 'voice' | 'drawing' | 'sticker';
  content: string;
  timestamp: Date;
  isAI?: boolean;
  drawingData?: string;
  audioUrl?: string;
  authorId?: string;
  /** The lantern's author sent this reply a thank-you heart (from the feed). */
  thanked?: boolean;
  /** Only when sending a voice reply: recording length, required by the server. */
  durationSec?: number;
}

export interface Thought {
  id: string;
  text: string;
  timestamp: Date;
  rotation: number;
  x: number;
  y: number;
  /** Server-placed position (before any local drag). Connection threads pair lanterns by this,
   *  so dragging one far away stretches its threads instead of re-pairing it. */
  homeX?: number;
  homeY?: number;
  variant: 'warm' | 'light' | 'teal' | 'rose';
  responses: ThoughtResponse[];
  aiResponded?: boolean;
  glowing?: boolean;
  width: number;
  authorId?: string;
  emotion?: string;
  aiStatus?: 'waiting' | 'replying' | 'done' | 'skipped';
  lantern?: any;
  showHelp?: boolean;
  isExample?: boolean;
}

export interface ActiveToastData {
  id: string;
  thought: Thought;
  title: string;
  subtitle: string;
  isAI?: boolean;
}

function playNotificationChime() {
  try {
    if (localStorage.getItem('ember_sound') === 'off') return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.12); // A5

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.5);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.9);
  } catch {
    // Autoplay policy or unsupported audio context
  }
}

const getRandomOffset = (range: number) => (Math.random() - 0.5) * range;

type ActiveView = 'space' | 'compose' | 'thoughtDetail' | 'history' | 'replyDetail';
type TutorialStep = 'none' | 'hud' | 'star' | 'reply' | 'complete';

const initialThoughts: Thought[] = (fixtureThoughts as any[]).map((t: any) => ({
  ...t,
  timestamp: new Date(t.timestamp),
  responses: (t.responses || []).map((r: any) => ({
    ...r,
    timestamp: new Date(r.timestamp),
  })),
}));

export default function App() {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const thoughtsRef = useRef<Thought[]>([]);
  useEffect(() => {
    thoughtsRef.current = thoughts;
  }, [thoughts]);
  const [activeView, setActiveView] = useState<ActiveView>('space');
  const [selectedThought, setSelectedThought] = useState<Thought | null>(null);
  const [selectedReply, setSelectedReply] = useState<ThoughtResponse | null>(null);
  const [showDrawModal, setShowDrawModal] = useState(false);
  const [aiGlowThoughtId, setAiGlowThoughtId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [crisisHelpline, setCrisisHelpline] = useState<Helpline | null>(null);
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>('none');
  const [tutorialReplies, setTutorialReplies] = useState<ThoughtResponse[]>([]);

  useEffect(() => {
    if (!localStorage.getItem('hasCompletedOnboarding')) {
      setShowOnboarding(true);
    }
  }, []);
  const [activeToast, setActiveToast] = useState<ActiveToastData | null>(null);
  const [notAloneNotice, setNotAloneNotice] = useState<{ count: number; emotion: string } | null>(null);
  const [hasUnreadNotification, setHasUnreadNotification] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panToTarget, setPanToTarget] = useState<{ x: number; y: number } | null>(null);
  const [globalAiAudioPlaying, setGlobalAiAudioPlaying] = useState(false);
  // One popup (SafeSpaceGuard) for blocked posts/replies and send errors, instead of alert().
  const [notice, setNotice] = useState<{ message: string; severity: 'mild' | 'moderate' | 'severe' } | null>(null);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const showNotice = useCallback((message: string, severity: 'mild' | 'moderate' | 'severe' = 'mild') => {
    setNotice({ message, severity });
    setNoticeVisible(true);
  }, []);
  const [voiceCount, setVoiceCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(loading);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  const anonUserId = useRef(getAnonUserId()).current;
  
  const voiceCountRef = useRef(voiceCount);
  useEffect(() => {
    voiceCountRef.current = voiceCount;
  }, [voiceCount]);

  // Prefetch the modal chunks once the canvas is up, so the first click opens instantly.
  useEffect(() => {
    const prefetch = () => { loadCompose(); loadThoughtDetail(); loadReplyDetail(); loadHistory(); loadDraw(); };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(prefetch);
    else setTimeout(prefetch, 1500);
  }, []);

  // Demo mode: server says how many simulated people to add to the live count (0 when off)
  // Performance test mode (?perf=100 or the dev button): local-only synthetic lanterns.
  const [perfCount, setPerfCount] = useState(() => perfCountFromUrl());
  const [perfThoughts, setPerfThoughts] = useState<Thought[]>([]);
  useEffect(() => {
    setPerfThoughts(perfCount ? makePerfThoughts(perfCount) : []);
  }, [perfCount]);

  const [demoOnline, setDemoOnline] = useState(0);
  const [demoEnabled, setDemoEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    // While demo is on this check also drives the server's autopilot (the feed itself is read
    // from the database), so it runs every 30 s; with demo off, every 5 min. Skipped in
    // background tabs.
    let lastCheck = 0;
    const loadDemo = async () => {
      if (document.hidden) return;
      if (!demoEnabledRef.current && Date.now() - lastCheck < 5 * 60 * 1000) return;
      lastCheck = Date.now();
      try {
        const d = await fetch(`${SERVER_URL}/demo`, { headers: { apikey: publicAnonKey, Authorization: `Bearer ${publicAnonKey}` } }).then(r => r.json());
        setDemoOnline(d.online ?? 0);
        setDemoEnabled(!!d.enabled);
      } catch { /* keep last state */ }
    };
    loadDemo();
    const id = setInterval(loadDemo, 30_000);
    return () => clearInterval(id);
  }, []);
  // The admin button flips demoEnabled; the loop above follows it on its next 30 s tick.
  const demoEnabledRef = useRef(false);
  demoEnabledRef.current = !!demoEnabled;


  const selectedThoughtRef = useRef(selectedThought);
  useEffect(() => {
    selectedThoughtRef.current = selectedThought;
  }, [selectedThought]);

  const lastNotifyCheckRef = useRef(0);

  const triggerToast = useCallback((toastData: ActiveToastData) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setActiveToast(toastData);
    toastTimerRef.current = setTimeout(() => {
      setActiveToast(null);
    }, 6000);
  }, []);

  const checkNotifications = useCallback(async (currentThoughts: Thought[]) => {
    const nowMs = Date.now();
    if (nowMs - lastNotifyCheckRef.current < 4000) return;
    lastNotifyCheckRef.current = nowMs;

    let owned: Record<string, string> = {};
    try {
      owned = JSON.parse(localStorage.getItem('ember_owner_tokens') || '{}');
    } catch {
      owned = {};
    }

    if (!owned || Object.keys(owned).length === 0) return;

    const storedSince = localStorage.getItem('ember_notify_since');
    try {
      const res = await fetch(`${SERVER_URL}/notifications`, {
        method: 'POST',
        headers: {
          apikey: publicAnonKey,
          Authorization: `Bearer ${publicAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          owned,
          since: storedSince ?? undefined,
        }),
      });

      if (!res.ok) return;
      const data = await res.json();
      const { notifications, now } = data || {};
      if (now) {
        localStorage.setItem('ember_notify_since', now);
      }

      // If this is the absolute first check and no baseline timestamp exists,
      // save now as baseline to prevent an initial burst of historical replies from last 24h
      if (!storedSince) {
        return;
      }

      if (!Array.isArray(notifications) || notifications.length === 0) {
        return;
      }

      // Filter out notifications for thoughts currently open in detail panel
      const validNotifications = notifications.filter(
        (n: any) => selectedThoughtRef.current?.id !== n.thoughtId
      );
      if (validNotifications.length === 0) return;

      const newest = validNotifications[validNotifications.length - 1];
      const targetThought = currentThoughts.find((t) => t.id === newest.thoughtId) || {
        id: newest.thoughtId,
        text: newest.thoughtText || 'Your lantern',
        timestamp: new Date(newest.timestamp),
        rotation: 0,
        x: 0,
        y: 0,
        homeX: 0,
        homeY: 0,
        responses: [],
      } as Thought;

      let title = '';
      if (validNotifications.length > 1) {
        title = validNotifications.every((n: any) => n.kind === 'thanks')
          ? `✦ Your words helped ${validNotifications.length} people`
          : `${validNotifications.length} new notifications`;
      } else {
        if (newest.kind === 'thanks') {
          // The author of a lantern you replied to sent your reply a thank-you heart.
          title = '✦ Your words helped someone';
        } else if (newest.isAI) {
          title = '✦ ember.ai answered';
        } else if (newest.type === 'note') {
          title = 'Someone answered your lantern';
        } else if (newest.type === 'voice') {
          title = 'Someone sent you a voice note';
        } else if (newest.type === 'drawing') {
          title = 'Someone drew something for you';
        } else if (newest.type === 'sticker') {
          title = 'Someone sent you a sticker';
        } else {
          title = 'Someone answered your lantern';
        }
      }

      const subtitle = newest.kind === 'thanks'
        ? (newest.preview ? `They sent a heart for "${newest.preview}"` : 'They sent a thank-you heart for your reply')
        : newest.preview
        ? `"${newest.preview}"`
        : (newest.thoughtText || targetThought.text);

      playNotificationChime();
      setHasUnreadNotification(true);
      triggerToast({
        id: newest.replyId,
        thought: targetThought,
        title,
        subtitle,
        isAI: newest.isAI,
      });
    } catch (err) {
      console.warn('Failed to fetch notifications:', err);
    }
  }, [triggerToast]);

  // Fetch thoughts — reads directly from the KV table to avoid edge function cold-start/EPIPE issues
  const fetchThoughts = useCallback(async () => {
    try {
      const data = await api.getThoughts();
      const list = data || [];
      
      let savedPositions: Record<string, { x: number; y: number }> = {};
      try {
        const raw = localStorage.getItem('ember_positions');
        if (raw) savedPositions = JSON.parse(raw);
      } catch (e) {
        console.warn('Could not read ember_positions:', e);
      }

      const parsedData = list.map((t: any) => {
        const saved = savedPositions[t.id];
        return {
          ...t,
          x: saved ? saved.x : t.x,
          y: saved ? saved.y : t.y,
          homeX: t.x,
          homeY: t.y,
          timestamp: new Date(t.timestamp),
          responses: (t.responses || []).map((r: any) => ({
            ...r,
            timestamp: new Date(r.timestamp),
          })),
        };
      });

      // Merge: DB is the source of truth, but keep locally-added thoughts
      // that haven't been persisted yet so they don't vanish on the next poll.
      setThoughts(prev => {
        // Reuse the previous object for thoughts that didn't change, so React.memo'd lanterns
        // skip re-rendering on each poll/realtime refetch (40+ lanterns re-rendered every time).
        const sig = (t: any) => JSON.stringify([t.x, t.y, t.text, t.emotion, t.aiStatus, t.showHelp, t.isExample,
          t.lantern, (t.responses || []).map((r: any) => [r.id, r.content, r.audioUrl, r.drawingData, r.thanked])]);
        const prevById = new Map(prev.map(t => [t.id, t]));
        for (let i = 0; i < parsedData.length; i++) {
          const old = prevById.get(parsedData[i].id);
          if (old && sig(old) === sig(parsedData[i])) parsedData[i] = old;
        }
        const dbIds = new Set(parsedData.map((t: Thought) => t.id));
        // Keep ONLY very fresh local thoughts (created in the last 15s by us) that aren't in the DB yet
        const localOnly = prev.filter(t => {
          if (dbIds.has(t.id)) return false;
          const isFresh = (Date.now() - new Date(t.timestamp).getTime()) < 15000;
          return t.authorId === anonUserId && isFresh;
        });
        return [...parsedData, ...localOnly];
      });

      // Check for new replies to owned lanterns (throttled to 5s)
      checkNotifications(parsedData);
    } catch (err) {
      console.warn('API getThoughts failed:', err);
    } finally {
      if (loadingRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [anonUserId]);

  // Dev-only demo toggle: admin passcode once per session -> admin token -> POST /demo
  const toggleDemo = useCallback(async () => {
    const headers = { apikey: publicAnonKey, Authorization: `Bearer ${publicAnonKey}`, 'Content-Type': 'application/json' };
    // Reuse the admin login (logo double-click) if there is one.
    let adminToken = localStorage.getItem('ember_admin_token') || sessionStorage.getItem('ember_demo_admin_token');
    if (!adminToken) {
      const passcode = prompt('Admin passcode to switch demo mode:');
      if (!passcode) return;
      const res = await fetch(`${SERVER_URL}/verify-admin`, { method: 'POST', headers, body: JSON.stringify({ passcode }) });
      const data = await res.json().catch(() => ({}));
      if (!data.adminToken) { alert('Incorrect passcode.'); return; }
      adminToken = data.adminToken as string;
      sessionStorage.setItem('ember_demo_admin_token', adminToken);
    }
    const res = await fetch(`${SERVER_URL}/demo`, {
      method: 'POST',
      headers: { ...headers, 'X-Admin-Token': adminToken },
      body: JSON.stringify({ enabled: !demoEnabled }),
    });
    if (res.status === 403) {
      sessionStorage.removeItem('ember_demo_admin_token'); // expired token: ask again next click
      localStorage.removeItem('ember_admin_token');
      alert('Admin session expired, click again.');
      return;
    }
    if (res.status === 409) {
      alert('Demo is switched off on the server (DEMO_MODE=false). Set it to true to use this button.');
      return;
    }
    const data = await res.json().catch(() => null);
    if (!data) return;
    setDemoEnabled(!!data.enabled);
    setDemoOnline(data.online ?? 0);
    fetchThoughts();
  }, [demoEnabled, fetchThoughts]);

  // Admin: clear every lantern and reply (DELETE /thoughts). Shown while admin mode is on.
  const wipeSky = useCallback(async () => {
    const adminToken = localStorage.getItem('ember_admin_token');
    if (!adminToken) return;
    if (!window.confirm('Delete EVERY lantern and reply for everyone? This cannot be undone.')) return;
    const res = await fetch(`${SERVER_URL}/thoughts`, {
      method: 'DELETE',
      headers: { apikey: publicAnonKey, Authorization: `Bearer ${publicAnonKey}`, 'X-Admin-Token': adminToken },
    });
    if (res.status === 403) {
      alert("Couldn't clear. Your admin session may have expired: double-click the logo to log out and back in.");
      return;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) { alert("Couldn't clear the sky. Try again."); return; }
    alert(`Cleared ${data.deleted} lantern${data.deleted === 1 ? '' : 's'}.`);
    fetchThoughts();
  }, [fetchThoughts]);

  useEffect(() => {
    fetchThoughts();

    // Load at scale (100 people online): every write fires a realtime event to every browser.
    // - Realtime refetches wait 300 ms plus a random 0–1.2 s, so browsers don't all hit the
    //   server in the same instant.
    // - Background tabs don't refetch at all; they catch up when they become visible again.
    // - The poll is a safety net: every 10 s without realtime, every 30 s while it's connected.
    let realtimeConnected = false;
    let lastFetchAt = Date.now();
    let missedWhileHidden = false;
    const refetch = () => {
      if (document.hidden) {
        missedWhileHidden = true;
        return;
      }
      lastFetchAt = Date.now();
      fetchThoughts();
    };

    const pollInterval = setInterval(() => {
      const every = realtimeConnected ? 30000 : 10000;
      if (Date.now() - lastFetchAt >= every - 500) refetch();
    }, 10000);

    const onVisible = () => {
      if (!document.hidden && missedWhileHidden) {
        missedWhileHidden = false;
        refetch();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const triggerDebouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refetch, 300 + Math.random() * 1200);
    };

    // Subscribe to thoughts and replies table changes (F1 spec)
    const channel = supabase
      .channel('realtime-thoughts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'thoughts' },
        () => triggerDebouncedFetch()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'replies' },
        (payload) => {
          triggerDebouncedFetch();
          if (payload.eventType === 'INSERT') {
            checkNotifications(thoughtsRef.current);
          }
        }
      )
      .subscribe((status) => {
        realtimeConnected = status === 'SUBSCRIBED';
      });

    // Subscribe to presence
    const presenceChannel = supabase.channel('online-users');

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        // Track unique users online (excluding multiple tabs from the same user)
        const uniqueUserIds = new Set<string>();
        Object.values(state).forEach((presences: any) => {
          presences.forEach((p: any) => {
            if (p.userId) {
              uniqueUserIds.add(p.userId);
            }
          });
        });
        
        const count = uniqueUserIds.size > 0 ? uniqueUserIds.size : Object.keys(state).length;
        setVoiceCount(count);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ userId: anonUserId, onlineAt: new Date() });
        }
      });

    // Thank-you hearts reach the replier through POST /notifications (kind "thanks"): saved on the
    // server, so they arrive even if the replier was offline, and only the real author can send one.

    return () => {
      clearInterval(pollInterval);
      if (debounceTimer) clearTimeout(debounceTimer);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
      supabase.removeChannel(presenceChannel);
    };
  }, [fetchThoughts]);

  const handleToastClick = useCallback((thought: Thought) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setActiveToast(null);
    setHasUnreadNotification(false);

    // Look up freshest live coordinates
    const liveThought = thoughtsRef.current.find((t) => t.id === thought.id) || thought;

    // Switch to space view so camera flight across the sky is fully visible
    setActiveView('space');

    // Pan camera smoothly across the sky directly to that lantern
    setPanToTarget({ x: liveThought.x, y: liveThought.y });

    // Illuminate that lantern with the radiant glowing beacon
    setAiGlowThoughtId(liveThought.id);

    // Keep beacon glowing for 6 seconds so user sees it in the sky
    setTimeout(() => {
      setAiGlowThoughtId((current) => (current === liveThought.id ? null : current));
    }, 6000);

    // Allow 1.3s for the camera to smoothly glide and pinpoint the glowing lantern before sliding in the drawer
    setTimeout(() => {
      setSelectedThought(liveThought);
      setActiveView('thoughtDetail');
    }, 1300);
  }, []);

  const handleDeleteThought = useCallback(async (thoughtId: string) => {
    const confirmDelete = window.confirm("Are you sure you want to return this thought to ash?");
    if (!confirmDelete) return;
    if (isPerfThought(thoughtId)) {
      setPerfThoughts(prev => prev.filter(t => t.id !== thoughtId));
      setActiveView('space');
      setSelectedThought(null);
      return;
    }

    try {
      setThoughts(prev => prev.filter(t => t.id !== thoughtId));
      setActiveView('space');
      setSelectedThought(null);

      const token = getOwnerToken(thoughtId) || '';
      const adminToken = localStorage.getItem('ember_admin_token') || undefined;
      const ok = await api.deleteThought(thoughtId, token, adminToken);
      if (!ok) {
        // Removed optimistically above: put it back and say why.
        fetchThoughts();
        alert(adminToken
          ? "Couldn't delete. Your admin session may have expired: double-click the logo to log out and back in."
          : "Couldn't delete this thought.");
      }
    } catch (err) {
      console.error("Error deleting thought:", err);
      fetchThoughts();
    }
  }, [fetchThoughts]);

  const handleDeleteReply = useCallback(async (thoughtId: string, replyId: string) => {
    const confirmDelete = window.confirm("Are you sure you want to delete this reply?");
    if (!confirmDelete) return;

    try {
      setThoughts(prev => prev.map(t => {
        if (t.id === thoughtId) {
          return { ...t, responses: t.responses.filter(r => r.id !== replyId) };
        }
        return t;
      }));

      setSelectedThought(prev => {
        if (prev && prev.id === thoughtId) {
          return { ...prev, responses: prev.responses.filter(r => r.id !== replyId) };
        }
        return prev;
      });

      const token = getOwnerToken(replyId) || '';
      const adminToken = localStorage.getItem('ember_admin_token') || undefined;
      const ok = await api.deleteReply(thoughtId, replyId, token, adminToken);
      if (!ok) {
        fetchThoughts();
        alert(adminToken
          ? "Couldn't delete. Your admin session may have expired: double-click the logo to log out and back in."
          : "Couldn't delete this reply.");
      }
    } catch (err) {
      console.error("Error deleting reply:", err);
      fetchThoughts();
    }
  }, [fetchThoughts]);

  const handleInputClick = () => setActiveView('compose');

  const handleThoughtClick = (thought: Thought) => {
    setSelectedThought(thought);
    setActiveView('thoughtDetail');
    setHasUnreadNotification(false);
    if (tutorialStep === 'star') {
      setTutorialStep('reply');
    }
  };

  const handleHistoryThoughtClick = useCallback((thought: Thought) => {
    setActiveView('space');
    setPanToTarget({ x: thought.x, y: thought.y });
    setAiGlowThoughtId(thought.id);
    setTimeout(() => {
      setAiGlowThoughtId(current => current === thought.id ? null : current);
    }, 5000);
  }, []);

  const handleReplyClick = (thought: Thought, reply: ThoughtResponse) => {
    setSelectedThought(thought);
    setSelectedReply(reply);
    setActiveView('replyDetail');
  };

  const handleCloseModal = () => {
    setActiveView('space');
    setSelectedThought(null);
    setSelectedReply(null);
    if (tutorialStep === 'reply') {
      setTutorialStep('star');
    }
  };

  const handleSubmitThought = useCallback(async (text: string, emotion?: string) => {
    const basePositions = [
      { x: -300, y: -200 },
      { x: 300, y: -200 },
      { x: 0, y: 300 },
      { x: -400, y: 400 },
      { x: 400, y: 300 }
    ];
    
    const base = basePositions[Math.floor(Math.random() * basePositions.length)];
    
    const country = detectBrowserCountry();
    try {
      const res = await api.createThought({
        text,
        emotion: emotion as any,
        authorId: anonUserId,
        country,
      });

      if ('blocked' in res && res.blocked) {
        showNotice(res.reason || "This message couldn't be released.", res.severity || 'moderate');
        throw new ShownToUserError('blocked'); // keeps the draft in ComposeModal
      }

      if ('thought' in res) {
        const created: Thought = {
          ...res.thought,
          timestamp: new Date(res.thought.timestamp),
          responses: (res.thought.responses || []).map((r: any) => ({
            ...r,
            timestamp: new Date(r.timestamp),
          })),
        };

        if (!localStorage.getItem('ember_notify_since')) {
          localStorage.setItem('ember_notify_since', new Date().toISOString());
        }

        setThoughts(prev => [...prev.filter(t => t.id !== created.id), created]);
        setActiveView('space');

        const emo = emotion || res.thought.emotion;
        if (emo) {
          const sameFeelingCount = thoughtsRef.current.filter(t => !t.isExample && t.emotion === emo && t.id !== created.id).length;
          setNotAloneNotice({ count: sameFeelingCount, emotion: emo });
          setTimeout(() => {
            setNotAloneNotice(null);
          }, 7000);
        } else {
          const unlabelledCount = thoughtsRef.current.filter(t => !t.isExample && !t.emotion && t.id !== created.id).length;
          setNotAloneNotice({ count: unlabelledCount, emotion: '' });
          setTimeout(() => {
            setNotAloneNotice(null);
          }, 7000);
        }

        if (res.helpline) {
          setCrisisHelpline(res.helpline);
        }
      }
    } catch (err: any) {
      if (!(err instanceof ShownToUserError)) {
        console.error('Error creating thought:', err);
        showNotice(err.message || "Couldn't release your thought. Check your connection and try again.");
      }
      throw err;
    }
  }, [anonUserId, showNotice]);

  const handleAddResponse = useCallback(async (
    thoughtId: string,
    response: Omit<ThoughtResponse, 'id' | 'timestamp'>
  ) => {
    if (isPerfThought(thoughtId)) {
      alert('This is a performance-test lantern (only in your browser), so it can\'t receive replies.');
      return;
    }
    const newResponse: ThoughtResponse = {
      ...response,
      id: Date.now().toString(),
      timestamp: new Date(),
      authorId: anonUserId,
    };

    if (thoughtId === 'thought-tutorial-1') {
      const mockReply: ThoughtResponse = {
        ...response,
        id: Date.now().toString(),
        timestamp: new Date(),
        authorId: anonUserId,
      };
      setTutorialReplies(prev => [...prev, mockReply]);
      setTimeout(() => {
        setTutorialStep('complete');
      }, 1500);
      return;
    }

    try {
      const res = await api.addReply(thoughtId, {
        type: response.type,
        content: response.content,
        drawingData: response.drawingData,
        audioData: response.audioUrl,
        durationSec: response.durationSec,
        authorId: anonUserId,
      });

      if ('blocked' in res && res.blocked) {
        showNotice(res.reason || "This reply couldn't be sent.", res.severity || 'moderate');
        throw new ShownToUserError('blocked'); // keeps the note/recording in the reply tab
      }

      if ('reply' in res) {
        const replyObj: ThoughtResponse = {
          ...res.reply,
          timestamp: new Date(res.reply.timestamp),
        };

        setThoughts(prev => {
          const updated = prev.map(t => {
            if (t.id === thoughtId) {
              return { ...t, responses: [...t.responses, replyObj] };
            }
            return t;
          });
          const updatedSelected = updated.find(t => t.id === thoughtId);
          if (updatedSelected) setSelectedThought(updatedSelected);
          return updated;
        });
      }
    } catch (err: any) {
      if (!(err instanceof ShownToUserError)) {
        console.error('Error adding reply:', err);
        showNotice(err.message || "Couldn't send your reply. Check your connection and try again.");
      }
      throw err;
    }
  }, [anonUserId, showNotice]);

  const handleThoughtMove = useCallback((id: string, x: number, y: number) => {
    if (isPerfThought(id)) {
      setPerfThoughts(prev => prev.map(t => (t.id === id ? { ...t, x, y } : t)));
      return;
    }
    try {
      const raw = localStorage.getItem('ember_positions');
      const positions = raw ? JSON.parse(raw) : {};
      positions[id] = { x, y };
      localStorage.setItem('ember_positions', JSON.stringify(positions));
    } catch (e) {
      console.warn('Could not save ember_positions to localStorage:', e);
    }
    setThoughts(prev => prev.map(t => (t.id === id ? { ...t, x, y } : t)));
  }, []);

  // Returns the promise: the draw panel shows "Sending…" and only closes once it's sent, so a
  // refused or failed drawing isn't lost (it used to close at once, before the check finished).
  const handleSendDrawing = useCallback(async (drawingData: string) => {
    if (selectedThought) {
      await handleAddResponse(selectedThought.id, {
        type: 'drawing',
        content: '',
        drawingData,
      });
    }
    setShowDrawModal(false);
  }, [selectedThought, handleAddResponse]);

  // Thank-you heart (only offered on your own lantern): saved on the server, which tells the
  // replier "Your words helped someone" through their notifications. Returns false if it failed,
  // so the heart can un-fill.
  const handleThankReply = useCallback(async (thoughtId: string, reply: ThoughtResponse) => {
    const ok = await api.thankReply(thoughtId, reply.id);
    if (!ok) {
      showNotice("Couldn't send your thank-you. Try again in a moment.", 'mild');
      return false;
    }
    playNotificationChime();
    const targetThought = thoughtsRef.current.find(t => t.id === thoughtId) || ({
      id: thoughtId,
      text: 'Your whisper',
      responses: [],
    } as any);
    triggerToast({
      id: `thank-${reply.id}-${Date.now()}`,
      thought: targetThought,
      title: '✦ Thank-you sent',
      subtitle: "They'll know their words helped you",
      isAI: false,
    });
    return true;
  }, [triggerToast, showNotice]);

  // Auto-play Ember's voice reply once when it arrives on one of YOUR thoughts.
  // Replies already there when the page loaded are only marked as seen (no surprise audio).
  const seenAiRepliesRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (loading) return;
    const mine = thoughts.filter(t => t.authorId === anonUserId || getOwnerToken(t.id));
    const aiVoice = mine.flatMap(t => t.responses.filter(r => r.isAI && r.audioUrl));
    if (seenAiRepliesRef.current === null) {
      seenAiRepliesRef.current = new Set(aiVoice.map(r => r.id));
      return;
    }
    const seen = seenAiRepliesRef.current;
    const fresh = aiVoice.filter(r => !seen.has(r.id));
    fresh.forEach(r => seen.add(r.id));
    const latest = fresh[fresh.length - 1];
    if (!latest?.audioUrl) return;
    const audio = new Audio(latest.audioUrl);
    setGlobalAiAudioPlaying(true);
    const done = () => setGlobalAiAudioPlaying(false);
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done); // the browser may block it if the user hasn't interacted yet
  }, [thoughts, loading, anonUserId]);

  const tutorialThought = useMemo<Thought | null>(() => {
    if (tutorialStep === 'none') return null;
    return {
      id: 'thought-tutorial-1',
      text: "I'm glad you drifted here. Tap on this lantern to see how we respond to each other.",
      timestamp: new Date(),
      rotation: -2,
      x: 0,
      y: -80,
      variant: 'warm',
      responses: tutorialReplies,
      aiStatus: 'done',
      width: 280,
      authorId: 'system',
      emotion: 'grateful',
      showHelp: false,
      isExample: true,
      lantern: {
        palette: ['#D9F2B4', '#8DBF5A', '#3E5A22'],
        glow: 0.65,
        flicker: 0.3,
        shape: 'round',
        sound: { mood: 'ocean', instrument: 'piano', key: 'C major', tempo: 60 },
        caption: 'soft ripples on water',
      },
    };
  }, [tutorialStep, tutorialReplies]);

  const activeThoughts = useMemo(() => {
    // Lanterns fade after 24 h; the example lanterns stay (they are always in the sky).
    const timeFiltered = thoughts.filter(t => t.isExample || (Date.now() - t.timestamp.getTime()) < 24 * 60 * 60 * 1000);
    if (tutorialThought) {
      return [tutorialThought];
    }
    return perfThoughts.length ? [...timeFiltered, ...perfThoughts] : timeFiltered;
  }, [thoughts, tutorialThought, perfThoughts]);

  if (loading) {
    return (
      <div className="w-full h-[100dvh] flex flex-col items-center justify-center bg-[#050308] gap-6 select-none">
        <div className="relative flex flex-col items-center justify-center">
          {/* Breathing flame aura */}
          <motion.div
            className="absolute w-32 h-32 rounded-full pointer-events-none"
            style={{
              background: 'radial-gradient(circle, rgba(214,106,62,0.35) 0%, rgba(214,106,62,0.08) 50%, transparent 75%)',
            }}
            animate={{
              scale: [0.85, 1.25, 0.85],
              opacity: [0.5, 0.9, 0.5],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />

          {/* Breathing flame icon / logo */}
          <motion.div
            animate={{
              scale: [0.95, 1.05, 0.95],
              filter: [
                'drop-shadow(0 0 12px rgba(214,106,62,0.4))',
                'drop-shadow(0 0 28px rgba(214,106,62,0.8))',
                'drop-shadow(0 0 12px rgba(214,106,62,0.4))',
              ],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="relative z-10 flex flex-col items-center"
          >
            <img 
              src="https://i.imgur.com/5nagvWz.png" 
              alt="ember.ai logo" 
              className="h-20 w-auto object-contain"
            />
          </motion.div>
        </div>

        <div className="flex flex-col items-center gap-2 relative z-10">
          <motion.p
            className="text-[#f9f3eb] text-[16px] tracking-wide"
            style={{ fontFamily: "'Alegreya', serif", fontWeight: 400 }}
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            lighting the lanterns…
          </motion.p>
          <div className="w-24 h-[2px] bg-white/10 rounded-full overflow-hidden relative">
            <div className="absolute top-0 left-0 h-full bg-[#D66A3E] w-1/2 rounded-full animate-[loading-bar_1.6s_infinite_ease-in-out]" />
          </div>
        </div>

        <style dangerouslySetInnerHTML={{__html: `
          @keyframes loading-bar {
            0% { left: -50%; }
            100% { left: 100%; }
          }
        `}} />
      </div>
    );
  }

  const showDevButtons = import.meta.env.DEV || localStorage.getItem('ember_admin') === 'true';

  return (
    <div className="w-full h-[100dvh] relative overflow-hidden bg-[#f9f3eb]">
      {localStorage.getItem('ember_admin') === 'true' && (
        <button
          onClick={wipeSky}
          className="fixed top-16 left-3 sm:top-20 sm:left-7 z-[100] rounded-full px-3 py-1.5 text-xs font-medium shadow-md border transition-colors"
          style={{ background: 'rgba(255,255,255,0.85)', color: '#b3261e', borderColor: 'rgba(179,38,30,0.35)' }}
          title="Admin: delete every lantern and reply"
        >
          Clear all lanterns
        </button>
      )}
      {/* Demo / Perf: always on localhost (dev); on the live site in admin mode (logo double-click),
          so they can be used in a demo without visitors seeing them. */}
      {showDevButtons && demoEnabled !== null && (
        <button
          onClick={toggleDemo}
          className="fixed bottom-4 left-4 z-[100] rounded-full px-3 py-1.5 text-xs font-medium shadow-md border transition-colors"
          style={{
            background: demoEnabled ? '#d66a3e' : 'rgba(255,255,255,0.85)',
            color: demoEnabled ? '#fff' : '#5a4c44',
            borderColor: demoEnabled ? '#d66a3e' : 'rgba(90,76,68,0.25)',
          }}
          title="Dev only: show or hide simulated people"
        >
          Demo {demoEnabled ? 'on' : 'off'}
        </button>
      )}
      {showDevButtons && (
        <button
          onClick={() => setPerfCount(c => (c ? 0 : 100))}
          className="fixed bottom-4 left-28 z-[100] rounded-full px-3 py-1.5 text-xs font-medium shadow-md border transition-colors"
          style={{
            background: perfCount ? '#3b82f6' : 'rgba(255,255,255,0.85)',
            color: perfCount ? '#fff' : '#5a4c44',
            borderColor: perfCount ? '#3b82f6' : 'rgba(90,76,68,0.25)',
          }}
          title="Dev only: add 100 local test lanterns + FPS meter (also ?perf=100 in the URL)"
        >
          Perf {perfCount ? `${perfCount} on` : 'off'}
        </button>
      )}
      {perfCount > 0 && <PerfOverlay count={perfCount} />}
      <MainSpace
        thoughts={activeThoughts}
        selectedThoughtId={activeView === 'thoughtDetail' && selectedThought ? selectedThought.id : null}
        onInputClick={handleInputClick}
        onThoughtClick={handleThoughtClick}
        onReplyClick={handleReplyClick}
        onHistoryClick={() => {
          setHasUnreadNotification(false);
          setActiveView('history');
        }}
        onThoughtMove={handleThoughtMove}
        aiGlowThoughtId={aiGlowThoughtId}
        voiceCount={voiceCount + demoOnline}
        panToTarget={panToTarget}
        onPanComplete={() => setPanToTarget(null)}
        tutorialStep={tutorialStep}
        setTutorialStep={setTutorialStep}
        onTriggerPanToStar={() => setPanToTarget({ x: 0, y: -80 })}
        hasUnreadHistory={hasUnreadNotification}
      />
      <ScreenGlow isPlaying={globalAiAudioPlaying} />
      {notice && (
        <div className={`fixed inset-0 z-[200] ${noticeVisible ? '' : 'pointer-events-none'}`}>
          <SafeSpaceGuard
            visible={noticeVisible}
            severity={notice.severity}
            message={notice.message}
            onDismiss={() => setNoticeVisible(false)}
          />
        </div>
      )}
      <AnimatePresence>
        {showOnboarding && (
          <Onboarding
            key="onboarding"
            onComplete={() => {
              setShowOnboarding(false);
              setTutorialStep('hud');
            }}
          />
        )}
      </AnimatePresence>
      <Suspense fallback={null}><AnimatePresence mode="wait">
        {activeView === 'compose' && (
          <ComposeModal
            key="compose"
            onClose={() => setActiveView('space')}
            onSubmit={handleSubmitThought}
          />
        )}
        {activeView === 'thoughtDetail' && selectedThought && (
          <ThoughtDetailModal
            key="detail"
            thought={selectedThought}
            allThoughts={activeThoughts}
            onClose={handleCloseModal}
            onAddResponse={(r) => handleAddResponse(selectedThought.id, r)}
            onOpenDraw={() => setShowDrawModal(true)}
            onDeleteThought={handleDeleteThought}
            onDeleteReply={handleDeleteReply}
            onThankReply={handleThankReply}
            tutorialStep={tutorialStep}
          />
        )}
        {activeView === 'history' && (
          <HistoryModal
            key="history"
            thoughts={thoughts}
            userId={anonUserId}
            onClose={() => setActiveView('space')}
            onThoughtClick={handleHistoryThoughtClick}
          />
        )}
        {activeView === 'replyDetail' && selectedReply && selectedThought && (
          <ReplyDetailModal
            key="replyDetail"
            reply={selectedReply}
            parentThought={selectedThought}
            onClose={handleCloseModal}
          />
        )}
      </AnimatePresence></Suspense>
      <AnimatePresence>
        {tutorialStep === 'complete' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-[#050308]/95 p-6 text-center"
          >
            <div 
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(214,106,62,0.2) 0%, transparent 60%)' }}
            />
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 180 }}
              className="max-w-[420px] bg-[rgba(255,255,255,0.03)] backdrop-blur-3xl border border-[rgba(255,255,255,0.15)] shadow-[0_24px_60px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.1)] rounded-[32px] p-8 flex flex-col items-center"
            >
              <div className="w-16 h-16 rounded-full bg-[rgba(214,106,62,0.15)] border border-[rgba(214,106,62,0.3)] flex items-center justify-center text-[#D66A3E] mb-6 shadow-[0_0_20px_rgba(214,106,62,0.2)]">
                <Sparkles size={32} />
              </div>
              <h2 className="text-[#f9f3eb] text-[26px] font-bold mb-3" style={{ fontFamily: "'Alegreya', serif" }}>
                Welcome to the Sky
              </h2>
              <p className="text-[#e2d9d1] text-[15px] leading-relaxed mb-8" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                You are ready. The mock tutorial thought has faded away, and you are now connected to the live sky. Share your whispers, support others, and let the warmth guide you.
              </p>
              <motion.button
                onClick={() => {
                  setTutorialStep('none');
                  setSelectedThought(null);
                  setActiveView('space');
                  localStorage.setItem('hasCompletedOnboarding', 'true');
                }}
                className="w-full h-[52px] bg-[#D66A3E] text-[#fffcf9] rounded-[18px] text-[16px] font-bold shadow-[0_0_20px_rgba(214,106,62,0.4)] cursor-pointer"
                style={{ fontFamily: "'Alegreya Sans', sans-serif" }}
                whileHover={{ scale: 1.02, backgroundColor: '#bd5e37', boxShadow: '0 0 25px rgba(214,106,62,0.6)' }}
                whileTap={{ scale: 0.98 }}
              >
                Enter the Sanctuary
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <Suspense fallback={null}><AnimatePresence>
        {showDrawModal && (
          <DrawModal
            key="draw"
            onClose={() => setShowDrawModal(false)}
            onSend={handleSendDrawing}
          />
        )}
      </AnimatePresence></Suspense>

      <AnimatePresence>
        {crisisHelpline && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <CrisisCard
              helpline={crisisHelpline}
              onClose={() => setCrisisHelpline(null)}
            />
          </div>
        )}
      </AnimatePresence>

      <div className="fixed top-6 sm:top-8 inset-x-0 z-[150] flex justify-center pointer-events-none px-4">
        <AnimatePresence>
          {activeToast && (
            <motion.div
              initial={{ opacity: 0, y: -30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              className="pointer-events-auto w-full max-w-[440px] bg-[rgba(16,12,22,0.96)] backdrop-blur-2xl border border-[rgba(214,106,62,0.45)] rounded-[22px] px-5 py-3.5 shadow-[0_16px_50px_rgba(0,0,0,0.85),_0_0_25px_rgba(214,106,62,0.2)] flex items-center justify-between gap-4 cursor-pointer hover:bg-[rgba(24,18,32,0.98)] hover:border-[rgba(214,106,62,0.7)] transition-all active:scale-[0.99]"
              onClick={() => handleToastClick(activeToast.thought)}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[rgba(214,106,62,0.18)] flex items-center justify-center text-[#D66A3E] border border-[rgba(214,106,62,0.4)] animate-pulse shrink-0 shadow-[0_0_12px_rgba(214,106,62,0.25)]">
                  <Sparkles size={18} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[12px] text-[#D66A3E] font-bold tracking-wider" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                    {activeToast.title}
                  </span>
                  <p className="text-[#f9f3eb] text-[14px] font-normal leading-normal truncate mt-0.5" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                    {activeToast.subtitle}
                  </p>
                </div>
              </div>
              
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  if (toastTimerRef.current) {
                    clearTimeout(toastTimerRef.current);
                    toastTimerRef.current = null;
                  }
                  setActiveToast(null);
                }}
                className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 text-[#8a7f79] hover:text-white transition-colors shrink-0 cursor-pointer"
                aria-label="Close notification"
              >
                <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* "You're not alone" quiet line after release */}
      <AnimatePresence>
        {notAloneNotice && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-24 sm:bottom-28 left-1/2 -translate-x-1/2 z-[140] pointer-events-none px-5 py-2.5 rounded-full bg-[rgba(16,12,22,0.94)] backdrop-blur-2xl border border-[rgba(214,106,62,0.4)] shadow-[0_12px_40px_rgba(0,0,0,0.8),_0_0_25px_rgba(214,106,62,0.2)] flex items-center gap-2.5 max-w-[90vw]"
          >
            <span className="w-2 h-2 rounded-full bg-[#D66A3E] animate-ping shrink-0" />
            <p className="text-[#f9f3eb] text-[13.5px] sm:text-[14.5px] font-medium tracking-wide whitespace-nowrap truncate" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
              {notAloneNotice.emotion ? (
                notAloneNotice.count > 0 
                  ? `You're not alone · ${notAloneNotice.count} other${notAloneNotice.count === 1 ? '' : 's'} felt ${notAloneNotice.emotion} tonight`
                  : `Your lantern carries light for others feeling ${notAloneNotice.emotion} tonight`
              ) : (
                notAloneNotice.count > 0
                  ? `You're not alone · connected to ${notAloneNotice.count} other quiet light${notAloneNotice.count === 1 ? '' : 's'} tonight`
                  : `Your lantern carries light · you are not alone tonight`
              )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
