import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// The app only renders read-only plaintext diffs, so one editor worker is the complete worker set.
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

/** vs-dark recolored to the app's own surfaces so the diff pane doesn't read as a foreign window. */
monaco.editor.defineTheme("mcw-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#161918",
    "editorGutter.background": "#161918",
    "editor.lineHighlightBackground": "#20252466",
    "diffEditor.insertedTextBackground": "#4fb7a422",
    "diffEditor.removedTextBackground": "#d46a6a22",
    "diffEditor.insertedLineBackground": "#4fb7a414",
    "diffEditor.removedLineBackground": "#d46a6a14",
  },
});

export { monaco };
