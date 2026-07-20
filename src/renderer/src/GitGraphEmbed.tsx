import type { FileExplorerTarget } from "@shared/file-explorer-types";
import type { GitGraphOpenResult } from "@shared/api-types";
import { ExternalLink, GitGraph, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface GitGraphEmbedProps {
  target: FileExplorerTarget;
  targetLabel: string | null;
}

function targetKey(target: FileExplorerTarget): string {
  return `${target.kind}:${target.id}`;
}

/**
 * A hole in the layout the main-process WebContentsView fills. The renderer draws nothing where the
 * graph goes — it only measures this placeholder and forwards the rect so the native view lines up,
 * and shows status while the view is loading or when it fell back to an external window.
 */
export function GitGraphEmbed({ target, targetLabel }: GitGraphEmbedProps) {
  const holeRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | GitGraphOpenResult["mode"]>("loading");
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    const hole = holeRef.current;
    if (!hole) return;
    let disposed = false;

    const sendBounds = () => {
      const rect = hole.getBoundingClientRect();
      void window.multiCliWork.gitGraph.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    };

    const rect = hole.getBoundingClientRect();
    window.multiCliWork.gitGraph
      .open(target, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      .then((result) => {
        if (disposed) return;
        setStatus(result.mode);
        setReason(result.mode === "embedded" ? null : result.reason);
      })
      .catch((error) => {
        if (disposed) return;
        setStatus("unavailable");
        setReason(error instanceof Error ? error.message : String(error));
      });

    const observer = new ResizeObserver(sendBounds);
    observer.observe(hole);
    window.addEventListener("resize", sendBounds);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", sendBounds);
      void window.multiCliWork.gitGraph.close();
    };
  }, [targetKey(target)]);

  return (
    <section className="git-graph-embed" aria-label="Git Graph">
      {status === "loading" ? (
        <div className="git-graph-status">
          <RefreshCw className="spin" size={20} />
          <p>Git Graph를 여는 중…</p>
          <span>{targetLabel ?? ""}</span>
        </div>
      ) : status === "external" ? (
        <div className="git-graph-status">
          <ExternalLink size={20} />
          <p>외부 VS Code 창에서 Git Graph를 열었습니다</p>
          <span>앱 안에 임베드할 수 없어 대신 VS Code를 실행했습니다. ({reason})</span>
        </div>
      ) : status === "unavailable" ? (
        <div className="git-graph-status">
          <TriangleAlert size={20} />
          <p>Git Graph를 열 수 없습니다</p>
          <span>VS Code가 설치되어 있는지 확인하세요. ({reason})</span>
        </div>
      ) : (
        // Embedded: the native view covers this hole. The hint only shows in the brief moment before
        // the workbench paints, nudging first-time users to install the Git Graph extension.
        <div className="git-graph-status git-graph-hint">
          <GitGraph size={18} />
          <span>Git Graph 확장이 처음이라면 확장 탭에서 한 번 설치한 뒤 상태바의 “Git Graph”를 누르세요.</span>
        </div>
      )}
      {/* The native view sits on top of this hole; it must stay in the layout even when embedded. */}
      <div className="git-graph-hole" ref={holeRef} aria-hidden="true" />
    </section>
  );
}
