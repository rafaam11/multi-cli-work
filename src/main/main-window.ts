/** BrowserWindow에서 여기서 쓰는 부분만. 테스트가 가짜를 넣는다. */
export interface MainWindowLike {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isFocused(): boolean;
  webContents: { send(channel: string, ...args: unknown[]): void };
}

/**
 * 이 PC의 세션에 관한 판단과 방송은 메인 창만 본다. 원격 창은 다른 PC가 서빙한 페이지라, 거기에
 * 포커스가 있다고 로컬 알림을 억제하거나 이 PC의 터미널 출력을 그쪽으로 보내면 안 된다.
 */
export function mainWindowState(
  window: Pick<MainWindowLike, "isDestroyed" | "isVisible" | "isFocused"> | null,
): { visible: boolean; focused: boolean } {
  if (!window || window.isDestroyed()) return { visible: false, focused: false };
  const visible = window.isVisible();
  return { visible, focused: visible && window.isFocused() };
}

export function sendToMainWindow(
  window: Pick<MainWindowLike, "isDestroyed" | "webContents"> | null,
  channel: string,
  ...args: unknown[]
): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, ...args);
}

/** IPC 요청이 메인 창의 렌더러에서 왔는지. */
export function isMainWindowSender(
  window: Pick<MainWindowLike, "isDestroyed" | "webContents"> | null,
  event: unknown,
): boolean {
  if (!window || window.isDestroyed()) return false;
  return (event as { sender?: unknown } | null)?.sender === window.webContents;
}
