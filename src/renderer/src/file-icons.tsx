import { File, Folder, FolderOpen } from "lucide-react";
import { ICON_GLYPHS, type IconGlyph } from "./file-icon-glyphs";

/**
 * Which glyph a name gets. The artwork comes from Material Icon Theme (see file-icon-glyphs.tsx);
 * this module is the part we maintain — the tables saying that `.tsx` is React and that `src` is a
 * source folder. Every slug used here must exist in ICON_GLYPHS, which a unit test checks.
 */

/** Names that mean more than their extension does. */
const FILENAME_ICONS: Record<string, string> = {
  ".dockerignore": "docker",
  ".editorconfig": "editorconfig",
  ".gitattributes": "git",
  ".gitignore": "git",
  ".gitkeep": "git",
  ".gitmodules": "git",
  ".npmrc": "npm",
  ".nvmrc": "nodejs",
  "cargo.lock": "lock",
  "npm-shrinkwrap.json": "npm",
  "package-lock.json": "npm",
  "package.json": "npm",
  "pnpm-lock.yaml": "lock",
  "poetry.lock": "lock",
  "yarn.lock": "lock",
};

/**
 * Names a table cannot hold: a tool's config file carries the tool's name and any suffix it likes,
 * and a test file is named after the thing it tests. Checked in order, before the extension.
 */
const FILENAME_PATTERNS: [RegExp, string][] = [
  [/\.d\.[cm]?ts$/, "typescript-def"],
  [/\.(test|spec)\.[jt]sx$/, "test-jsx"],
  [/\.(test|spec)\.[cm]?ts$/, "test-ts"],
  [/\.(test|spec)\.[cm]?js$/, "test-js"],
  [/^tsconfig(\..+)?\.json$/, "tsconfig"],
  [/^\.env(\..+)?$/, "tune"],
  [/(^|\.)vite\.config\./, "vite"],
  [/^vitest\.config\./, "vitest"],
  [/^playwright\.config\./, "playwright"],
  [/^(\.eslintrc|eslint\.config)/, "eslint"],
  [/^(\.prettierrc|prettier\.config)/, "prettier"],
  [/^dockerfile/, "docker"],
  [/^docker-compose\./, "docker"],
  [/^readme/, "readme"],
  [/^licen[cs]e/, "license"],
  [/^makefile$/, "makefile"],
  [/^cmakelists\.txt$/, "cmake"],
];

const EXTENSION_ICONS: Record<string, string> = {
  avif: "image", bash: "console", bat: "console", bmp: "image", c: "c", cc: "cpp", cer: "key",
  cfg: "settings", cjs: "javascript", cmake: "cmake", cmd: "console", conf: "settings", cpp: "cpp",
  crt: "key", css: "css", csv: "table", cts: "typescript", cxx: "cpp", db: "database",
  deb: "exe", dll: "exe", eot: "font", exe: "exe", fish: "console", flac: "audio", gif: "image",
  gql: "graphql", gradle: "gradle", graphql: "graphql", gz: "zip", h: "h", hh: "h", hpp: "h",
  htm: "html", html: "html", ico: "image", ini: "settings", java: "java", jpeg: "image",
  jpg: "image", js: "javascript", json: "json", jsonc: "json", jsx: "react", key: "key",
  less: "less", lock: "lock", log: "log", m4a: "audio", markdown: "markdown", md: "markdown",
  mdx: "markdown", mjs: "javascript", mkv: "video", mov: "video", mp3: "audio", mp4: "video",
  msi: "exe", mts: "typescript", ogg: "audio", otf: "font", pdf: "pdf", pem: "key", pfx: "key",
  php: "php", png: "image", properties: "settings", ps1: "powershell", psd1: "powershell",
  psm1: "powershell", py: "python", pyw: "python", rar: "zip", rs: "rust", rtf: "document",
  sass: "sass", scss: "sass", sh: "console", sql: "database", sqlite: "database",
  sqlite3: "database", svelte: "svelte", svg: "svg", tar: "zip", toml: "toml", ts: "typescript",
  tsv: "table", tsx: "react_ts", ttf: "font", txt: "document", vue: "vue", wav: "audio",
  webm: "video", webp: "image", woff: "font", woff2: "font", xml: "xml", yaml: "yaml",
  yml: "yaml", zsh: "console", "7z": "zip",
};

/** Folder names worth telling apart. The `-open` variant is derived, never listed. */
const FOLDER_ICONS: Record<string, string> = {
  ".cache": "folder-temp",
  ".config": "folder-config",
  ".git": "folder-git",
  ".github": "folder-github",
  ".idea": "folder-vscode",
  ".vscode": "folder-vscode",
  "@types": "folder-typescript",
  __mocks__: "folder-mock",
  __tests__: "folder-test",
  api: "folder-api",
  assets: "folder-resource",
  backend: "folder-server",
  bin: "folder-scripts",
  build: "folder-dist",
  cache: "folder-temp",
  client: "folder-client",
  common: "folder-shared",
  component: "folder-components",
  components: "folder-components",
  config: "folder-config",
  configs: "folder-config",
  context: "folder-context",
  contexts: "folder-context",
  data: "folder-database",
  database: "folder-database",
  db: "folder-database",
  demo: "folder-examples",
  dist: "folder-dist",
  doc: "folder-docs",
  docs: "folder-docs",
  documentation: "folder-docs",
  e2e: "folder-test",
  example: "folder-examples",
  examples: "folder-examples",
  fixtures: "folder-mock",
  frontend: "folder-client",
  helpers: "folder-utils",
  hooks: "folder-hook",
  image: "folder-images",
  images: "folder-images",
  img: "folder-images",
  lib: "folder-lib",
  libs: "folder-lib",
  log: "folder-log",
  logs: "folder-log",
  main: "folder-server",
  mock: "folder-mock",
  mocks: "folder-mock",
  node_modules: "folder-node",
  out: "folder-dist",
  output: "folder-dist",
  packages: "folder-packages",
  plugin: "folder-plugin",
  plugins: "folder-plugin",
  providers: "folder-context",
  public: "folder-public",
  release: "folder-dist",
  renderer: "folder-client",
  resources: "folder-resource",
  samples: "folder-examples",
  script: "folder-scripts",
  scripts: "folder-scripts",
  server: "folder-server",
  shared: "folder-shared",
  source: "folder-src",
  spec: "folder-test",
  src: "folder-src",
  state: "folder-store",
  static: "folder-public",
  store: "folder-store",
  stores: "folder-store",
  style: "folder-css",
  styles: "folder-css",
  temp: "folder-temp",
  test: "folder-test",
  tests: "folder-test",
  tmp: "folder-temp",
  tooling: "folder-tools",
  tools: "folder-tools",
  types: "folder-typescript",
  typings: "folder-typescript",
  util: "folder-utils",
  utils: "folder-utils",
  vendor: "folder-lib",
};

/** The slug for a file, or null when nothing but the generic file glyph fits. */
export function fileIconSlug(name: string, extension: string | null): string | null {
  const key = name.toLocaleLowerCase("en-US");
  const exact = FILENAME_ICONS[key];
  if (exact) return exact;
  for (const [pattern, slug] of FILENAME_PATTERNS) {
    if (pattern.test(key)) return slug;
  }
  return (extension && EXTENSION_ICONS[extension]) ?? null;
}

/** The slug for a folder. Named folders keep their glyph open or closed. */
export function folderIconSlug(name: string, open: boolean): string {
  const named = FOLDER_ICONS[name.toLocaleLowerCase("en-US")] ?? "folder";
  return open ? `${named}-open` : named;
}

/**
 * One glyph at the requested size. The artwork carries its own colours — telling file types apart
 * at a glance is the point — so nothing here paints with currentColor.
 */
function Glyph({ glyph, size }: { glyph: IconGlyph; size: number }) {
  return (
    <svg
      className="file-icon"
      viewBox={glyph.viewBox}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {glyph.body}
    </svg>
  );
}

export interface FileIconProps {
  name: string;
  extension: string | null;
  size?: number;
}

export function FileIcon({ name, extension, size = 15 }: FileIconProps) {
  const slug = fileIconSlug(name, extension);
  const glyph = slug ? ICON_GLYPHS[slug] : undefined;
  // The generic glyph is itself part of the set; lucide only stands in if a slug ever goes missing.
  const fallback = ICON_GLYPHS.file;
  if (glyph) return <Glyph glyph={glyph} size={size} />;
  return fallback ? <Glyph glyph={fallback} size={size} /> : <File size={size} />;
}

export interface FolderIconProps {
  name: string;
  open: boolean;
  size?: number;
}

export function FolderIcon({ name, open, size = 15 }: FolderIconProps) {
  const glyph = ICON_GLYPHS[folderIconSlug(name, open)] ?? ICON_GLYPHS[open ? "folder-open" : "folder"];
  if (glyph) return <Glyph glyph={glyph} size={size} />;
  return open ? <FolderOpen size={size} /> : <Folder size={size} />;
}
