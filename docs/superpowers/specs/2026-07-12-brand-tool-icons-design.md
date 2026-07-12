# Brand tool icons design

## Goal

Replace the generic `lucide-react` icons currently standing in for PowerShell, Claude Code, Codex, VS Code, and GitHub with each tool's actual logo, so a user can tell the buttons apart at a glance instead of decoding a robot icon for Claude Code or a `</>` bracket icon for both Codex and VS Code.

## Considered approaches

1. **Install a single icon package for everything**: rejected. No single package covers all five marks — `simple-icons` has no PowerShell, VS Code, OpenAI, or Codex entry (verified against its full icon tree, 3449 icons); `devicon` has no AI-tool entries (Claude, Codex, OpenAI).
2. **Install `@lobehub/icons` plus a second package for the remaining marks**: rejected. The published npm package targets React Native/web bundles with extra theming assumptions the app doesn't otherwise depend on (the app currently has zero UI-framework dependencies beyond `lucide-react`), so pulling in a second icon runtime just for two logos is heavier than the payoff.
3. **Hand-author inline SVG components sourced from two MIT-licensed icon repos (selected)**: copy the raw `<path>` data for each mark into a new `brand-icons.tsx`, matching the `size`/`currentColor` API every existing `lucide-react` icon in this codebase already uses. Zero new runtime dependencies, consistent with the app's existing "no SVG import pipeline, just inline icon components" convention.

## Icon sourcing

| Tool | Source | License |
|---|---|---|
| PowerShell | [devicon](https://github.com/devicons/devicon) `icons/powershell/powershell-plain.svg` | MIT |
| VS Code | devicon `icons/vscode/vscode-plain.svg` | MIT |
| GitHub | devicon `icons/github/github-original.svg` | MIT |
| Claude Code | [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons) `ClaudeCode` Mono variant | MIT |
| Codex | lobehub/lobe-icons `Codex` Mono variant | MIT |

All five are single- or few-path monochrome marks with no hardcoded fill color that survives into our component (or a fill we explicitly override), so each new component sets `fill="currentColor"` and takes only the one prop actually used anywhere in this codebase today: `size?: number`. This keeps them drop-in compatible with every existing `<Icon size={N} />` call site.

Using each brand's mark to label "this button launches X" is standard nominative use (the same pattern VS Code, Windows Terminal, and most dev tools already use for their tool/profile pickers) — it identifies the software being launched, not an endorsement claim.

## Color treatment

The app's UI is otherwise monotone (dark grays only); color is already reserved for session status (`--session-accent`: teal/amber/blue/red/green/violet for working/awaiting/idle/exited/error). To avoid competing with that system while still giving the brand marks some identity:

- **PowerShell** → `#5391FE` (official PowerShell blue)
- **VS Code** → `#007ACC` (official VS Code blue)
- **Claude Code** → `#D97757` (Anthropic's brand coral, confirmed via lobehub's `Color` variant)
- **Codex, GitHub** → stay monochrome/`currentColor`. Both brands' own marks are black/white by design, so no override is needed — this is accurate to their real branding, not a gap.

**Exception — session rows keep status color, not brand color.** In `ProjectSidebar.tsx`, the per-session icon's color is already `--session-accent`, which is how a user tells a working/awaiting/errored session apart at a glance. Applying a fixed brand color there would silently break that signal. The brand-accent classes below are therefore applied only at static call sites that have no status coloring today; the session-row icon swap is shape-only.

## Integration points

1. **`session-labels.ts`** — `providerDetails` record: swap the three `icon` values from lucide (`Terminal`, `Bot`, `Code2`) to the new `PowerShellIcon`/`ClaudeCodeIcon`/`CodexIcon`. The field's type (currently pinned to lucide's `typeof TerminalIcon`) becomes a small local `IconComponent = (props: { size?: number }) => JSX.Element` type, since these are no longer lucide components.
2. **`WorkspaceHeader.tsx`** — session-start launcher row: add the brand-accent class alongside the swapped icon.
3. **`ProjectDetailPage.tsx`** — empty-state session-start launcher row (same treatment as above); hardcoded `Code2`/`ExternalLink` on the "VS Code에서 열기"/"GitHub에서 열기" buttons become `VSCodeIcon`/`GitHubIcon`.
4. **`ProjectContextMenu.tsx`** — same `Code2`/`ExternalLink` → `VSCodeIcon`/`GitHubIcon` swap in the right-click menu.
5. **`HomeDashboard.tsx`** — CLI-status list and quick-launch icon buttons pick up the swapped `providerDetails` icons plus brand-accent class; "릴리스 노트" and "GitHub 저장소" (both already open GitHub URLs) both become `GitHubIcon`.
6. **`ProjectSidebar.tsx`** — session-row icon swaps to the new shape via `providerDetails`, deliberately without the brand-accent class, so `--session-accent` keeps controlling its color exactly as today.

## Verification

- `npm run typecheck` after the `IconComponent` type change and all call-site swaps.
- Run the existing `e2e/desktop.spec.ts` suite — it queries buttons by accessible name (`"새 PowerShell 세션"`, `"Sample Project 폴더 선택"`, etc.), which come from `providerDetails.label`/`menuLabel` text and are unaffected by the icon swap, so it should stay green unchanged.
- Manually launch the app (`npm run build` + the Playwright `_electron` driver already used for this session's Git-status verification, or `npm run dev`) and visually confirm: the five marks are distinguishable in the workspace header launcher row, the project-detail empty state, the home dashboard, and the sidebar session list; session-row icon color still tracks session status, not the tool.

## Scope boundaries

No new npm dependency is added. No change to session status colors, the Git-status card just fixed, or any provider/session logic — this is a visual identity swap only. Multi-color/gradient renderings of any mark (e.g. PowerShell's official gradient badge) are out of scope; every icon stays a flat single-color glyph to match the app's existing icon rendering model.
