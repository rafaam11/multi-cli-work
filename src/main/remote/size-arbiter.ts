import { DESKTOP_SIZE_OWNER, type SizeOwner } from "../../shared/remote-types";

export interface SizeState {
  cols: number | null;
  rows: number | null;
  owner: SizeOwner;
}

interface Size {
  cols: number;
  rows: number;
}

/**
 * PTY는 크기가 하나뿐이라, 데스크톱 패인과 폰이 같은 세션을 볼 때 누가 크기를 정할지 여기서만
 * 정한다. 기본은 데스크톱이다. 폰은 "폰 크기로"를 켤 때만 가져가고, 데스크톱이 그 세션에 입력하거나
 * 패인 크기를 바꾸면 곧바로 데스크톱의 마지막 크기로 되돌아온다.
 */
export class TerminalSizeArbiter {
  private readonly desktop = new Map<string, Size>();
  private readonly applied = new Map<string, Size>();
  /** 세션 → 크기를 가진 deviceId. 없으면 데스크톱이다. */
  private readonly owners = new Map<string, string>();
  private readonly listeners = new Set<(sessionId: string, state: SizeState) => void>();

  constructor(private readonly apply: (sessionId: string, cols: number, rows: number) => Promise<void>) {}

  current(sessionId: string): SizeState {
    const size = this.applied.get(sessionId);
    return { cols: size?.cols ?? null, rows: size?.rows ?? null, owner: this.owners.get(sessionId) ?? DESKTOP_SIZE_OWNER };
  }

  onChange(listener: (sessionId: string, state: SizeState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async desktopResize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.resize(sessionId, cols, rows);
    this.desktop.set(sessionId, { cols, rows });
    this.owners.delete(sessionId);
    this.emit(sessionId);
  }

  async desktopInput(sessionId: string): Promise<void> {
    if (!this.owners.has(sessionId)) return;
    await this.reclaim(sessionId);
  }

  async deviceResize(deviceId: string, sessionId: string, cols: number, rows: number): Promise<void> {
    await this.resize(sessionId, cols, rows);
    this.owners.set(sessionId, deviceId);
    this.emit(sessionId);
  }

  async deviceRelease(deviceId: string, sessionId: string): Promise<void> {
    if (this.owners.get(sessionId) !== deviceId) return;
    await this.reclaim(sessionId);
  }

  private async reclaim(sessionId: string): Promise<void> {
    const size = this.desktop.get(sessionId);
    if (size) await this.resize(sessionId, size.cols, size.rows);
    this.owners.delete(sessionId);
    this.emit(sessionId);
  }

  private async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.apply(sessionId, cols, rows);
    this.applied.set(sessionId, { cols, rows });
  }

  private emit(sessionId: string): void {
    const state = this.current(sessionId);
    for (const listener of this.listeners) listener(sessionId, state);
  }
}
