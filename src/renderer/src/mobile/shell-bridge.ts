import type { StoredPairing } from "./remote-client";

export interface ShellBridge {
  bridgeVersion: number;
  pairing: StoredPairing | null;
  /** 호스트가 이 기기를 거절했다(철회) — 셸이 호스트를 지우고 목록으로 돌아간다. */
  unpaired(): void;
  backToHosts(): void;
}

interface RawShell {
  bridgeVersion(): number;
  pairingJson(): string;
  unpaired(): void;
  backToHosts(): void;
}

function isRawShell(value: unknown): value is RawShell {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ["bridgeVersion", "pairingJson", "unpaired", "backToHosts"].every((key) => typeof candidate[key] === "function");
}

function parsePairing(json: string): StoredPairing | null {
  try {
    const value = JSON.parse(json) as Partial<StoredPairing>;
    return typeof value.token === "string" && typeof value.deviceId === "string" && typeof value.hostName === "string"
      ? { token: value.token, deviceId: value.deviceId, hostName: value.hostName }
      : null;
  } catch {
    return null;
  }
}

/**
 * Android 셸의 WebView 안이면 셸이 `McwShell`을 심어 둔다. 페어링은 셸이 Keystore에 갖고 있으므로
 * 브라우저 localStorage 대신 그것을 쓴다. 평범한 브라우저에서는 null.
 */
export function readShellBridge(target: { McwShell?: unknown }): ShellBridge | null {
  const shell = target.McwShell;
  if (!isRawShell(shell)) return null;
  return {
    bridgeVersion: shell.bridgeVersion(),
    pairing: parsePairing(shell.pairingJson()),
    unpaired: () => shell.unpaired(),
    backToHosts: () => shell.backToHosts(),
  };
}
