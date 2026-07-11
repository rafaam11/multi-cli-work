interface TerminalStatusNotificationContext {
  eventSessionId: string;
  selectedSessionId: string | null;
  windowVisible: boolean;
  windowFocused: boolean;
}

export function shouldShowTerminalStatusNotification(context: TerminalStatusNotificationContext): boolean {
  const sessionIsActivelyVisible =
    context.eventSessionId === context.selectedSessionId && context.windowVisible && context.windowFocused;
  return !sessionIsActivelyVisible;
}
