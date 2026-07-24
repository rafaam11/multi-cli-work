import { useEffect, useMemo, useState } from "react";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree, WorktreeCreateOptions, WorktreeCreateRequest } from "@shared/worktree-types";
import { projectName } from "./session-labels";

interface WorktreeCreateDialogProps {
  project: SharedProject;
  onCreated(worktree: SharedWorktree): void;
  onClose(): void;
}

const EMPTY_OPTIONS: WorktreeCreateOptions = {
  localBranches: [], remoteBranches: [], checkedOutBranches: [], defaultStartPoint: "HEAD",
};

const shortRemoteBranch = (ref: string) => ref.includes("/") ? ref.slice(ref.indexOf("/") + 1) : ref;

/** Ref-based creation only: detached heads and arbitrary target paths are intentionally excluded. */
export function WorktreeCreateDialog({ project, onCreated, onClose }: WorktreeCreateDialogProps) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [branch, setBranch] = useState("");
  const [startPoint, setStartPoint] = useState("HEAD");
  const [selectedRef, setSelectedRef] = useState("");
  const [localBranch, setLocalBranch] = useState("");
  const [search, setSearch] = useState("");
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void window.multiCliWork.worktrees.creationOptions(project.id).then((value) => {
      if (!active) return;
      setOptions(value);
      setStartPoint(value.defaultStartPoint);
    }, (cause) => active && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => { active = false; };
  }, [project.id]);

  const refs = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [
      ...options.localBranches.map((name) => ({ kind: "local" as const, name })),
      ...options.remoteBranches.map((name) => ({ kind: "remote" as const, name })),
    ].filter((item) => !query || item.name.toLocaleLowerCase().includes(query));
  }, [options, search]);
  const selected = refs.find((item) => `${item.kind}:${item.name}` === selectedRef) ?? null;
  const targetBranch = mode === "new" ? branch.trim() : selected?.kind === "remote" ? localBranch.trim() : selected?.name ?? "";

  useEffect(() => {
    if (!targetBranch) { setPreviewPath(null); return; }
    let active = true;
    void window.multiCliWork.worktrees.previewPath(project.id, targetBranch).then(
      (value) => active && setPreviewPath(value), () => active && setPreviewPath(null),
    );
    return () => { active = false; };
  }, [project.id, targetBranch]);

  const submit = async () => {
    if (!targetBranch || pending) return;
    let request: WorktreeCreateRequest;
    if (mode === "new") request = { kind: "new", branch: targetBranch, startPoint };
    else if (selected?.kind === "local") request = { kind: "local", branch: selected.name };
    else if (selected?.kind === "remote") request = { kind: "remote", remoteRef: selected.name, localBranch: targetBranch };
    else return;
    setPending(true);
    setError(null);
    try { onCreated(await window.multiCliWork.worktrees.create(project.id, request)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setPending(false); }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="confirm-dialog worktree-create-dialog" role="dialog" aria-modal="true" aria-label="Worktree 만들기">
        <h2>{projectName(project)}에 worktree 만들기</h2>
        <div className="worktree-mode-tabs" role="tablist" aria-label="생성 방식">
          <button type="button" role="tab" aria-selected={mode === "new"} onClick={() => setMode("new")}>새 브랜치</button>
          <button type="button" role="tab" aria-selected={mode === "existing"} onClick={() => setMode("existing")}>기존 브랜치</button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {mode === "new" ? <>
            <label>브랜치 이름<input className="worktree-branch-input" aria-label="브랜치 이름" autoFocus value={branch} onChange={(event) => setBranch(event.target.value)} /></label>
            <label>기준 ref<select aria-label="기준 ref" value={startPoint} onChange={(event) => setStartPoint(event.target.value)}>
              {[options.defaultStartPoint, ...options.localBranches, ...options.remoteBranches].filter((value, index, all) => all.indexOf(value) === index).map((ref) => <option key={ref}>{ref}</option>)}
            </select></label>
          </> : <>
            <input aria-label="브랜치 검색" placeholder="로컬·원격 브랜치 검색" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
            <select aria-label="기존 브랜치" size={Math.min(7, Math.max(2, refs.length))} value={selectedRef} onChange={(event) => {
              const value = event.target.value; setSelectedRef(value);
              const ref = refs.find((item) => `${item.kind}:${item.name}` === value);
              if (ref?.kind === "remote") setLocalBranch(shortRemoteBranch(ref.name));
            }}>
              {refs.map((ref) => { const used = ref.kind === "local" && options.checkedOutBranches.includes(ref.name); return <option key={`${ref.kind}:${ref.name}`} value={`${ref.kind}:${ref.name}`} disabled={used}>{ref.kind === "local" ? "로컬" : "원격"} · {ref.name}{used ? " (사용 중)" : ""}</option>; })}
            </select>
            {selected?.kind === "remote" ? <label>로컬 브랜치 이름<input aria-label="로컬 브랜치 이름" value={localBranch} onChange={(event) => setLocalBranch(event.target.value)} /></label> : null}
          </>}
          {previewPath ? <p className="worktree-path-preview" title={previewPath}>생성 경로: {previewPath}</p> : null}
          {error ? <p className="detail-save-error" role="alert">{error}</p> : null}
          <footer className="confirm-dialog-actions"><button type="button" onClick={onClose}>취소</button><button type="submit" disabled={!targetBranch || pending}>{pending ? "만드는 중…" : "만들기"}</button></footer>
        </form>
      </div>
    </div>
  );
}
