import { useState } from "react";
import { requestPairing, type StoredPairing } from "./remote-client";

export function PairScreen({ notice, onPaired }: { notice: string | null; onPaired(pairing: StoredPairing): void }) {
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("내 폰");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    requestPairing(code, deviceName)
      .then(onPaired)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <form className="m-pair" onSubmit={submit}>
      <h1>PC와 연결</h1>
      <p>PC의 설정 ▸ 모바일 ▸ 기기 추가에 나온 코드를 입력하세요.</p>
      {notice ? <p className="m-notice">{notice}</p> : null}
      <label>
        페어링 코드
        <input value={code} autoCapitalize="characters" autoComplete="one-time-code" onChange={(event) => setCode(event.target.value)} />
      </label>
      <label>
        이 기기 이름
        <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
      </label>
      <button type="submit" disabled={busy || code.trim().length === 0}>
        연결
      </button>
      {error ? <p className="m-error">{error}</p> : null}
    </form>
  );
}
