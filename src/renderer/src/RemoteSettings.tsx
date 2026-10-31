import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "@shared/settings-types";
import { REMOTE_PORT_RANGE } from "@shared/settings-types";
import type { RemoteAccessStatus, RemoteDeviceInfo, RemotePairingCode } from "@shared/remote-types";
import QRCode from "qrcode";
import { errorMessage } from "./ipc-error";
import { RemoteHostsSettings } from "./RemoteHostsSettings";

const STATE_LABEL: Record<RemoteAccessStatus["state"], string> = {
  off: "꺼짐",
  listening: "연결 대기 중",
  "no-tailscale": "Tailscale 미감지",
  error: "오류",
};

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function formatTime(iso: string | null): string {
  return iso === null ? "접속 기록 없음" : new Date(iso).toLocaleString("ko-KR");
}

/**
 * 원격 탭. 켜기·포트는 AppSettings(remote)로 저장하고, 서버 상태·페어링 코드·기기 목록은
 * main의 RemoteAccess에 직접 묻는다 — 토큰 해시 같은 건 렌더러로 오지 않는다.
 */
export function RemoteSettings({ settings }: { settings: AppSettings }) {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [devices, setDevices] = useState<RemoteDeviceInfo[]>([]);
  const [pairing, setPairing] = useState<RemotePairingCode | null>(null);
  const [qr, setQr] = useState<{ pair: string; install: string } | null>(null);
  const [portDraft, setPortDraft] = useState(String(settings.remote.port));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([window.multiCliWork.remote.status(), window.multiCliWork.remote.listDevices()])
      .then(([nextStatus, nextDevices]) => {
        setStatus(nextStatus);
        setDevices(nextDevices);
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }, []);

  useEffect(refresh, [refresh, settings.remote.enabled, settings.remote.port]);
  useEffect(() => setPortDraft(String(settings.remote.port)), [settings.remote.port]);

  const save = (patch: { enabled?: boolean; port?: number }) => {
    setError(null);
    window.multiCliWork.settings.update({ remote: patch }).catch((cause: unknown) => setError(errorMessage(cause)));
  };

  const commitPort = () => {
    const port = Number(portDraft);
    if (!Number.isInteger(port) || port < REMOTE_PORT_RANGE.min || port > REMOTE_PORT_RANGE.max) {
      setError(`포트는 ${REMOTE_PORT_RANGE.min}–${REMOTE_PORT_RANGE.max} 사이의 정수여야 합니다`);
      return;
    }
    if (port !== settings.remote.port) save({ port });
  };

  const issueCode = () => {
    setError(null);
    window.multiCliWork.remote
      .issuePairingCode()
      .then(async (next) => {
        const [pair, install] = await Promise.all([
          QRCode.toString(next.pairUri, { type: "svg", margin: 1 }),
          QRCode.toString(next.installUrl, { type: "svg", margin: 1 }),
        ]);
        setPairing(next);
        setQr({ pair: svgDataUrl(pair), install: svgDataUrl(install) });
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
  };

  const revoke = (deviceId: string) => {
    window.multiCliWork.remote
      .revokeDevice(deviceId)
      .then(refresh)
      .catch((cause: unknown) => setError(errorMessage(cause)));
  };

  const listening = status?.state === "listening";

  return (
    <>
      <h2>원격</h2>
      <p className="settings-hint">
        Tailscale로 묶인 휴대폰이나 다른 PC에서 이 PC의 세션을 보고 입력합니다. 서버는 Tailscale 주소(100.x)에서만 열립니다.
      </p>
      <h3>이 PC에 접속 허용</h3>
      <div className="settings-row">
        <label htmlFor="settings-remote-enabled">원격 접속 허용</label>
        <input
          id="settings-remote-enabled"
          type="checkbox"
          checked={settings.remote.enabled}
          onChange={(event) => save({ enabled: event.target.checked })}
        />
      </div>
      <div className="settings-row">
        <label htmlFor="settings-remote-port">포트</label>
        <input
          id="settings-remote-port"
          inputMode="numeric"
          value={portDraft}
          onChange={(event) => setPortDraft(event.target.value)}
          onBlur={commitPort}
        />
      </div>
      <div className="settings-row">
        <span>상태</span>
        <span>{status === null ? "확인 중…" : STATE_LABEL[status.state]}</span>
      </div>
      {status?.url ? (
        <div className="settings-row">
          <span>접속 주소</span>
          <code>{status.url}</code>
        </div>
      ) : null}
      {status?.message ? <p className="settings-hint">{status.message}</p> : null}

      <h3>기기</h3>
      <div className="settings-row">
        <span>새 기기 페어링</span>
        <button type="button" disabled={!listening} onClick={issueCode}>
          기기 추가
        </button>
      </div>
      {pairing && qr ? (
        <div className="settings-remote-pairing">
          <figure>
            <img src={qr.pair} alt="페어링 QR 코드" width={180} height={180} />
            <figcaption>셸 앱의 "QR로 PC 추가"로 찍으세요</figcaption>
          </figure>
          <figure>
            <img src={qr.install} alt="앱 설치 QR 코드" width={140} height={140} />
            <figcaption>앱이 아직 없다면 폰 카메라로 먼저 이것을 찍어 설치하세요</figcaption>
          </figure>
          <p className="settings-hint">
            브라우저로 쓸 때는 <code>{pairing.url}</code>에서 코드 <strong>{pairing.code}</strong>를 입력합니다.{" "}
            {new Date(pairing.expiresAt).toLocaleTimeString("ko-KR")}까지 한 번만 쓸 수 있습니다.
          </p>
          <p className="settings-hint">
            다른 PC에서는 설정 ▸ 원격 ▸ PC 추가에 아래 링크를 붙여 넣거나, 위 주소와 코드를 입력합니다.{" "}
            <button
              type="button"
              onClick={() => {
                window.multiCliWork.clipboard
                  .writeText(pairing.pairUri)
                  .catch((cause: unknown) => setError(errorMessage(cause)));
              }}
            >
              페어링 링크 복사
            </button>
          </p>
        </div>
      ) : null}
      {devices.length === 0 ? <p className="settings-hint">페어링된 기기가 없습니다.</p> : null}
      {devices.map((device) => (
        <div className="settings-row" key={device.deviceId}>
          <span>
            {device.name}
            <small className="settings-hint"> · {formatTime(device.lastSeenAt)}</small>
          </span>
          <button type="button" aria-label={`${device.name} 연결 해제`} onClick={() => revoke(device.deviceId)}>
            연결 해제
          </button>
        </div>
      ))}
      {error ? <p className="settings-error">{error}</p> : null}
      <RemoteHostsSettings />
    </>
  );
}
