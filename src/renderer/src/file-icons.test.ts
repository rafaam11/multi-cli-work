import { describe, expect, it } from "vitest";
import { ICON_GLYPHS } from "./file-icon-glyphs";
import { fileIconSlug, folderIconSlug } from "./file-icons";

describe("fileIconSlug", () => {
  it("reads the extension when the name says nothing special", () => {
    expect(fileIconSlug("App.tsx", "tsx")).toBe("react_ts");
    expect(fileIconSlug("slot-view.ts", "ts")).toBe("typescript");
    expect(fileIconSlug("styles.scss", "scss")).toBe("sass");
    expect(fileIconSlug("photo.PNG", "png")).toBe("image");
  });

  it("lets an exact name win over its extension", () => {
    expect(fileIconSlug("package.json", "json")).toBe("npm");
    expect(fileIconSlug("settings.json", "json")).toBe("json");
    expect(fileIconSlug("yarn.lock", "lock")).toBe("lock");
  });

  it("recognises a config file whatever suffix the tool gave it", () => {
    expect(fileIconSlug("tsconfig.node.json", "json")).toBe("tsconfig");
    expect(fileIconSlug("electron.vite.config.ts", "ts")).toBe("vite");
    expect(fileIconSlug("vitest.config.mts", "mts")).toBe("vitest");
    expect(fileIconSlug(".env.local", null)).toBe("tune");
    expect(fileIconSlug("Dockerfile", null)).toBe("docker");
  });

  it("tells a test file from the module it tests, keeping tsx apart from ts", () => {
    expect(fileIconSlug("slot-view.test.ts", "ts")).toBe("test-ts");
    expect(fileIconSlug("App.test.tsx", "tsx")).toBe("test-jsx");
    expect(fileIconSlug("legacy.spec.js", "js")).toBe("test-js");
    expect(fileIconSlug("api-types.d.ts", "ts")).toBe("typescript-def");
  });

  it("has no slug for an extension nobody mapped", () => {
    expect(fileIconSlug("notes.qqq", "qqq")).toBeNull();
    expect(fileIconSlug("CHANGELOG", null)).toBeNull();
  });
});

describe("folderIconSlug", () => {
  it("names the folders worth telling apart, open or closed", () => {
    expect(folderIconSlug("src", false)).toBe("folder-src");
    expect(folderIconSlug("src", true)).toBe("folder-src-open");
    expect(folderIconSlug("node_modules", false)).toBe("folder-node");
    expect(folderIconSlug(".github", true)).toBe("folder-github-open");
  });

  it("falls back to a plain folder for a name it does not know", () => {
    expect(folderIconSlug("multi-cli-work", false)).toBe("folder");
    expect(folderIconSlug("multi-cli-work", true)).toBe("folder-open");
  });
});

describe("the generated glyph set", () => {
  it("holds every slug the maps can produce", () => {
    // The maps are hand-written and the glyphs are generated, so this is where the two meet.
    const names = [
      "package.json", "yarn.lock", "App.tsx", "main.ts", "index.html", "a.py", "a.go", "a.rs",
      "a.java", "a.c", "a.cpp", "a.h", "a.sh", "a.ps1", "a.sql", "a.yml", "a.toml", "a.xml",
      "a.ini", "a.svg", "a.png", "a.pdf", "a.zip", "a.exe", "a.ttf", "a.mp4", "a.mp3", "a.csv",
      "a.log", "a.pem", "a.txt", "a.graphql", "a.vue", "a.svelte", "a.php", "a.gradle", "a.less",
      "a.scss", "a.css", "a.md", "a.json", "a.js", "a.jsx", "a.d.ts", "a.test.ts", "a.test.tsx",
      "a.spec.js", "tsconfig.json", ".env", "vite.config.ts", "vitest.config.ts",
      "playwright.config.ts", ".eslintrc", ".prettierrc", "Dockerfile", "README.md", "LICENSE",
      "Makefile", "CMakeLists.txt", ".gitignore", ".editorconfig", ".nvmrc", "file",
    ];
    const missing = names
      .map((name) => fileIconSlug(name, name.includes(".") ? (name.split(".").pop() ?? null) : null))
      .filter((slug): slug is string => slug !== null)
      .filter((slug) => !(slug in ICON_GLYPHS));
    expect(missing).toEqual([]);
  });

  it("holds every folder slug, open and closed", () => {
    const folders = [
      "src", "test", "docs", "dist", "config", "public", "images", "components", "hooks", "utils",
      "scripts", "node_modules", ".github", ".vscode", "api", "server", "client", "database",
      "logs", "tmp", "lib", ".git", "mocks", "examples", "packages", "assets", "types", "store",
      "styles", "context", "plugins", "shared", "tools", "anything-else",
    ];
    const missing = folders
      .flatMap((name) => [folderIconSlug(name, false), folderIconSlug(name, true)])
      .filter((slug) => !(slug in ICON_GLYPHS));
    expect(missing).toEqual([]);
  });

  it("carries a viewBox and a body for every glyph", () => {
    for (const [slug, glyph] of Object.entries(ICON_GLYPHS)) {
      expect(glyph.viewBox, slug).toMatch(/^[\d\s-]+$/);
      expect(glyph.body, slug).toBeTruthy();
    }
  });
});
