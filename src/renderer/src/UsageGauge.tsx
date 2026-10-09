import type { ProviderUsage, UsageSnapshot, UsageWindow } from "@shared/usage-types";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ClaudeCodeIcon, CodexIcon } from "./brand-icons";
import { ageText, gaugeLevel, resetText, windowLabel } from "./usage-format";

const PROVIDERS = [
  { id: "claude", name: "Claude", Icon: ClaudeCodeIcon },
  { id: "codex", name: "Codex", Icon: CodexIcon },
] as const;

/** A 100-unit ring: the dash length is the percentage itself, so it reads straight off the data. */
function UsageRing({ window }: { window: UsageWindow }) {
  const level = gaugeLevel(window.usedPercent);
  const value = Math.round(window.usedPercent * 10) / 10;
  return (
    <svg className="usage-ring" data-level={level} viewBox="0 0 36 36" width="16" height="16" aria-hidden="true">
      <circle className="usage-ring-track" cx="18" cy="18" r="15.9155" />
      <circle
        className="usage-ring-value"
        cx="18"
        cy="18"
        r="15.9155"
        strokeDasharray={`${value} 100`}
        transform="rotate(-90 18 18)"
      />
    </svg>
  );
}

function summary(name: string, usage: ProviderUsage): string {
  return `${name} ${usage.windows.map((window) => `${windowLabel(window.kind)} ${Math.round(window.usedPercent)}%`).join(" · ")}`;
}

/**
 * Subscription usage in the title bar: a small ring per limit window for Claude and Codex, green to
 * amber to red as it fills. Opening it asks for fresh figures and shows each window as a bar with
 * the time left until it resets.
 */
export function UsageGauge({ usage, onOpen }: { usage: UsageSnapshot; onOpen(): void }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = PROVIDERS.flatMap((provider) => {
    const figures = usage[provider.id];
    return figures && figures.windows.length > 0 ? [{ ...provider, usage: figures }] : [];
  });

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("mousedown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (shown.length === 0) return null;
  const label = `구독 사용량: ${shown.map((provider) => summary(provider.name, provider.usage)).join(", ")}`;

  return (
    <div className="usage-gauges" ref={rootRef}>
      <button
        type="button"
        className="usage-gauge-button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen();
          setOpen(!open);
        }}
      >
        {shown.map(({ id, Icon, usage: figures }) => (
          <span key={id} className="usage-provider">
            <Icon size={11} />
            {figures.windows.map((window) => (
              <UsageRing key={window.kind} window={window} />
            ))}
          </span>
        ))}
      </button>
      {open ? (
        <div className="usage-popover" role="dialog" aria-label="구독 사용량">
          {shown.map(({ id, name, Icon, usage: figures }) => (
            <section key={id} className="usage-section" role="region" aria-label={`${name} 사용량`}>
              <header className="usage-section-header">
                <Icon size={13} />
                <strong>{name}</strong>
                {figures.plan ? <span className="usage-plan">{figures.plan}</span> : null}
              </header>
              {figures.windows.map((window) => {
                const reset = resetText(window.resetsAt, now);
                return (
                  <div key={window.kind} className="usage-row">
                    <span className="usage-row-label">{windowLabel(window.kind)}</span>
                    <span className="usage-bar" data-level={gaugeLevel(window.usedPercent)}>
                      <span className="usage-bar-fill" style={{ width: `${window.usedPercent}%` }} />
                    </span>
                    <span className="usage-row-value">{Math.round(window.usedPercent)}%</span>
                    {reset ? <span className="usage-row-reset">{reset}</span> : null}
                  </div>
                );
              })}
              <footer className="usage-section-footer">{ageText(figures.updatedAt, now)}</footer>
            </section>
          ))}
          <button type="button" className="usage-refresh" onClick={onOpen}>
            <RefreshCw size={11} aria-hidden="true" />
            새로 읽기
          </button>
        </div>
      ) : null}
    </div>
  );
}
