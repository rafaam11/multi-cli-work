import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface ConfirmRequest {
  title: string;
  /** Main's own explanation, e.g. why a review could not be verified. Shown as written. */
  message?: string;
  confirmLabel: string;
  /** Red confirm button — for choices that throw work away. */
  danger?: boolean;
}

interface Pending extends ConfirmRequest {
  resolve(confirmed: boolean): void;
}

/**
 * The in-app replacement for `window.confirm`. The native box blocked the renderer, looked nothing
 * like the app's other dialogs, and could not be driven by the keyboard map. `confirm` resolves once
 * the user chooses; Escape and a click outside count as 취소. A second request while one is open
 * cancels the first rather than stacking dialogs.
 */
export function useConfirmDialog(): { confirm(request: ConfirmRequest): Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(confirmed);
  }, []);

  const confirm = useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false);
        const next = { ...request, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );

  useEffect(() => {
    if (!pending) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") settle(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pending, settle]);

  // A pending promise must not outlive the component that asked.
  useEffect(() => () => pendingRef.current?.resolve(false), []);

  const dialog = pending ? (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) settle(false);
      }}
    >
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label={pending.title}>
        <h2>{pending.title}</h2>
        {pending.message ? <p className="confirm-dialog-message">{pending.message}</p> : null}
        <footer className="confirm-dialog-actions">
          <button type="button" onClick={() => settle(false)}>
            취소
          </button>
          <button
            type="button"
            className={pending.danger ? "danger-button" : undefined}
            autoFocus
            onClick={() => settle(true)}
          >
            {pending.confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
