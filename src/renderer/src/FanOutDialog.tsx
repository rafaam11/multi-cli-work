import { useState } from "react";
import { promptAsTerminalInput } from "@shared/fan-out";
import { MAX_FAN_OUT_TEMPLATE_NAME_LENGTH, type FanOutTemplate } from "@shared/settings-types";

export interface FanOutTargetOption {
  sessionId: string;
  label: string;
  /** Where the session runs: the worktree branch, or the project root. */
  detail: string;
}

interface FanOutDialogProps {
  projectName: string;
  targets: FanOutTargetOption[];
  /** Prompts saved for reuse ("테스트 돌려", "리뷰해"). Kept in settings.json. */
  templates?: readonly FanOutTemplate[];
  /** The whole list after a save or delete. */
  onSaveTemplates?(templates: FanOutTemplate[]): void;
  onSend(inputs: Array<{ sessionId: string; data: string }>): void;
  onClose(): void;
}

/**
 * One prompt to several agents at once — every send is an explicit button press over a visible
 * target list, because a shortcut that moves N agents in one keystroke is an accident machine.
 */
export function FanOutDialog({ projectName, targets, templates = [], onSaveTemplates, onSend, onClose }: FanOutDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [chosen, setChosen] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(targets.map((target) => target.sessionId)));

  const toggle = (sessionId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const sendable = prompt.trim().length > 0 && selected.size > 0;

  const saveTemplate = () => {
    const name = (naming ?? "").trim();
    if (!name || !onSaveTemplates) return;
    // A name already in the list is overwritten in place — saving twice is how a template is edited.
    const exists = templates.some((template) => template.name === name);
    onSaveTemplates(
      exists
        ? templates.map((template) => (template.name === name ? { name, text: prompt } : template))
        : [...templates, { name, text: prompt }],
    );
    setChosen(name);
    setNaming(null);
  };
  const send = () => {
    if (!sendable) return;
    const data = promptAsTerminalInput(prompt);
    onSend(targets.filter((target) => selected.has(target.sessionId)).map((target) => ({ sessionId: target.sessionId, data })));
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="confirm-dialog fan-out-dialog" role="dialog" aria-modal="true" aria-label="프롬프트 팬아웃">
        <h2>{projectName}의 세션에 같은 프롬프트 보내기</h2>
        {onSaveTemplates ? (
          <div className="fan-out-templates">
            {templates.length > 0 ? (
              <select
                aria-label="템플릿"
                value={chosen}
                onChange={(event) => {
                  const template = templates.find((candidate) => candidate.name === event.target.value);
                  setChosen(event.target.value);
                  if (template) setPrompt(template.text);
                }}
              >
                <option value="">템플릿 불러오기…</option>
                {templates.map((template) => (
                  <option key={template.name} value={template.name}>
                    {template.name}
                  </option>
                ))}
              </select>
            ) : null}
            {chosen ? (
              <button
                type="button"
                aria-label="템플릿 삭제"
                onClick={() => {
                  onSaveTemplates(templates.filter((template) => template.name !== chosen));
                  setChosen("");
                }}
              >
                삭제
              </button>
            ) : null}
            {naming === null ? (
              <button
                type="button"
                disabled={prompt.trim().length === 0}
                onClick={() => setNaming(chosen)}
              >
                템플릿으로 저장
              </button>
            ) : (
              <>
                <input
                  type="text"
                  aria-label="템플릿 이름"
                  placeholder="템플릿 이름"
                  maxLength={MAX_FAN_OUT_TEMPLATE_NAME_LENGTH}
                  autoFocus
                  value={naming}
                  onChange={(event) => setNaming(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      saveTemplate();
                    } else if (event.key === "Escape") {
                      event.stopPropagation();
                      setNaming(null);
                    }
                  }}
                />
                <button type="button" disabled={(naming ?? "").trim().length === 0} onClick={saveTemplate}>
                  저장
                </button>
              </>
            )}
          </div>
        ) : null}
        <textarea
          className="fan-out-prompt"
          aria-label="팬아웃 프롬프트"
          placeholder="모든 대상 세션에 전송할 프롬프트…"
          autoFocus
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        {targets.length === 0 ? (
          <p>보낼 수 있는 세션이 없습니다. 먼저 세션을 시작하세요.</p>
        ) : (
          <ul className="fan-out-targets" aria-label="대상 세션">
            {targets.map((target) => (
              <li key={target.sessionId}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(target.sessionId)}
                    onChange={() => toggle(target.sessionId)}
                  />
                  <span className="fan-out-target-label">{target.label}</span>
                  <span className="fan-out-target-detail">{target.detail}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <footer className="confirm-dialog-actions">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="button" disabled={!sendable} onClick={send}>
            {selected.size}개 세션에 전송
          </button>
        </footer>
      </div>
    </div>
  );
}
