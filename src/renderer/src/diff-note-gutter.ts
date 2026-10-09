import type { editor as MonacoEditor } from "monaco-editor";
import { monaco } from "./monaco-setup";

export type DiffSide = "LEFT" | "RIGHT";

export interface GutterNote {
  side: DiffSide;
  line: number;
  body: string;
}

export interface DiffNoteGutter {
  /** Marks the lines that carry a note on each side. */
  setNotes(notes: readonly GutterNote[]): void;
  dispose(): void;
}

/**
 * Every Monaco call the diff notes make, in one place: the glyph margin on both sides, a click on it
 * or on a line number picking that line, and a mark on lines that already carry a note. Kept apart
 * from the pane so its tests mock this one module rather than Monaco's editor surface.
 */
export function attachDiffNoteGutter(
  diff: MonacoEditor.IStandaloneDiffEditor,
  onPick: (side: DiffSide, line: number, lineText: string) => void,
): DiffNoteGutter {
  const sides: Array<[DiffSide, MonacoEditor.ICodeEditor]> = [
    ["LEFT", diff.getOriginalEditor()],
    ["RIGHT", diff.getModifiedEditor()],
  ];
  const collections = new Map<DiffSide, MonacoEditor.IEditorDecorationsCollection>();
  const subscriptions = sides.map(([side, editor]) => {
    editor.updateOptions({ glyphMargin: true });
    collections.set(side, editor.createDecorationsCollection([]));
    return editor.onMouseDown((event) => {
      const { type, position } = event.target;
      if (type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
        return;
      }
      if (!position) return;
      onPick(side, position.lineNumber, editor.getModel()?.getLineContent(position.lineNumber) ?? "");
    });
  });

  return {
    setNotes(notes) {
      for (const [side] of sides) {
        collections.get(side)?.set(
          notes
            .filter((note) => note.side === side)
            .map((note) => ({
              range: new monaco.Range(note.line, 1, note.line, 1),
              options: {
                isWholeLine: true,
                className: "diff-note-line",
                glyphMarginClassName: "diff-note-glyph",
                glyphMarginHoverMessage: { value: note.body },
              },
            })),
        );
      }
    },
    dispose() {
      subscriptions.forEach((subscription) => subscription.dispose());
      collections.forEach((collection) => collection.clear());
    },
  };
}
