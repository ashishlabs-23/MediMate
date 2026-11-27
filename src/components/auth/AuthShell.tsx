import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';

interface AuthShellProps {
  children: ReactNode;
  label: string;
  onClose?: (() => void) | undefined;
}

export function AuthShell({ children, label, onClose }: AuthShellProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  function requestClose() {
    if (!onClose || isClosing) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, reducedMotion ? 0 : 180);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && onClose) {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <motion.div
      animate={{ opacity: isClosing ? 0 : 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.18 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-primary/40 px-0 backdrop-blur-md sm:px-4 md:items-center md:py-6"
    >
      <motion.section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        initial={reducedMotion ? false : { opacity: 0, scale: 0.95, y: 24 }}
        animate={
          isClosing
            ? { opacity: 0, scale: 0.95, y: 24 }
            : { opacity: 1, scale: 1, y: 0 }
        }
        transition={
          reducedMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 300, damping: 28 }
        }
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto overflow-x-hidden rounded-t-card border border-ink-muted/20 bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl sm:p-6 md:rounded-card md:pb-6 scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-2.5 mt-1 h-1 w-10 rounded-full bg-ink-muted/30 md:hidden"
        />
        {onClose && (
          <motion.button
            type="button"
            aria-label="Close dialog"
            onClick={requestClose}
            {...(!reducedMotion
              ? { whileHover: { y: -2 }, whileTap: { scale: 0.97 } }
              : {})}
            className="absolute right-3 top-3 inline-flex min-h-touch min-w-touch items-center justify-center rounded-btn text-ink-muted hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </motion.button>
        )}
        {children}
      </motion.section>
    </motion.div>
  );
}
