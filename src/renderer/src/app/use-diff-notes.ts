import { useCallback, useEffect, useState } from "react";
import {
  DIFF_NOTES_STORAGE_KEY,
  parseDiffNotes,
  pruneDiffNotes,
  serializeDiffNotes,
  type LocalDiffNote,
} from "./diff-notes";

export type NewDiffNote = Omit<LocalDiffNote, "id" | "status" | "createdAt" | "sentAt">;

function load(): LocalDiffNote[] {
  try {
    return pruneDiffNotes(parseDiffNotes(localStorage.getItem(DIFF_NOTES_STORAGE_KEY)), Date.now(), null);
  } catch {
    return [];
  }
}

/**
 * 변경 비교 화면의 줄 메모. 브라우저 저장소에만 산다(이 PC의 개인 메모다). `liveTargets`가 정해지면
 * 사라진 폴더·워크트리의 메모는 버린다 — null이면 아직 모르니 아무것도 버리지 않는다.
 */
export function useDiffNotes(liveTargets: ReadonlySet<string> | null) {
  const [notes, setNotes] = useState<LocalDiffNote[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(DIFF_NOTES_STORAGE_KEY, serializeDiffNotes(notes));
    } catch {
      // A private window or blocked storage: the notes still work for this session.
    }
  }, [notes]);

  const liveKey = liveTargets ? [...liveTargets].sort().join("|") : null;
  useEffect(() => {
    if (!liveTargets) return;
    setNotes((current) => {
      const next = pruneDiffNotes(current, Date.now(), liveTargets);
      return next.length === current.length ? current : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);

  const add = useCallback((input: NewDiffNote) => {
    setNotes((current) => [
      ...current,
      { ...input, id: crypto.randomUUID(), status: "draft", createdAt: Date.now(), sentAt: null },
    ]);
  }, []);
  const update = useCallback((id: string, body: string) => {
    setNotes((current) => current.map((note) => (note.id === id ? { ...note, body } : note)));
  }, []);
  const remove = useCallback((id: string) => {
    setNotes((current) => current.filter((note) => note.id !== id));
  }, []);
  const markSent = useCallback((ids: readonly string[]) => {
    const sent = new Set(ids);
    const now = Date.now();
    setNotes((current) => current.map((note) => (sent.has(note.id) ? { ...note, status: "sent", sentAt: now } : note)));
  }, []);

  return { notes, add, update, remove, markSent };
}
