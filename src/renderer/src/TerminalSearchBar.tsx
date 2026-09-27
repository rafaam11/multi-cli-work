import { CaseSensitive, ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface TerminalSearchBarProps {
  /** Runs one step of the search and says whether anything matched. */
  onSearch(term: string, direction: "next" | "previous", caseSensitive: boolean): boolean;
  onClose(): void;
}

/**
 * Find-in-scrollback for one pane. It sits over the terminal's top-right corner, like an editor's
 * find widget, so the output being searched stays where it was. Enter goes forward, Shift+Enter
 * back, Escape closes and gives the keyboard back to the terminal.
 */
export function TerminalSearchBar({ onSearch, onClose }: TerminalSearchBarProps) {
  const field = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [missed, setMissed] = useState(false);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const step = (direction: "next" | "previous", sensitive = caseSensitive) => {
    if (!term) return;
    setMissed(!onSearch(term, direction, sensitive));
  };

  return (
    <div className="terminal-search" role="search" aria-label="터미널에서 찾기">
      <input
        ref={field}
        type="text"
        value={term}
        placeholder="찾기"
        aria-label="찾을 텍스트"
        spellCheck={false}
        onChange={(event) => {
          setTerm(event.target.value);
          setMissed(false);
        }}
        onKeyDown={(event) => {
          // Every key stays in this field — none of them may leak into the pane's terminal.
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            step(event.shiftKey ? "previous" : "next");
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      {missed ? <span className="terminal-search-status">결과 없음</span> : null}
      <button
        type="button"
        className={caseSensitive ? "active" : undefined}
        aria-label="대소문자 구분"
        aria-pressed={caseSensitive}
        title="대소문자 구분"
        onClick={() => setCaseSensitive((value) => !value)}
      >
        <CaseSensitive size={14} />
      </button>
      <button type="button" aria-label="이전 결과" title="이전 결과 (Shift+Enter)" onClick={() => step("previous")}>
        <ChevronUp size={14} />
      </button>
      <button type="button" aria-label="다음 결과" title="다음 결과 (Enter)" onClick={() => step("next")}>
        <ChevronDown size={14} />
      </button>
      <button type="button" aria-label="찾기 닫기" title="닫기 (Esc)" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}
