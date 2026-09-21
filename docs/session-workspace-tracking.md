# Session workspace tracking

The sidebar follows the workspace reported by a session's provider without restarting its PTY or changing its session ID. The binding (`cwd`, optional `worktreeId`) is persisted and used by later resume and worktree cleanup operations. The current pane stays on screen during a move.

For newly launched built-in PowerShell sessions, app-owned aliases invoke Codex with the app profile and Claude with the app settings overlay. These are process-local; user profiles and global provider settings are not edited. The proxies preserve argument boundaries, pipeline input and native exit codes. Returning from the CLI reports the parent shell's directory. Existing user aliases/functions, explicit `--profile` / `--settings`, absolute executable invocations and custom PowerShell startup commands are left in control and may bypass tracking. Already-running shells must be relaunched to load the integration.

Claude reports `cwd` through its existing lifecycle hooks. Codex's SessionStart hook identifies the exact transcript; an incremental reader observes structured shell `workdir`, execution-event `cwd`, and changes to turn-context `cwd`. Old transcript entries predating the current launch are excluded. Command text, prose and tool-output paths are not used to guess location. This means opaque scripts or code-mode calls that provide no structured execution location cannot be tracked; merely creating a worktree does not move a session. Codex hooks still require the provider's normal trust approval.

Locations are resolved with Git and matched only to worktrees of the session's original project. Unrelated repositories do not change the binding. Hook generation and conversation identity guard against stale launches and other conversations. Claude subagent hooks carrying `agent_id` are ignored.

Protocol references: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude hook input](https://code.claude.com/docs/en/hooks#common-input-fields). Transcript formats are an implementation detail, so unknown records are ignored rather than interpreted as paths.

Validation: unit tests cover ownership, persistence, argument/stdin/exit forwarding, structured transcript parsing and real Git path resolution. `e2e/session-workspace.spec.ts` runs real PowerShell, generated hooks, Git and Electron with simulated provider events for both CLIs, including the return to main.
