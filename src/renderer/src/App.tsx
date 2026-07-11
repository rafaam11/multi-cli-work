import { FolderPlus, MonitorDot, Plus, TerminalSquare } from "lucide-react";

export function App() {
  return (
    <div className="app-shell">
      <aside className="project-sidebar">
        <header className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <TerminalSquare size={17} strokeWidth={1.8} />
          </span>
          <div>
            <h1>Multi CLI Work</h1>
            <span className="brand-context">Local workspace</span>
          </div>
        </header>

        <nav className="project-navigation" aria-label="Projects">
          <div className="section-heading">
            <span>Projects</span>
            <button className="icon-button" type="button" aria-label="Add project" title="Add project">
              <Plus size={16} />
            </button>
          </div>

          <div className="sidebar-empty">
            <FolderPlus size={18} aria-hidden="true" />
            <span>No projects yet</span>
          </div>
        </nav>

        <footer className="sidebar-footer">
          <span className="connection-dot" aria-hidden="true" />
          <span>Local</span>
        </footer>
      </aside>

      <main className="terminal-workspace" aria-label="Terminal workspace">
        <header className="workspace-header">
          <div className="workspace-identity">
            <MonitorDot size={16} aria-hidden="true" />
            <span>No active session</span>
          </div>
          <button className="new-session-button" type="button" disabled>
            <Plus size={15} />
            New session
          </button>
        </header>

        <section className="terminal-empty" aria-label="Terminal workspace">
          <div className="empty-glyph" aria-hidden="true">
            <span>&gt;_</span>
          </div>
          <h2>Choose a project to start a session</h2>
        </section>
      </main>
    </div>
  );
}

