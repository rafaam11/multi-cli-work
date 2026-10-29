import type { Task } from "./host-types";
export interface TaskSessionNotice {taskId:string;kind:"approval"|"question"|"result";questionIds:string[];resultIds:string[];unread:boolean}
/** Waiting is domain state, independent of terminal activity, layout and screen visibility. */
export function taskSessionNotices(tasks:readonly Task[]):Record<string,TaskSessionNotice> {
  const notices:Record<string,TaskSessionNotice>={};
  const rank={approval:0,question:1,result:2};
  const get=(sessionId:string,taskId:string,kind:TaskSessionNotice["kind"])=>{
    const notice=notices[sessionId]??={taskId,kind,questionIds:[],resultIds:[],unread:false};
    if(rank[kind]<rank[notice.kind])notice.kind=kind;return notice;
  };
  for(const task of tasks){
    for(const question of task.questions){
      if(question.answer!==null)continue;
      const participant=task.participants.find(member=>member.id===question.participantId);
      const attemptId=question.source?.attemptId ?? participant?.previousAttempts[0]?.id ?? participant?.attempt.id;
      if(!attemptId)continue;
      const notice=get(attemptId,task.id,question.kind);notice.questionIds.push(question.id);notice.unread ||= !question.acknowledged;
    }
    for(const result of task.results){if(result.review!=="pending")continue;const notice=get(result.source.attemptId,task.id,"result");notice.resultIds.push(result.id);notice.unread=true;}
  }
  return notices;
}
export function taskUnread(tasks:readonly Task[]):Record<string,"approval"|"input"> {
  return Object.fromEntries(Object.entries(taskSessionNotices(tasks)).filter(([,notice])=>notice.unread).map(([id,notice])=>[id,notice.kind==="approval"?"approval":"input"]));
}
