// New shells can receive old host-served HTML/JS. Observe that UI rather than requiring a new callback.
(() => {
  if (window.__mcwSessionViewingV2 || !window.McwShell?.legacyViewingSession) return;
  window.__mcwLegacyViewingStop?.();
  let frame = 0;
  let last = null;
  const events = ["focus", "blur", "hashchange", "popstate", "mcw-foreground"];
  const update = () => {
    frame = 0;
    if (window.__mcwSessionViewingV2) { stop(); return; }
    const screen = document.querySelector(".m-session-screen");
    const rows = screen?.querySelector(".xterm-rows");
    const rect = screen?.getBoundingClientRect();
    const status = [...(screen?.querySelector(".m-status")?.classList ?? [])].find(value => value.startsWith("m-status-"))?.slice(9) ?? "";
    const text = rows?.textContent ?? "";
    const shown = document.visibilityState === "visible" && document.hasFocus() && window.McwShell.isForeground() &&
      rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && text.trim();
    const id = shown ? new URLSearchParams(window.location.hash.slice(1)).get("session") ?? "" : "";
    const key = JSON.stringify([id, id ? status : "", id ? text : ""]);
    if (key === last) return;
    last = key;
    window.McwShell.legacyViewingSession(id, id ? status : "");
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const observer = new MutationObserver(schedule);
  const stop = () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    events.forEach(event => window.removeEventListener(event, schedule));
    document.removeEventListener("visibilitychange", schedule);
    delete window.__mcwLegacyViewingStop;
  };
  window.__mcwLegacyViewingStop = stop;
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  events.forEach(event => window.addEventListener(event, schedule));
  document.addEventListener("visibilitychange", schedule);
  schedule();
})();
