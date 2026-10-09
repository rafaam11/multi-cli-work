/** A note pinned to one line of a diff: PR review notes and local diff notes share this shape. */
export interface LineNote {
  path: string;
  /** LEFT is the old side (HEAD, or the PR base), RIGHT the new one. */
  side: "LEFT" | "RIGHT";
  line: number;
  lineText: string;
  body: string;
}

/** The notes as an agent reads them: where, the code there, and what is asked. */
export function formatLineNotes(notes: readonly LineNote[]): string {
  return notes
    .map((note, index) =>
      [`## Note ${index + 1} · ${note.path} · ${note.side}:${note.line}`, `코드: ${note.lineText || "(빈 줄)"}`, `요청: ${note.body}`].join(
        "\n",
      ),
    )
    .join("\n\n");
}

/** What the diff pane sends to a session of the same checkout. */
export function localDiffNotesPrompt(targetLabel: string, notes: readonly LineNote[]): string {
  return `다음은 Multi CLI Work의 변경 비교 화면에서 남긴 줄 메모입니다.

대상: ${targetLabel} (커밋 전 변경 — HEAD ↔ 작업 트리)

- 각 요청을 검토하고 필요한 코드를 수정한 뒤 관련 테스트를 실행하세요.
- line 번호가 아니라 경로, 코드 문맥, 요청 본문을 함께 근거로 사용하세요. LEFT는 HEAD 쪽, RIGHT는 작업 트리 쪽입니다.
- 완료 후 변경 파일과 테스트 결과를 터미널에 요약하세요.

${formatLineNotes(notes)}`;
}
