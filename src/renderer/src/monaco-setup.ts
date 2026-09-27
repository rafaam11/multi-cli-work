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

/** The same diff tints on the light theme's surfaces. */
monaco.editor.defineTheme("mcw-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#f7f8f7",
    "editorGutter.background": "#f7f8f7",
    "editor.lineHighlightBackground": "#e7ecea66",
    "diffEditor.insertedTextBackground": "#1b786733",
    "diffEditor.removedTextBackground": "#b33a3a2e",
    "diffEditor.insertedLineBackground": "#1b78671a",
    "diffEditor.removedLineBackground": "#b33a3a17",
  },
});

export function monacoThemeName(theme: "dark" | "light"): string {
  return theme === "light" ? "mcw-light" : "mcw-dark";
}

export { monaco };
