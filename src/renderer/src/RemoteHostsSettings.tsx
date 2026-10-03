import { useEffect, useState } from "react";
import type { RemoteHostAddInput, RemoteHostInfo } from "@shared/remote-types";
import { errorMessage } from "./ipc-error";

const isPairingLink = (value: string) => value.trim().toLowerCase().startsWith("mcw://");

function toAddInput(target: string, code: string): RemoteHostAddInput {
  const trimmed = target.trim();
  return isPairingLink(trimmed) ? { uri: trimmed } : { address: trimmed, code: code.trim() };
}

/**
 * 설정 ▸ 원격의 "다른 PC에 접속". 이 PC가 클라이언트로서 등록해 둔 호스트 목록이다. 토큰은 main에만
 * 있고 여기로는 오지 않는다 — 화면은 "페어링됨/다시 필요"만 안다.
 */
export function RemoteHostsSettings() {
  const [hosts, setHosts] = useState<RemoteHostInfo[]>([]);
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.multiCliWork.remoteHosts
      .list()
      .then(setHosts)
      .catch((cause: unknown) => setError(errorMessage(cause)));
    return window.multiCliWork.remoteHosts.onChanged(setHosts);
  }, []);

  const link = isPairingLink(target);
  const canAdd = !busy && target.trim().length > 0 && (link || code.trim().length > 0);

  const run = (action: Promise<unknown>) => {
    setError(null);
    action.catch((cause: unknown) => setError(errorMessage(cause)));
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    window.multiCliWork.remoteHosts
      .add(toAddInput(target, code))
      .then(() => {
        setTarget("");
        setCode("");
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <h3>다른 PC에 접속</h3>
      <p className="settings-hint">
        그 PC의 설정 ▸ 원격 ▸ 기기 추가에서 복사한 페어링 링크를 붙여 넣거나, 그 PC의 접속 주소와 코드를 입력합니다.
      </p>
      <form className="settings-remote-host-form" onSubmit={add}>
        <input
          type="text"
          aria-label="페어링 링크 또는 주소"
          placeholder="mcw://pair?… 또는 100.x.y.z:47821"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
        <input
          type="text"
          aria-label="페어링 코드"
          placeholder="코드"
          value={link ? "" : code}
          disabled={link}
          onChange={(event) => setCode(event.target.value)}
        />
        <button type="submit" disabled={!canAdd}>
          PC 추가
        </button>
      </form>
      {hosts.length === 0 ? <p className="settings-hint">등록된 PC가 없습니다.</p> : null}
      {hosts.map((host) => (
        <div className="settings-row" key={host.hostId}>
          <span>
            {host.name}
            <small className="settings-hint">
              {" "}
              · {host.address}
              {host.paired ? "" : " · 다시 페어링 필요"}
            </small>
          </span>
          <span className="settings-remote-host-actions">
            <button
              type="button"
              aria-label={`${host.name} 열기`}
              disabled={!host.paired}
              onClick={() => run(window.multiCliWork.remoteHosts.open(host.hostId))}
            >
              열기
            </button>
            <button
              type="button"
              aria-label={`${host.name} 삭제`}
              onClick={() => run(window.multiCliWork.remoteHosts.remove(host.hostId))}
            >
              삭제
            </button>
          </span>
        </div>
      ))}
      {error ? <p className="settings-error">{error}</p> : null}
    </>
  );
}
