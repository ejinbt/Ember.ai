import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const slides = [
  {
    title: "Welcome to ember.ai",
    description: "When was the last time someone asked how you were doing and you actually told the truth?",
    showLogo: true,
  },
  {
    title: "The Weight.",
    description: "The internet punishes vulnerability. Profiles, metrics, and permanence make honesty feel too costly. So we carry our struggles alone.",
    showLogo: true,
  },
  {
    title: "The Sanctuary.",
    description: "ember.ai is a sky full of strangers who'll never know your name, but will always hold your moment. No profiles. No likes. Just warmth.",
    showLogo: true,
  }
];

// Variants for smooth, cinematic typography reveals
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.2,
    }
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.1,
      staggerDirection: -1,
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 30, filter: "blur(10px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: -20, filter: "blur(10px)", transition: { duration: 0.5, ease: "easeInOut" } }
};

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(prev => prev + 1);
    } else {
      onComplete();
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 1 } }}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#050308] overflow-hidden"
    >
      {/* Dynamic Ambient Background */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div 
          animate={{
            scale: [1, 1.2, 1],
            opacity: currentSlide === 0 ? 0.3 : currentSlide === 1 ? 0.1 : 0.4,
            background: currentSlide === 0 
              ? 'radial-gradient(circle at 50% 50%, rgba(214, 106, 62, 0.2) 0%, transparent 60%)' 
              : currentSlide === 1
              ? 'radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.15) 0%, transparent 60%)'
              : 'radial-gradient(circle at 50% 50%, rgba(244, 63, 94, 0.2) 0%, transparent 60%)'
          }}
          transition={{ duration: 4, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
          className="absolute inset-0"
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-4xl px-5 sm:px-8 relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentSlide}
            variants={containerVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            className="flex flex-col items-center text-center max-w-full"
          >
            {slides[currentSlide].showLogo && (
              <motion.div variants={itemVariants} className="mb-8 sm:mb-12 relative">
                <div className="absolute inset-0 bg-[#D66A3E]/20 rounded-full blur-3xl animate-pulse" />
                <img 
                  src="https://i.imgur.com/5nagvWz.png" 
                  alt="ember.ai logo" 
                  className="h-28 sm:h-44 w-auto object-contain relative z-10 drop-shadow-[0_0_25px_rgba(214,106,62,0.45)]"
                />
              </motion.div>
            )}

            {!slides[currentSlide].showLogo && (
              <motion.div variants={itemVariants} className="mb-6 sm:mb-8">
                <div className="w-16 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
              </motion.div>
            )}

            <motion.h1 
              variants={itemVariants}
              className="font-light text-white tracking-tight mb-5 sm:mb-8 max-w-full break-words"
              style={{ fontFamily: "Inter, sans-serif", fontSize: 'clamp(20px, 7vw, 64px)' }}
            >
              {slides[currentSlide].title}
            </motion.h1>
            
            <motion.p 
              variants={itemVariants}
              className="text-white/60 leading-relaxed max-w-2xl font-light break-words"
              style={{ fontSize: 'clamp(14px, 3.2vw, 22px)' }}
            >
              {slides[currentSlide].description}
            </motion.p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer Navigation */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1, duration: 1 }}
        className="w-full max-w-4xl px-5 sm:px-8 pb-8 sm:pb-16 flex items-center justify-between relative z-10"
      >
        <div className="flex space-x-2 sm:space-x-3">
          {slides.map((_, idx) => (
            <motion.div 
              key={idx} 
              animate={{
                width: idx === currentSlide ? 32 : 8,
                backgroundColor: idx === currentSlide ? "rgba(255,255,255,1)" : "rgba(255,255,255,0.2)"
              }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
              className="h-1 rounded-full"
            />
          ))}
        </div>
        
        <button
          onClick={handleNext}
          className="group relative px-6 sm:px-8 py-3 sm:py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full overflow-hidden transition-all duration-300 backdrop-blur-md active:scale-95 flex-shrink-0"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[#D66A3E]/0 via-[#D66A3E]/10 to-[#D66A3E]/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
          <span className="relative z-10 text-white font-medium tracking-wide text-sm sm:text-base whitespace-nowrap">
            {currentSlide === slides.length - 1 ? "Enter ember.ai" : "Continue"}
          </span>
        </button>
      </motion.div>
    </motion.div>
  );
}
