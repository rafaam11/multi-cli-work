import { useState } from "react";
import type { SettingsTab } from "./SettingsDialog";
const ENTRIES: { tab: SettingsTab; title: string; keywords: string; phase: string; target?: string; v1Only?:boolean;v2Only?:boolean }[] = [
  {tab:'updates',title:'v1.55.1로 돌아가기',keywords:'롤백 복원 복구 업데이트 rollback recovery',phase:'복귀 준비 후 적용',v2Only:true},
  { tab: "general", title: "테마", keywords: "theme dark light 시스템 밝기", target: "settings-theme", phase: "즉시 적용" },
  { tab: "general", title: "시각 효과", keywords: "애니메이션 관제실 풍부하게 최소 effects 모션", target: "settings-effects", phase: "즉시 적용" },
  { tab: "general", title: "화면 밀도", keywords: "간격 compact comfortable density", target: "settings-density", phase: "즉시 적용" },
  { tab: "general", title: "일반 · 시작 및 트레이", keywords: "자동 재개 업데이트 창 닫기 트레이 진행률 전역 단축키 summon", phase: "항목별 적용" },
  { tab: "general", title: "세션 MCP · 레포 최신화", keywords: "jk mcp 도구 동기화 repo sync", phase: "새 세션부터",v1Only:true },
  { tab: "terminal", title: "터미널 글꼴", keywords: "font family 크기 줄 간격", target: "settings-font-family", phase: "즉시 적용" },
  { tab: "terminal", title: "터미널 커서 · 스크롤백", keywords: "cursor 깜박임 scrollback 기록", target: "settings-cursor-style", phase: "즉시 적용" },
  { tab: "notifications", title: "알림 · 사용량", keywords: "notification 방해 금지 시간 snooze 사용량 게이지 한도 경고", phase: "즉시 적용" },
  { tab: "projects", title: "프로젝트 구분 · 폴더 템플릿", keywords: "분류 카테고리 색상 category template", phase: "저장 후 적용" },
  { tab: "workspace", title: "워크스페이스 루트", keywords: "workspace dev data work 폴더 연결", phase: "등록 후 적용" },
  { tab: "files", title: "파일 열기", keywords: "확장자 연결 프로그램 vscode 미리보기 open with", target: "settings-default-open-with", phase: "다음 파일 열기부터" },
  { tab: "presets", title: "팀 프리셋", keywords: "팀 역할 첫 프롬프트 claude codex builder reviewer", phase: "다음 팀 시작부터" },
  { tab: "launch-profiles", title: "시작 프로필 · 모델 및 추론", keywords: "model effort reasoning 프로필 codex claude", phase: "다음 새 세션부터" },
  { tab: "notion", title: "노션 연결", keywords: "notion 토큰 로그인 API 연동", target: "settings-notion-token", phase: "저장 후 적용" },
  { tab: "mobile", title: "원격 · 모바일", keywords: "ssh tailscale pairing 페어링 호스트 다른 PC 연결", phase: "항목별 적용" },
  { tab: "keybindings", title: "단축키", keywords: "keybindings keyboard shortcut 키 바인딩 충돌", phase: "즉시 적용" },
  { tab: "pc", title: "PC 루트 · 설정 프로필", keywords: "프로필 가져오기 내보내기 import export 드라이브 경로", phase: "미리보기 후 적용" },
];
export function SettingsSearch({ onSelect }: { onSelect(tab: SettingsTab): void }) {
  const [query, setQuery] = useState("");
  const matches = query.trim() ? ENTRIES.filter(entry => !(entry.v1Only&&window.mcwV2?.version===2)&&!(entry.v2Only&&window.mcwV2?.version!==2)&&`${entry.title} ${entry.keywords}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];
  const select = (entry: typeof ENTRIES[number]) => {
    onSelect(entry.tab); setQuery("");
    if (entry.target) requestAnimationFrame(() => document.getElementById(entry.target!)?.focus());
  };
  return <div className="settings-search" role="search" aria-label="설정 검색">
    <input type="search" aria-label="설정 검색어" placeholder="설정·기능 검색…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
      if (event.key === "Enter" && matches[0]) { event.preventDefault(); select(matches[0]); }
      if (event.key === "Escape" && query) { event.stopPropagation(); setQuery(""); }
    }} />
    {query ? <div className="settings-search-results"><p aria-live="polite">검색 결과 {matches.length}개</p>{matches.map(entry => <button type="button" key={entry.title} onClick={() => select(entry)}><span>{entry.title}</span><small>{entry.phase}</small></button>)}</div> : null}
  </div>;
}
