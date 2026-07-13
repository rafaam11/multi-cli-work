import type { GitDiffResult } from "@shared/api-types";
import { X } from "lucide-react";
import { useMemo } from "react";
import { parseUnifiedDiff } from "./diff-parse";

interface DiffViewProps {
  /** What the diff is of, e.g. "Sample Project · feature/x". */
  title: string;
  result: GitDiffResult;
  onClose(): void;
}

/**
 * Read-only by design: comparing what parallel agents produced is this view's whole job. Staging,
 * commenting and merging stay in the tools that already do them well.
 */
export function DiffView({ title, result, onClose }: DiffViewProps) {
  const files = useMemo(() => parseUnifiedDiff(result.diff), [result.diff]);
  const empty = files.length === 0 && result.untracked.length === 0;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="diff-view" role="dialog" aria-modal="true" aria-label="변경 보기">
        <header className="diff-view-header">
          <h2>{title} 변경 사항</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="변경 보기 닫기">
            <X size={16} />
          </button>
        </header>
        <div className="diff-view-body">
          {!result.isRepo ? (
            <p className="detail-empty">Git 저장소가 아니거나 diff를 읽을 수 없습니다</p>
          ) : empty ? (
            <p className="detail-empty">변경 없음</p>
          ) : (
            <>
              {result.truncated ? (
                <p className="diff-truncated" role="status">
                  diff가 너무 커서 일부만 표시합니다
                </p>
              ) : null}
              {files.map((file) => (
                <details className="diff-file" key={file.path} open={files.length <= 8}>
                  <summary>{file.path}</summary>
                  <pre className="diff-lines">
                    {file.lines.map((line, index) => (
                      <span className={`diff-line diff-${line.kind}`} key={index}>
                        {line.text}
                        {"\n"}
                      </span>
                    ))}
                  </pre>
                </details>
              ))}
              {result.untracked.length > 0 ? (
                <section className="diff-untracked" aria-label="추적되지 않는 파일">
                  <h3>추적되지 않는 파일 {result.untracked.length}개</h3>
                  <ul>
                    {result.untracked.map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
