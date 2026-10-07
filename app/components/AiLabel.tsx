import { Sparkles } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

export function AiLabel({ className = '' }: { className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 font-serif text-[11px] text-amber-300/80 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 cursor-help select-none ${className}`}
          >
            <Sparkles size={11} className="text-amber-400" />
            <span>✦ ember.ai (AI)</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="bg-stone-900 text-stone-200 text-xs border border-white/10 max-w-xs">
          <p>A gentle AI reply, sent when no one has answered yet.</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
