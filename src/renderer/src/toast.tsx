import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CircleCheck, CircleX } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { motionDuration, motionEase } from "./motion-tokens";

export type ToastTone = "success" | "warning" | "error";

export interface ToastInput {
  tone: ToastTone;
  title: string;
  detail?: string;
  /** Clicking the toast does this, then dismisses it. */
  onSelect?(): void;
}

interface Toast extends ToastInput {
  id: number;
}

/** How long a toast stays when nobody looks at it. Hovering holds it. */
export const TOAST_MS = 4500;
/** More than this and the stack stops being glanceable; the oldest goes first. */
const MAX_TOASTS = 3;

/*
 * A module-level store rather than state in App: anything may raise a toast, and none of it should
 * have to be threaded a callback to do so. Sonner's shape, without its weight.
 */
let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: readonly Toast[]) {
  toasts = next;
  for (const listener of listeners) listener();
}

export function showToast(input: ToastInput): number {
  const id = nextId++;
  publish([...toasts, { ...input, id }].slice(-MAX_TOASTS));
  return id;
}

export function dismissToast(id: number) {
  if (toasts.some((toast) => toast.id === id)) publish(toasts.filter((toast) => toast.id !== id));
}

/** For tests: forget every toast between cases. */
export function resetToasts() {
  publish([]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ToastItem({ toast }: { toast: Toast }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => dismissToast(toast.id), TOAST_MS);
  };
  const hold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    arm();
    return hold;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Icon = toast.tone === "success" ? CircleCheck : toast.tone === "warning" ? AlertTriangle : CircleX;
  return (
    <motion.li
      layout="position"
      className={`toast toast-${toast.tone}`}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: motionDuration.slow, ease: motionEase.out }}
      onMouseEnter={hold}
      onMouseLeave={arm}
    >
      <button
        type="button"
        className="toast-body"
        onClick={() => {
          toast.onSelect?.();
          dismissToast(toast.id);
        }}
      >
        <Icon size={15} aria-hidden="true" />
        <span className="toast-copy">
          <span className="toast-title">{toast.title}</span>
          {toast.detail ? <span className="toast-detail">{toast.detail}</span> : null}
        </span>
      </button>
    </motion.li>
  );
}

/** The stack in the window's lower right. Polite: a finished turn is news, not an interruption. */
export function Toaster() {
  const current = useSyncExternalStore(subscribe, () => toasts);
  return (
    <ol className="toaster" aria-live="polite" aria-label="알림">
      <AnimatePresence initial={false}>
        {current.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </ol>
  );
}
