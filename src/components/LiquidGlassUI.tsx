import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, AlertTriangle, Info, MoveHorizontal } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

export const GlassPanel: React.FC<{
  children: React.ReactNode;
  className?: string;
  elevated?: boolean;
}> = ({ children, className = '', elevated = false }) => (
  <div className={`${elevated ? 'liquid-glass-elevated' : 'liquid-glass'} rounded-2xl ${className}`}>
    {children}
  </div>
);

export const GlassButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
  }
> = ({ children, variant = 'secondary', size = 'md', className = '', disabled, ...props }) => {
  const sizeStyles = {
    sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
    md: 'px-4 py-2 text-sm gap-2 rounded-xl',
    lg: 'px-5 py-2.5 text-sm gap-2.5 rounded-xl',
  }[size];

  const variantStyles = {
    primary:
      'bg-[#7AA7FF] text-[#08090D] font-semibold hover:bg-[#93B8FF] active:scale-[0.99] shadow-sm',
    secondary:
      'bg-white/[0.06] text-[#F5F5F7] border border-white/[0.1] hover:bg-white/[0.1] active:scale-[0.99]',
    ghost: 'bg-transparent text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.05]',
    danger:
      'bg-red-500/15 text-red-300 border border-red-400/25 hover:bg-red-500/25 active:scale-[0.99]',
  }[variant];

  return (
    <button
      disabled={disabled}
      className={`inline-flex items-center justify-center font-medium transition-all duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7AA7FF]/70 disabled:opacity-45 disabled:pointer-events-none cursor-pointer ${sizeStyles} ${variantStyles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

export const GlassModal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
}> = ({ open, onClose, title, subtitle, children, maxWidthClass = 'max-w-lg' }) => (
  <AnimatePresence>
    {open && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 8 }}
          transition={{ duration: 0.18 }}
          className={`relative z-10 w-full ${maxWidthClass} liquid-glass-elevated rounded-2xl p-6 shadow-2xl`}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-semibold text-[#F5F5F7]">{title}</h3>
              {subtitle && <p className="text-xs text-[#989BA6] mt-1">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close modal"
              className="p-1.5 rounded-lg text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.07] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {children}
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

export const ToastViewport: React.FC<{
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => (
  <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
    <AnimatePresence>
      {toasts.map((t) => (
        <motion.div
          key={t.id}
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.16 }}
          className="pointer-events-auto liquid-glass-elevated rounded-xl p-3.5 shadow-xl flex items-start gap-3"
        >
          {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-[#68D6A3] shrink-0 mt-0.5" />}
          {t.type === 'error' && <AlertTriangle className="w-4 h-4 text-[#E8BB75] shrink-0 mt-0.5" />}
          {t.type === 'info' && <Info className="w-4 h-4 text-[#7AA7FF] shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#F5F5F7]">{t.title}</p>
            {t.detail && <p className="text-xs text-[#989BA6] mt-0.5 leading-relaxed">{t.detail}</p>}
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
            className="text-[#989BA6] hover:text-[#F5F5F7] p-0.5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);

export const BeforeAfterComparison: React.FC<{
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
}> = ({ beforeUrl, afterUrl, beforeLabel = 'Previous Version', afterLabel = 'Refined Composite' }) => {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100));
    setPosition(pct);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={(e) => {
        if (e.buttons === 1) handleMove(e.clientX);
      }}
      onTouchMove={(e) => {
        if (e.touches[0]) handleMove(e.touches[0].clientX);
      }}
      onClick={(e) => handleMove(e.clientX)}
      className="relative w-full h-full select-none overflow-hidden rounded-xl cursor-ew-resize bg-white"
    >
      <img
        src={afterUrl}
        alt={afterLabel}
        referrerPolicy="no-referrer"
        className="w-full h-full object-contain pointer-events-none"
      />
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img
          src={beforeUrl}
          alt={beforeLabel}
          referrerPolicy="no-referrer"
          className="w-full h-full object-contain"
        />
      </div>

      {/* Divider Line */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-[#08090D]/80 shadow-md pointer-events-none"
        style={{ left: `${position}%` }}
      >
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[#181A22] border border-white/20 text-[#F5F5F7] flex items-center justify-center shadow-lg">
          <MoveHorizontal className="w-4 h-4" />
        </div>
      </div>

      <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-md bg-[#08090D]/75 text-[11px] text-[#F5F5F7] backdrop-blur-md pointer-events-none">
        {beforeLabel}
      </div>
      <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-md bg-[#08090D]/75 text-[11px] text-[#F5F5F7] backdrop-blur-md pointer-events-none">
        {afterLabel}
      </div>
    </div>
  );
};
