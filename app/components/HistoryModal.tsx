import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Thought } from '../App';
import { Clock, MessageCircle } from 'lucide-react';
interface Props {
  thoughts: Thought[];
  userId: string;
  onClose: () => void;
  onThoughtClick: (thought: Thought) => void;
}
export function HistoryModal({ thoughts, userId, onClose, onThoughtClick }: Props) {
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  // Filter thoughts based on active tab
  const displayedThoughts = tab === 'mine'
    ? thoughts.filter(t => t.authorId === userId || t.responses.some(r => r.authorId === userId))
    : thoughts.filter(t => (Date.now() - t.timestamp.getTime()) < 24 * 60 * 60 * 1000);
  // Sort descending by timestamp
  const sortedThoughts = [...displayedThoughts].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const activeThoughtsCount = thoughts.filter(t => (Date.now() - t.timestamp.getTime()) < 24 * 60 * 60 * 1000).length;
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="absolute inset-0 bg-[rgba(5,3,8,0.7)] backdrop-blur-sm" onClick={onClose} />
      
      <motion.div
        className="relative w-full max-w-[500px] max-h-[85vh] bg-[rgba(255,255,255,0.03)] backdrop-blur-3xl border border-[rgba(255,255,255,0.15)] shadow-[0_20px_60px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.1)] rounded-[24px] flex flex-col overflow-hidden"
        initial={{ y: 20, scale: 0.95 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 20, scale: 0.95 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h2 className="text-[#f9f3eb] text-[20px] font-bold tracking-wide" style={{ fontFamily: "'Agreya', serif" }}>
            ember.ai Registry
          </h2>
          <button
            onClick={onClose}
            className="w-[32px] h-[32px] rounded-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.15)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D66A3E]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1L11 11M11 1L1 11" stroke="#f9f3eb" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {/* Tab Selection */}
        <div className="flex px-6 mb-4 gap-2">
          <button
            onClick={() => setTab('mine')}
            className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D66A3E] ${
              tab === 'mine'
                ? 'bg-[rgba(214,106,62,0.15)] border-[rgba(214,106,62,0.4)] text-[#D66A3E]'
                : 'bg-transparent border-[rgba(255,255,255,0.06)] text-[#8a7f79] hover:text-[#e8e2dd]'
            }`}
          >
            My Journey
          </button>
          <button
            onClick={() => setTab('all')}
            className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D66A3E] ${
              tab === 'all'
                ? 'bg-[rgba(214,106,62,0.15)] border-[rgba(214,106,62,0.4)] text-[#D66A3E]'
                : 'bg-transparent border-[rgba(255,255,255,0.06)] text-[#8a7f79] hover:text-[#e8e2dd]'
            }`}
          >
            All Embers ({activeThoughtsCount})
          </button>
        </div>
        {/* Content list */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
          {sortedThoughts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 opacity-80">
              <Clock size={34} className="mb-4 text-[#8a7f79]" />
              <p className="text-[#e8e2dd] text-[16px]" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                {tab === 'mine' ? 'No history yet' : 'The sky is empty'}
              </p>
              <p className="text-[#8a7f79] text-[14px] mt-1 text-center" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                {tab === 'mine' 
                  ? 'Share a thought or reply to start your journey.' 
                  : 'Be the first to release an ember into the cosmos.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {sortedThoughts.map(t => {
                const isMine = t.authorId === userId;
                const myReplies = t.responses.filter(r => r.authorId === userId);
                return (
                  <div 
                    key={t.id} 
                    onClick={() => {
                      onClose();
                      onThoughtClick(t);
                    }}
                    className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.05)] rounded-[16px] p-5 cursor-pointer hover:bg-[rgba(255,255,255,0.08)] transition-colors group"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[#D66A3E] text-[11px] font-bold uppercase tracking-wider" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                        {isMine ? 'You Shared' : tab === 'all' && t.authorId === 'system' ? 'System' : myReplies.length > 0 ? 'You Responded' : 'Anonymous'}
                      </span>
                      <span className="text-[#8a7f79] text-[12px] group-hover:text-[#e8e2dd] transition-colors" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                        {new Date(t.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-[#f9f3eb] text-[16px] leading-relaxed mb-3 italic opacity-90 break-words [overflow-wrap:anywhere] line-clamp-3" style={{ fontFamily: "'Alegreya', serif" }}>
                      "{t.text}"
                    </p>
                    <div className="flex gap-4">
                      <span className="text-[#8a7f79] text-[12px] flex items-center gap-1" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                        <MessageCircle size={14} className="inline mr-1 text-[#8a7f79]" />{t.responses.length} total
                      </span>
                      {myReplies.length > 0 && (
                        <span className="text-[#D66A3E] opacity-90 text-[12px] flex items-center gap-1 font-medium" style={{ fontFamily: "'Alegreya Sans', sans-serif" }}>
                          ✓ Your replies: {myReplies.length}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
