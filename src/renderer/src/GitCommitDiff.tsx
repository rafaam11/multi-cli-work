import type { GitCommitFileDiff } from "@shared/api-types";
import type { FileExplorerTarget } from "@shared/file-explorer-types";
import { FileWarning, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { monaco } from "./monaco-setup";

function key(target: FileExplorerTarget) { return `${target.kind}:${target.id}`; }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }

export function GitCommitDiff({ target, hash, path }: { target: FileExplorerTarget; hash: string; path: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [diff, setDiff] = useState<GitCommitFileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setDiff(null); setError(null);
    window.multiCliWork.gitGraph.fileDiff(target, hash, path).then((value) => !cancelled && setDiff(value), (cause) => !cancelled && setError(message(cause)));
    return () => { cancelled = true; };
  }, [key(target), hash, path]);
  useEffect(() => {
    if (!diff || diff.binary || !ref.current) return;
    const original = monaco.editor.createModel(diff.original, undefined, monaco.Uri.parse(`mcw-commit://${hash}/old/${encodeURIComponent(diff.oldPath ?? diff.path)}`));
    const modified = monaco.editor.createModel(diff.modified, undefined, monaco.Uri.parse(`mcw-commit://${hash}/new/${encodeURIComponent(diff.path)}`));
    const editor = monaco.editor.createDiffEditor(ref.current, { automaticLayout: true, readOnly: true, theme: "mcw-dark", minimap: { enabled: false }, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: false, renderOverviewRuler: false, scrollBeyondLastLine: false, fontSize: 12 });
    editor.setModel({ original, modified });
    return () => { editor.dispose(); original.dispose(); modified.dispose(); };
  }, [diff, hash]);
  if (error) return <div className="native-graph-inline-state"><TriangleAlert size={14} />{error}</div>;
  if (!diff) return <div className="native-graph-inline-state"><RefreshCw className="spin" size={14} />diff 불러오는 중</div>;
  if (diff.binary) return <div className="native-graph-inline-state"><FileWarning size={14} />바이너리 파일은 비교할 수 없습니다</div>;
  return <>{diff.truncated ? <div className="native-graph-warning">파일이 커서 일부만 표시합니다</div> : null}<div className="native-graph-diff" ref={ref} /></>;
}
