import { contextBridge, ipcRenderer } from "electron";

// 다른 PC가 서빙한 페이지에 심는 셸 브리지. Android 셸(McwShellBridge.kt)과 같은 계약이고,
// 웹 UI는 src/renderer/src/mobile/shell-bridge.ts로 읽는다. 토큰을 줄지는 main이 요청한 프레임의
// 출처를 보고 정한다(remote-windows.ts) — 여기서는 묻기만 한다.
// 이 파일은 electron 말고 아무것도 import하지 않는다: sandbox preload는 분리된 청크를 불러올 수 없다.
contextBridge.exposeInMainWorld("McwShell", {
  bridgeVersion: () => 1,
  pairingJson: () => {
    const value: unknown = ipcRenderer.sendSync("remote-shell:pairing");
    return typeof value === "string" ? value : "";
  },
  unpaired: () => ipcRenderer.send("remote-shell:unpaired"),
  backToHosts: () => ipcRenderer.send("remote-shell:back"),
});
