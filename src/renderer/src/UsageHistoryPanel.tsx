import { useEffect, useState } from "react";
import type { UsageHistorySnapshot } from "@shared/usage-types";
import { usageSegments } from "./usage-series";
const SERIES = [
  { provider: "claude", kind: "5h", label: "Claude 5시간", color: "var(--brand-claude)" },
  { provider: "claude", kind: "weekly", label: "Claude 주간", color: "var(--brand-claude)" },
  { provider: "codex", kind: "5h", label: "Codex 5시간", color: "var(--teal)" },
  { provider: "codex", kind: "weekly", label: "Codex 주간", color: "var(--teal)" },
] as const;
export function UsageHistoryPanel() {
  const [history, setHistory] = useState<UsageHistorySnapshot>({ samples: [] });
  const [days, setDays] = useState(1);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!window.multiCliWork.usage?.history) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const next = await window.multiCliWork.usage.history(); if (!disposed) { setHistory(next); setNow(Date.now()); } }
      catch (error) { if (!disposed) setHistory(current => ({ ...current, warning: String(error) })); }
      if (!disposed) timer = setTimeout(() => void refresh(), 60_000);
    };
    void refresh(); return () => { disposed = true; clearTimeout(timer); };
  }, []);
  if (!window.multiCliWork.usage?.history) return null;
  const since = now - days * 86400_000;
  const visible = history.samples.filter(sample => Date.parse(sample.observedAt) >= since);
  return <section className="home-card usage-history-card" aria-label="사용량 이력">
    <header className="usage-history-heading"><h2>구독 사용량 이력</h2><div role="group" aria-label="이력 기간">
      {[1, 7].map(value => <button type="button" key={value} aria-pressed={days === value} onClick={() => setDays(value)}>{value === 1 ? "24시간" : "7일"}</button>)}
    </div></header>
    <p>계정 한도의 실제 수집값입니다. 세션별 비용이나 컨텍스트 사용률과는 별개입니다.</p>
    {history.warning ? <p role="alert">{history.warning}</p> : null}
    {visible.length === 0 ? <p>아직 수집된 사용량 이력이 없습니다.</p> : <>
      <div className="usage-history-axis"><span>100%</span><span>사용한 한도</span></div>
      <svg className="usage-history-chart" viewBox="0 0 400 110" role="img" aria-label={`${days === 1 ? "24시간" : "7일"}간 Claude와 Codex의 5시간·주간 사용량. 초기화와 수집 공백에서는 선을 잇지 않습니다.`}>
        <title>구독 사용량 추세</title>
        {[5, 55, 105].map(y => <line key={y} x1="5" x2="395" y1={y} y2={y} stroke="var(--line)" />)}
        {SERIES.flatMap(series => usageSegments(history.samples, series.provider, series.kind, since, now).map((segment, index) => {
          const x = (at: string) => 5 + (Date.parse(at) - since) / (now - since) * 390;
          return <g key={`${series.provider}-${series.kind}-${index}`}>
            <polyline points={segment.map(point => `${x(point.observedAt)},${105 - point.usedPercent}`).join(" ")} fill="none" stroke={series.color} strokeWidth="2" strokeDasharray={series.kind === "weekly" ? "5 4" : undefined} />
            {segment.map(point => <circle key={`${point.observedAt}-${point.resetsAt}`} cx={x(point.observedAt)} cy={105 - point.usedPercent} r="2" fill={series.color}><title>{series.label} · {point.usedPercent}% · {new Date(point.observedAt).toLocaleString()}</title></circle>)}
          </g>;
        }))}
      </svg>
      <div className="usage-history-axis"><span>0% · {new Date(since).toLocaleString()}</span><span>현재</span></div>
      <ul className="usage-history-legend">{SERIES.map(series => <li key={`${series.provider}-${series.kind}`}><span aria-hidden="true" style={{ borderColor: series.color, borderTopStyle: series.kind === "weekly" ? "dashed" : "solid" }} />{series.label}</li>)}</ul>
      <p>마지막 수집: {new Date(visible.at(-1)!.observedAt).toLocaleString()}</p>
    </>}
  </section>;
}
