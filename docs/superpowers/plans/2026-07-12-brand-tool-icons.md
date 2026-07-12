# Brand tool icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic `lucide-react` stand-in icons for PowerShell, Claude Code, Codex, VS Code, and GitHub with each tool's real logo everywhere they appear in the app.

**Architecture:** Hand-author five inline SVG React components (no new npm dependency) in a new `brand-icons.tsx`, matching the `size`/`currentColor` API every existing `lucide-react` icon call site in this codebase already uses. Wire them into the existing `providerDetails` lookup table in `session-labels.ts` (which every provider-icon call site already reads through) plus two files that hardcode the VS Code/GitHub icons directly. Add three new CSS custom properties and three `.brand-icon-*` utility classes for a selective, subtle brand-color accent, applied only where an icon isn't already colored by session status.

**Tech Stack:** React 18 (`react-jsx` automatic runtime, no `import React` needed), TypeScript strict mode, Vitest + `@testing-library/react`, plain global CSS (`index.css`, BEM-ish class names, `--*` custom properties).

## Global Constraints

- Zero new npm dependencies — icon SVG path data is hand-copied from two MIT-licensed sources (verified in `docs/superpowers/specs/2026-07-12-brand-tool-icons-design.md`): [devicon](https://github.com/devicons/devicon) (PowerShell, VS Code, GitHub) and [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons) (Claude Code, Codex).
- Every new icon component's only props are `size?: number` and `className?: string` — this is the full set of props any existing call site in this codebase ever passes to an icon.
- Brand color values (exact, from the design doc): PowerShell `#5391fe`, VS Code `#007acc`, Claude Code `#d97757`. Codex and GitHub stay monochrome/`currentColor` — their own official marks are black/white, so no accent color exists for them.
- `ProjectSidebar.tsx`'s session-row icon must **not** receive a brand-accent class — its color is `--session-accent` (session status), and that must keep working unchanged.
- Vitest must be run with `--pool=threads` in a sandboxed shell (the default `forks` pool's child-process spawn is blocked there) — see the commands in each test step.

---

### Task 1: Create the brand icon components

**Files:**
- Create: `src/renderer/src/brand-icons.tsx`
- Test: `src/renderer/src/brand-icons.test.tsx`

**Interfaces:**
- Produces: `BrandIconProps` (`{ size?: number; className?: string }`) and five components — `PowerShellIcon`, `VSCodeIcon`, `GitHubIcon`, `ClaudeCodeIcon`, `CodexIcon` — each `(props: BrandIconProps) => JSX.Element`, rendering a single `<svg fill="currentColor">` sized by `size` (default `24`, matching `lucide-react`'s default) with `className` passed through onto the `<svg>`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/brand-icons.test.tsx`:

```tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeIcon, CodexIcon, GitHubIcon, PowerShellIcon, VSCodeIcon } from "./brand-icons";

afterEach(cleanup);

const icons = [
  { name: "PowerShell", Icon: PowerShellIcon },
  { name: "VS Code", Icon: VSCodeIcon },
  { name: "GitHub", Icon: GitHubIcon },
  { name: "Claude Code", Icon: ClaudeCodeIcon },
  { name: "Codex", Icon: CodexIcon },
];

describe("brand icons", () => {
  it.each(icons)("renders $name as an svg sized by the size prop", ({ Icon }) => {
    const { container } = render(<Icon size={18} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "18");
    expect(svg).toHaveAttribute("height", "18");
  });

  it.each(icons)("passes className through onto the svg for $name", ({ Icon }) => {
    const { container } = render(<Icon size={16} className="brand-icon-test" />);
    expect(container.querySelector("svg.brand-icon-test")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --pool=threads src/renderer/src/brand-icons.test.tsx`
Expected: FAIL — `Cannot find module './brand-icons'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/brand-icons.tsx`:

```tsx
export interface BrandIconProps {
  size?: number;
  className?: string;
}

export function PowerShellIcon({ size = 24, className }: BrandIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 128 128" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M124.912 19.358c-.962-1.199-2.422-1.858-4.111-1.858h-92.61c-3.397 0-6.665 2.642-7.444 6.015L2.162 104.022c-.396 1.711-.058 3.394.926 4.619.963 1.199 2.423 1.858 4.111 1.858v.001H99.81c3.396 0 6.665-2.643 7.443-6.016l18.586-80.508c.395-1.711.057-3.395-.927-4.618zm-98.589 77.17c-1.743-2.397-1.323-5.673.94-7.318l37.379-27.067v-.556L41.157 36.603c-1.916-2.038-1.716-5.333.445-7.361 2.162-2.027 5.466-2.019 7.382.019l28.18 29.979c1.6 1.702 1.718 4.279.457 6.264-.384.774-1.182 1.628-2.593 2.618l-41.45 29.769c-2.263 1.644-5.512 1.034-7.255-1.363zm59.543.538H63.532c-2.597 0-4.702-2.082-4.702-4.65s2.105-4.65 4.702-4.65h22.333c2.597 0 4.702 2.082 4.702 4.65s-2.104 4.65-4.701 4.65z"
      />
    </svg>
  );
}

export function VSCodeIcon({ size = 24, className }: BrandIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 128 128" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M90.767 127.126a7.968 7.968 0 0 0 6.35-.244l26.353-12.681a8 8 0 0 0 4.53-7.209V21.009a8 8 0 0 0-4.53-7.21L97.117 1.12a7.97 7.97 0 0 0-9.093 1.548l-50.45 46.026L15.6 32.013a5.328 5.328 0 0 0-6.807.302l-7.048 6.411a5.335 5.335 0 0 0-.006 7.888L20.796 64 1.74 81.387a5.336 5.336 0 0 0 .006 7.887l7.048 6.411a5.327 5.327 0 0 0 6.807.303l21.974-16.68 50.45 46.025a7.96 7.96 0 0 0 2.743 1.793Zm5.252-92.183L57.74 64l38.28 29.058V34.943Z"
      />
    </svg>
  );
}

export function GitHubIcon({ size = 24, className }: BrandIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 128 128" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M64 5.103c-33.347 0-60.388 27.035-60.388 60.388 0 26.682 17.303 49.317 41.297 57.303 3.017.56 4.125-1.31 4.125-2.905 0-1.44-.056-6.197-.082-11.243-16.8 3.653-20.345-7.125-20.345-7.125-2.747-6.98-6.705-8.836-6.705-8.836-5.48-3.748.413-3.67.413-3.67 6.063.425 9.257 6.223 9.257 6.223 5.386 9.23 14.127 6.562 17.573 5.02.542-3.903 2.107-6.568 3.834-8.076-13.413-1.525-27.514-6.704-27.514-29.843 0-6.593 2.36-11.98 6.223-16.21-.628-1.52-2.695-7.662.584-15.98 0 0 5.07-1.623 16.61 6.19C53.7 35 58.867 34.327 64 34.304c5.13.023 10.3.694 15.127 2.033 11.526-7.813 16.59-6.19 16.59-6.19 3.287 8.317 1.22 14.46.593 15.98 3.872 4.23 6.215 9.617 6.215 16.21 0 23.194-14.127 28.3-27.574 29.796 2.167 1.874 4.097 5.55 4.097 11.183 0 8.08-.07 14.583-.07 16.572 0 1.607 1.088 3.49 4.148 2.897 23.98-7.994 41.263-30.622 41.263-57.294C124.388 32.14 97.35 5.104 64 5.104z"
      />
      <path d="M26.484 91.806c-.133.3-.605.39-1.035.185-.44-.196-.685-.605-.543-.906.13-.31.603-.395 1.04-.188.44.197.69.61.537.91zm2.446 2.729c-.287.267-.85.143-1.232-.28-.396-.42-.47-.983-.177-1.254.298-.266.844-.14 1.24.28.394.426.472.984.17 1.255zM31.312 98.012c-.37.258-.976.017-1.35-.52-.37-.538-.37-1.183.01-1.44.373-.258.97-.025 1.35.507.368.545.368 1.19-.01 1.452zm3.261 3.361c-.33.365-1.036.267-1.552-.23-.527-.487-.674-1.18-.343-1.544.336-.366 1.045-.264 1.564.23.527.486.686 1.18.333 1.543zm4.5 1.951c-.147.473-.825.688-1.51.486-.683-.207-1.13-.76-.99-1.238.14-.477.823-.7 1.512-.485.683.206 1.13.756.988 1.237zm4.943.361c.017.498-.563.91-1.28.92-.723.017-1.308-.387-1.315-.877 0-.503.568-.91 1.29-.924.717-.013 1.306.387 1.306.88zm4.598-.782c.086.485-.413.984-1.126 1.117-.7.13-1.35-.172-1.44-.653-.086-.498.422-.997 1.122-1.126.714-.123 1.354.17 1.444.663z"
      />
    </svg>
  );
}

export function ClaudeCodeIcon({ size = 24, className }: BrandIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
      />
    </svg>
  );
}

export function CodexIcon({ size = 24, className }: BrandIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"
      />
    </svg>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --pool=threads src/renderer/src/brand-icons.test.tsx`
Expected: PASS (10 tests: 5 icons × 2 assertions each)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/brand-icons.tsx src/renderer/src/brand-icons.test.tsx
git commit -m "feat: add PowerShell, VS Code, GitHub, Claude Code, and Codex brand icons"
```

---

### Task 2: Wire the brand icons into `providerDetails` and add the accent-class map

**Files:**
- Modify: `src/renderer/src/session-labels.ts:1-10`

**Interfaces:**
- Consumes: `PowerShellIcon`, `ClaudeCodeIcon`, `CodexIcon` from Task 1's `./brand-icons`.
- Produces: exported `IconComponent` type (`(props: { size?: number; className?: string }) => JSX.Element`); `providerDetails.icon` now typed `IconComponent` (was `typeof TerminalIcon` from `lucide-react`); new exported `providerAccentClass: Partial<Record<TerminalKind, string>>` (`{ powershell: "brand-icon-powershell", claude: "brand-icon-claude" }` — `codex` intentionally omitted, stays monochrome).

- [ ] **Step 1: Replace the lucide import and `providerDetails` block**

In `src/renderer/src/session-labels.ts`, replace lines 1-10:

```ts
import type { TerminalSessionView, UpdaterStatus } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalKind, TerminalStatus, ToolCommand } from "@shared/terminal-types";
import { Bot, Code2, Terminal as TerminalIcon } from "lucide-react";

export const providerDetails: Record<TerminalKind, { label: string; menuLabel: string; icon: typeof TerminalIcon }> = {
  powershell: { label: "PowerShell", menuLabel: "새 PowerShell 세션", icon: TerminalIcon },
  claude: { label: "Claude Code", menuLabel: "새 Claude Code 세션", icon: Bot },
  codex: { label: "Codex", menuLabel: "새 Codex 세션", icon: Code2 },
};
```

with:

```ts
import type { TerminalSessionView, UpdaterStatus } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalKind, TerminalStatus, ToolCommand } from "@shared/terminal-types";
import { ClaudeCodeIcon, CodexIcon, PowerShellIcon } from "./brand-icons";

export type IconComponent = (props: { size?: number; className?: string }) => JSX.Element;

export const providerDetails: Record<TerminalKind, { label: string; menuLabel: string; icon: IconComponent }> = {
  powershell: { label: "PowerShell", menuLabel: "새 PowerShell 세션", icon: PowerShellIcon },
  claude: { label: "Claude Code", menuLabel: "새 Claude Code 세션", icon: ClaudeCodeIcon },
  codex: { label: "Codex", menuLabel: "새 Codex 세션", icon: CodexIcon },
};

/**
 * Brand-accent CSS class for a provider's icon. Only applied at static call sites — session rows
 * in ProjectSidebar.tsx color their icon by session status instead, so they never use this.
 */
export const providerAccentClass: Partial<Record<TerminalKind, string>> = {
  powershell: "brand-icon-powershell",
  claude: "brand-icon-claude",
};
```

This is a data-rewiring change with no new observable behavior of its own (the observable behavior — which icon shows where — is exercised by the consuming components in Tasks 4-8), so there is no meaningful failing test to write first here. Verify instead by running the existing tests that already render through this module, plus typecheck.

- [ ] **Step 2: Run the existing tests that render provider icons through this module**

Run: `npx vitest run --pool=threads src/renderer/src/HomeDashboard.test.tsx src/renderer/src/ProjectDetailPage.test.tsx`
Expected: PASS — these tests query by accessible name/role/text, not icon internals, so the shape swap doesn't change their outcome.

- [ ] **Step 3: Run typecheck to confirm the whole app still compiles**

Run: `npm run typecheck`
Expected: PASS — in particular this confirms `IconComponent` is structurally compatible with every existing `<ProviderIcon size={N} />` call site.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/session-labels.ts
git commit -m "feat: swap provider icons to brand marks and add an accent-class map"
```

---

### Task 3: Add brand color tokens and utility classes

**Files:**
- Modify: `src/renderer/src/index.css:1-22`

**Interfaces:**
- Produces: CSS custom properties `--brand-powershell`, `--brand-vscode`, `--brand-claude`; classes `.brand-icon-powershell`, `.brand-icon-vscode`, `.brand-icon-claude`, each setting `color` to the matching variable (read by the SVGs' `fill="currentColor"` from Task 1).

- [ ] **Step 1: Add the tokens and utility classes**

In `src/renderer/src/index.css`, replace:

```css
  --teal: #4fb7a4;
  --amber: #d8a24a;
  --blue: #6ea8d8;
  --red: #d46a6a;
  --green: #73b987;
  --violet: #aa8ccc;
}
```

with:

```css
  --teal: #4fb7a4;
  --amber: #d8a24a;
  --blue: #6ea8d8;
  --red: #d46a6a;
  --green: #73b987;
  --violet: #aa8ccc;
  --brand-powershell: #5391fe;
  --brand-vscode: #007acc;
  --brand-claude: #d97757;
}

.brand-icon-powershell {
  color: var(--brand-powershell);
}

.brand-icon-vscode {
  color: var(--brand-vscode);
}

.brand-icon-claude {
  color: var(--brand-claude);
}
```

- [ ] **Step 2: Verify the file still parses as valid CSS**

No call site references these classes yet (that starts in Task 4), so there is nothing to render-test here. Run typecheck as a smoke check that the build pipeline as a whole is still healthy:

Run: `npm run typecheck`
Expected: PASS (this task doesn't touch any `.ts`/`.tsx` file, so this should be a no-op pass — it exists to catch an accidental syntax error breaking the Vite CSS import elsewhere would surface at build time, checked in Task 8).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/index.css
git commit -m "feat: add brand-accent color tokens for PowerShell/VS Code/Claude icons"
```

---

### Task 4: Apply the accent class in `WorkspaceHeader.tsx`'s launcher row

**Files:**
- Modify: `src/renderer/src/WorkspaceHeader.tsx:6`, `:152-175`

**Interfaces:**
- Consumes: `providerAccentClass` from Task 2's `./session-labels`.

- [ ] **Step 1: Import `providerAccentClass`**

In `src/renderer/src/WorkspaceHeader.tsx`, replace line 6:

```ts
import { projectName, providerDetails, statusLabels, toolDetails } from "./session-labels";
```

with:

```ts
import { projectName, providerAccentClass, providerDetails, statusLabels, toolDetails } from "./session-labels";
```

- [ ] **Step 2: Pass the accent class to the launcher icon**

Replace (lines 150-177):

```tsx
        {selectedProject ? (
          <div className="launcher-row">
            {TERMINAL_KINDS.map((kind) => {
              const details = providerDetails[kind];
              const ProviderIcon = details.icon;
              return (
                <button
                  key={kind}
                  className="launcher-button"
                  type="button"
                  disabled={!canLaunch || !availability[kind]}
                  onClick={() => onStartSession(kind)}
                  aria-label={details.menuLabel}
                  title={
                    !availability[kind]
                      ? `${details.label} 미설치`
                      : projectMissing
                        ? "세션을 시작하려면 먼저 폴더를 다시 연결하세요"
                        : details.menuLabel
                  }
                >
                  <ProviderIcon size={15} />
                  <span>{details.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
```

with:

```tsx
        {selectedProject ? (
          <div className="launcher-row">
            {TERMINAL_KINDS.map((kind) => {
              const details = providerDetails[kind];
              const ProviderIcon = details.icon;
              return (
                <button
                  key={kind}
                  className="launcher-button"
                  type="button"
                  disabled={!canLaunch || !availability[kind]}
                  onClick={() => onStartSession(kind)}
                  aria-label={details.menuLabel}
                  title={
                    !availability[kind]
                      ? `${details.label} 미설치`
                      : projectMissing
                        ? "세션을 시작하려면 먼저 폴더를 다시 연결하세요"
                        : details.menuLabel
                  }
                >
                  <ProviderIcon size={15} className={providerAccentClass[kind]} />
                  <span>{details.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/WorkspaceHeader.tsx
git commit -m "feat: accent the workspace launcher icons with brand colors"
```

---

### Task 5: Update `ProjectDetailPage.tsx` — launcher row accent + VS Code/GitHub icons

**Files:**
- Modify: `src/renderer/src/ProjectDetailPage.tsx:4-6`, `:168-185`, `:218-230`

**Interfaces:**
- Consumes: `VSCodeIcon`, `GitHubIcon` from Task 1's `./brand-icons`; `providerAccentClass` from Task 2's `./session-labels`.

- [ ] **Step 1: Swap the lucide import and add `providerAccentClass`**

Replace lines 4-6:

```ts
import { Code2, ExternalLink, FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { projectName, providerDetails, relativeTime, sessionLabel, statusLabels } from "./session-labels";
```

with:

```ts
import { FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { GitHubIcon, VSCodeIcon } from "./brand-icons";
import { projectName, providerAccentClass, providerDetails, relativeTime, sessionLabel, statusLabels } from "./session-labels";
```

- [ ] **Step 2: Accent the empty-state session launcher icons**

Replace lines 168-185:

```tsx
              <div className="detail-launcher-row">
                {TERMINAL_KINDS.map((kind) => {
                  const details = providerDetails[kind];
                  const Icon = details.icon;
                  return (
                    <button
                      key={kind}
                      type="button"
                      disabled={!availability[kind] || pendingAction}
                      onClick={() => onStartSession(kind)}
                      aria-label={`${details.label} 세션 시작`}
                    >
                      <Icon size={15} />
                      <span>{details.label}</span>
                    </button>
                  );
                })}
              </div>
```

with:

```tsx
              <div className="detail-launcher-row">
                {TERMINAL_KINDS.map((kind) => {
                  const details = providerDetails[kind];
                  const Icon = details.icon;
                  return (
                    <button
                      key={kind}
                      type="button"
                      disabled={!availability[kind] || pendingAction}
                      onClick={() => onStartSession(kind)}
                      aria-label={`${details.label} 세션 시작`}
                    >
                      <Icon size={15} className={providerAccentClass[kind]} />
                      <span>{details.label}</span>
                    </button>
                  );
                })}
              </div>
```

- [ ] **Step 3: Swap the VS Code / GitHub buttons' icons**

Replace lines 218-230:

```tsx
            <button
              type="button"
              disabled={!availability.vscode}
              title={availability.vscode ? undefined : "PATH에서 VS Code를 찾을 수 없습니다"}
              onClick={onOpenInEditor}
            >
              <Code2 size={14} />
              <span>VS Code에서 열기</span>
            </button>
            <button type="button" onClick={onOpenOnGitHub}>
              <ExternalLink size={14} />
              <span>GitHub에서 열기</span>
            </button>
```

with:

```tsx
            <button
              type="button"
              disabled={!availability.vscode}
              title={availability.vscode ? undefined : "PATH에서 VS Code를 찾을 수 없습니다"}
              onClick={onOpenInEditor}
            >
              <VSCodeIcon size={14} className="brand-icon-vscode" />
              <span>VS Code에서 열기</span>
            </button>
            <button type="button" onClick={onOpenOnGitHub}>
              <GitHubIcon size={14} />
              <span>GitHub에서 열기</span>
            </button>
```

- [ ] **Step 4: Run the existing component test**

Run: `npx vitest run --pool=threads src/renderer/src/ProjectDetailPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/ProjectDetailPage.tsx
git commit -m "feat: use brand icons for the project-detail launcher, VS Code, and GitHub buttons"
```

---

### Task 6: Update `ProjectContextMenu.tsx` — VS Code/GitHub icons

**Files:**
- Modify: `src/renderer/src/ProjectContextMenu.tsx:1`, `:63-76`

**Interfaces:**
- Consumes: `VSCodeIcon`, `GitHubIcon` from Task 1's `./brand-icons`.

- [ ] **Step 1: Swap the import**

Replace line 1:

```ts
import { Code2, ExternalLink, FolderOpen, Pencil, Trash2 } from "lucide-react";
```

with:

```ts
import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import { GitHubIcon, VSCodeIcon } from "./brand-icons";
```

- [ ] **Step 2: Swap the menu item icons**

Replace lines 63-76:

```tsx
      <button
        type="button"
        role="menuitem"
        disabled={!vscodeAvailable}
        title={vscodeAvailable ? undefined : "PATH에서 VS Code를 찾을 수 없습니다"}
        onClick={run(onOpenInEditor)}
      >
        <Code2 size={15} />
        <span>VS Code에서 열기</span>
      </button>
      <button type="button" role="menuitem" onClick={run(onOpenOnGitHub)}>
        <ExternalLink size={15} />
        <span>GitHub에서 열기</span>
      </button>
```

with:

```tsx
      <button
        type="button"
        role="menuitem"
        disabled={!vscodeAvailable}
        title={vscodeAvailable ? undefined : "PATH에서 VS Code를 찾을 수 없습니다"}
        onClick={run(onOpenInEditor)}
      >
        <VSCodeIcon size={15} className="brand-icon-vscode" />
        <span>VS Code에서 열기</span>
      </button>
      <button type="button" role="menuitem" onClick={run(onOpenOnGitHub)}>
        <GitHubIcon size={15} />
        <span>GitHub에서 열기</span>
      </button>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/ProjectContextMenu.tsx
git commit -m "feat: use brand icons for VS Code/GitHub in the project context menu"
```

---

### Task 7: Update `HomeDashboard.tsx` — CLI status, quick launch, and GitHub buttons

**Files:**
- Modify: `src/renderer/src/HomeDashboard.tsx:4-14`, `:141-153`, `:190-207`, `:256-264`

**Interfaces:**
- Consumes: `GitHubIcon` from Task 1's `./brand-icons`; `providerAccentClass` from Task 2's `./session-labels`.

- [ ] **Step 1: Swap the import**

Replace lines 4-14:

```ts
import { Clock, ExternalLink, Info, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import {
  projectName,
  providerDetails,
  relativeTime,
  sessionLabel,
  statusLabels,
  toolDetails,
  updaterStatusLabel,
} from "./session-labels";
```

with:

```ts
import { Clock, Info, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { GitHubIcon } from "./brand-icons";
import {
  projectName,
  providerAccentClass,
  providerDetails,
  relativeTime,
  sessionLabel,
  statusLabels,
  toolDetails,
  updaterStatusLabel,
} from "./session-labels";
```

- [ ] **Step 2: Accent the CLI status list icons**

Replace lines 141-153:

```tsx
          <ul className="cli-status-list">
            {TERMINAL_KINDS.map((kind) => {
              const details = providerDetails[kind];
              const Icon = details.icon;
              return (
                <li key={kind} className={availability[kind] ? "installed" : "missing"}>
                  <Icon size={14} />
                  <span>{details.label}</span>
                  <span className="cli-status-value">{availability[kind] ? "설치됨" : "찾을 수 없음"}</span>
                </li>
              );
            })}
          </ul>
```

with:

```tsx
          <ul className="cli-status-list">
            {TERMINAL_KINDS.map((kind) => {
              const details = providerDetails[kind];
              const Icon = details.icon;
              return (
                <li key={kind} className={availability[kind] ? "installed" : "missing"}>
                  <Icon size={14} className={providerAccentClass[kind]} />
                  <span>{details.label}</span>
                  <span className="cli-status-value">{availability[kind] ? "설치됨" : "찾을 수 없음"}</span>
                </li>
              );
            })}
          </ul>
```

- [ ] **Step 3: Accent the quick-launch icon buttons**

Replace lines 190-207:

```tsx
                  <span className="quick-launch-actions">
                    {TERMINAL_KINDS.map((kind) => {
                      const details = providerDetails[kind];
                      const Icon = details.icon;
                      return (
                        <button
                          key={kind}
                          type="button"
                          disabled={!availability[kind] || pendingAction}
                          title={details.menuLabel}
                          aria-label={`${projectName(project)}에서 ${details.label} 시작`}
                          onClick={() => onStartSession(project, kind)}
                        >
                          <Icon size={13} />
                        </button>
                      );
                    })}
                  </span>
```

with:

```tsx
                  <span className="quick-launch-actions">
                    {TERMINAL_KINDS.map((kind) => {
                      const details = providerDetails[kind];
                      const Icon = details.icon;
                      return (
                        <button
                          key={kind}
                          type="button"
                          disabled={!availability[kind] || pendingAction}
                          title={details.menuLabel}
                          aria-label={`${projectName(project)}에서 ${details.label} 시작`}
                          onClick={() => onStartSession(project, kind)}
                        >
                          <Icon size={13} className={providerAccentClass[kind]} />
                        </button>
                      );
                    })}
                  </span>
```

- [ ] **Step 4: Swap the release-notes/repository buttons to the GitHub icon**

Replace lines 256-264:

```tsx
          <div className="app-shortcut-row">
            <button type="button" onClick={() => void window.multiCliWork.updates.openReleases()}>
              <ExternalLink size={13} />
              <span>릴리스 노트</span>
            </button>
            <button type="button" onClick={() => void window.multiCliWork.updates.openRepository()}>
              <ExternalLink size={13} />
              <span>GitHub 저장소</span>
            </button>
          </div>
```

with:

```tsx
          <div className="app-shortcut-row">
            <button type="button" onClick={() => void window.multiCliWork.updates.openReleases()}>
              <GitHubIcon size={13} />
              <span>릴리스 노트</span>
            </button>
            <button type="button" onClick={() => void window.multiCliWork.updates.openRepository()}>
              <GitHubIcon size={13} />
              <span>GitHub 저장소</span>
            </button>
          </div>
```

- [ ] **Step 5: Run the existing component test**

Run: `npx vitest run --pool=threads src/renderer/src/HomeDashboard.test.tsx`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/HomeDashboard.tsx
git commit -m "feat: use brand icons across the home dashboard's CLI status, quick launch, and GitHub buttons"
```

---

### Task 8: Verify `ProjectSidebar.tsx` needs no edit, then do a full visual pass

**Files:**
- None modified — `ProjectSidebar.tsx:123` (`const ProviderIcon = session.tool ? Wrench : providerDetails[session.kind].icon;`) already reads through `providerDetails`, so it picks up the new brand-icon shapes automatically from Task 2. It never passes a `className`, so it stays exactly as status-colored as before — no code change needed, only a visual check.

**Interfaces:**
- Consumes: nothing new. This task is verification-only.

- [ ] **Step 1: Full unit suite, typecheck, build, and e2e suite**

Run: `npx vitest run --pool=threads`
Expected: PASS (all suites, including the ones untouched by this plan)

Run: `npm run build`
Expected: PASS (`typecheck` + `electron-vite build` succeed, confirming `index.css`'s new rules and every `.tsx` change compile together)

Run: `npx playwright test`
Expected: PASS — `e2e/desktop.spec.ts` queries every button it touches by accessible name (`"새 PowerShell 세션"`, `"PowerShell 세션 보기"`, `"Sample Project 폴더 선택"`, etc.), all of which come from `providerDetails.label`/`menuLabel` text untouched by this plan, so the suite should be unaffected by the icon swap.

- [ ] **Step 2: Launch the built app and screenshot every touched location**

Reuse the `_electron` Playwright pattern already used earlier in this session to verify the Git-status refresh button (a temp script copied into the repo root so `node_modules` resolves, using a temp registry with one sample project — see that session's verification for the exact scaffold). Extend it to capture:

- The workspace header launcher row (`.launcher-row`) — PowerShell/Claude Code/Codex buttons distinguishable, PowerShell and Claude Code tinted, Codex monochrome.
- `ProjectDetailPage`'s empty-state session launcher (`.detail-launcher-row`) — same three, same treatment.
- `ProjectDetailPage`'s "VS Code에서 열기"/"GitHub에서 열기" buttons (`.detail-actions-row`) — VS Code tinted blue, GitHub monochrome.
- Right-click a project row to open `ProjectContextMenu` — same VS Code/GitHub check.
- The home dashboard (`HomeDashboard`) — CLI status list, quick-launch icon row, and the "릴리스 노트"/"GitHub 저장소" buttons all show the new marks.
- Expand a project in the sidebar with at least one session of each kind — session-row icons show the new shapes but keep their status color (start a session, confirm the icon color follows `--session-accent`, not the brand color).

- [ ] **Step 3: Confirm no leftover references in the five touched files**

Run: `grep -n "Bot\|Code2\|ExternalLink" src/renderer/src/session-labels.ts src/renderer/src/WorkspaceHeader.tsx src/renderer/src/ProjectDetailPage.tsx src/renderer/src/ProjectContextMenu.tsx src/renderer/src/HomeDashboard.tsx`
Expected: no output — `Bot`, `Code2`, and `ExternalLink` (the three lucide icons this plan replaces) are fully removed from every file this plan touches.

- [ ] **Step 4: Clean up any temp verification script**

If a scratch script was copied into the repo root for the Playwright check in Step 2, delete it and confirm `git status --short` is clean of anything other than this plan's intended file changes.

No commit for this task — it is verification-only.
