import type {SessionPreset} from "./preset-types";

export function presetV2Issues(preset:SessionPreset):string[] {
  const issues:string[]=[];
  if(preset.members.length>4)issues.push("대표 1명과 작업자 최대 3명으로 조정하세요.");
  if(preset.members.some(member=>!["claude","codex"].includes(member.agentId)))issues.push("Claude Code 또는 Codex를 선택하세요.");
  if(preset.members.some(member=>/\bjk(?:\.exe|\.cmd)?\b/i.test(member.prompt??"")))issues.push("이관 필요: 역할 프롬프트의 jk 명령을 작업 MCP 도구로 바꾸세요. 수정한 원문은 보존했습니다.");
  return issues;
}
const BUILDER_V2="너는 이 작업의 대표다. task_inspect로 선택된 팀을 확인하고, task_message로 역할을 배분한다. 작업자는 자신의 worktree에서 변경과 검증을 수행한다. 메시지·질문·결과는 task_wait로 받고, 요약·변경·검증·산출물·남은 문제를 task_submit으로 제출한다. 통합·merge·push·배포는 사용자가 결정한다. 첫 지시가 없으면 task_wait로 기다려라.";
const REVIEWER_V2="너는 이 작업의 리뷰어다. 대표의 task_message 요청을 받고 변경·테스트·위험을 검토한다. 자신의 worktree에서 확인하고 다른 작업자의 변경은 임의로 합치지 않는다. 의견은 task_message로 전달하고 검증 근거와 남은 문제를 task_submit으로 제출한다. 요청이 없으면 task_wait로 기다려라.";
/** A read-only projection. Replace only exact shipped text; every edited prompt stays verbatim. */
export function projectV2Presets(presets:readonly SessionPreset[],legacy:readonly SessionPreset[]):SessionPreset[]{
  const originals=legacy.find(preset=>preset.id==="builder-reviewer")?.members??[];
  return presets.map(preset=>({...preset,members:preset.members.map(member=>{
    const original=originals.find(item=>item.agentId===member.agentId&&item.prompt===member.prompt);
    return {...member,...(original?{prompt:member.agentId==="claude"?BUILDER_V2:REVIEWER_V2}:{})};
  })}));
}
