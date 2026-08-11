/**
 * Regenerates `src/renderer/src/file-icon-glyphs.tsx` from the `material-icon-theme` package.
 *
 *   npm run icons:extract
 *
 * The artwork is inlined rather than imported so the app carries no runtime dependency on the
 * theme: the package is a devDependency, and only the slugs listed below end up in the bundle.
 * Add a slug here and re-run after mapping a new extension or folder name in `file-icons.tsx`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICON_DIR = path.join(ROOT, "node_modules", "material-icon-theme", "icons");
const OUT_FILE = path.join(ROOT, "src", "renderer", "src", "file-icon-glyphs.tsx");

/** Language and file-kind glyphs. Keep in sync with the maps in `file-icons.tsx`. */
const FILE_SLUGS = [
  "audio", "c", "cmake", "console", "cpp", "css", "database", "docker", "document", "editorconfig",
  "eslint", "exe", "file", "font", "git", "go", "gradle", "graphql", "h", "html", "image", "java",
  "javascript", "json", "key", "less", "license", "lock", "log", "makefile", "markdown", "nodejs",
  "npm", "pdf", "php", "playwright", "powershell", "prettier", "python", "react", "react_ts",
  "readme", "rust", "sass", "settings", "svelte", "svg", "table", "test-js", "test-jsx", "test-ts",
  "toml", "tsconfig", "tune", "typescript", "typescript-def", "video", "vite", "vitest", "vue",
  "xml", "yaml", "zip",
];

/** Folder glyphs. Each one also brings its `-open` variant. */
const FOLDER_SLUGS = [
  "folder", "folder-api", "folder-client", "folder-components", "folder-config", "folder-context",
  "folder-css", "folder-database", "folder-dist", "folder-docs", "folder-examples", "folder-git",
  "folder-github", "folder-hook", "folder-images", "folder-lib", "folder-log", "folder-mock",
  "folder-node", "folder-packages", "folder-plugin", "folder-public", "folder-resource",
  "folder-scripts", "folder-server", "folder-shared", "folder-src", "folder-store", "folder-temp",
  "folder-test", "folder-tools", "folder-typescript", "folder-utils", "folder-vscode",
];

const SLUGS = [...new Set([...FILE_SLUGS, ...FOLDER_SLUGS.flatMap((slug) => [slug, `${slug}-open`])])].sort();

/** SVG attributes React spells differently. Anything else passes through as written. */
const ATTRIBUTE_NAMES = {
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "image-rendering": "imageRendering",
  "shape-rendering": "shapeRendering",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "stroke-dasharray": "strokeDasharray",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-width": "strokeWidth",
  "text-rendering": "textRendering",
  "xlink:href": "xlinkHref",
  "xml:space": "xmlSpace",
};

/** Dropped with the `<svg>` wrapper the glyph component supplies itself. */
const DROPPED_ATTRIBUTES = new Set(["xmlns", "xmlns:xlink"]);

/**
 * Every glyph lands in one document, so ids local to one icon would collide across icons. Both the
 * definition and the `#ref` that reaches it are prefixed with the slug.
 */
function namespaceIds(markup, slug) {
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);
  let next = markup;
  for (const id of new Set(ids)) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`(\\sid=")${escaped}(")`, "g"), `$1${slug}-${id}$2`);
    next = next.replace(new RegExp(`#${escaped}(?=["')])`, "g"), `#${slug}-${id}`);
  }
  return next;
}

function toJsxAttributes(markup) {
  return markup.replace(/\s([a-zA-Z][\w:.-]*)="([^"]*)"/g, (whole, name, value) => {
    if (DROPPED_ATTRIBUTES.has(name)) return "";
    const jsxName = ATTRIBUTE_NAMES[name] ?? name;
    if (jsxName !== name || /^[a-z]+$/i.test(name) || name.startsWith("data-")) {
      return ` ${jsxName}="${value}"`;
    }
    throw new Error(`Unmapped SVG attribute "${name}" in: ${whole}`);
  });
}

function readGlyph(slug) {
  const raw = readFileSync(path.join(ICON_DIR, `${slug}.svg`), "utf8").trim();
  const open = raw.match(/^<svg\b[^>]*>/);
  if (!open || !raw.endsWith("</svg>")) throw new Error(`${slug}.svg is not a single <svg> element`);
  const viewBox = open[0].match(/viewBox="([^"]+)"/);
  if (!viewBox) throw new Error(`${slug}.svg has no viewBox`);
  const inner = raw.slice(open[0].length, -"</svg>".length).trim();
  return { viewBox: viewBox[1], body: toJsxAttributes(namespaceIds(inner, slug)) };
}

const entries = SLUGS.map((slug) => ({ slug, ...readGlyph(slug) }));

const header = `/**
 * GENERATED FILE — do not edit by hand.
 * Run \`npm run icons:extract\` to rebuild it from the slug list in scripts/extract-file-icons.mjs.
 *
 * Artwork from Material Icon Theme (https://github.com/material-extensions/vscode-material-icon-theme),
 * MIT License, Copyright (c) 2016 Philipp Kief. Each glyph keeps its own fill colours — telling the
 * file types apart at a glance is the whole point, so nothing here recolours to currentColor.
 */
import type { ReactNode } from "react";

export interface IconGlyph {
  viewBox: string;
  body: ReactNode;
}

export const ICON_GLYPHS: Record<string, IconGlyph> = {
`;

const body = entries
  .map(({ slug, viewBox, body: markup }) =>
    `  ${JSON.stringify(slug)}: { viewBox: "${viewBox}", body: <>${markup}</> },\n`,
  )
  .join("");

mkdirSync(path.dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, `${header}${body}};\n`, "utf8");

console.log(`Wrote ${entries.length} glyphs to ${path.relative(ROOT, OUT_FILE)}`);
