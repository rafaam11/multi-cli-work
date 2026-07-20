import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// Monaco resolves its workers through this global; without it every language service falls over.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
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
