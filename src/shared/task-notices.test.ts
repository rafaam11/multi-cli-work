import { expect, it } from "vitest";
import { taskSessionNotices } from "./task-notices";
import type { Task } from "./host-types";
it("keeps waiting and review independent of execution, scoped to the source attempt",()=>{
  const task={id:"task",participants:[{id:"worker",previousAttempts:[{id:"old",generation:1}],attempt:{id:"new",generation:2,execution:"idle"}}],questions:[{id:"q",participantId:"worker",kind:"approval",answer:null,acknowledged:false,source:{attemptId:"old"}}],results:[{id:"r",source:{attemptId:"new"},review:"pending"}]} as unknown as Task;
  expect(taskSessionNotices([task])).toEqual({old:{taskId:"task",kind:"approval",questionIds:["q"],resultIds:[],unread:true},new:{taskId:"task",kind:"result",questionIds:[],resultIds:["r"],unread:true}});
  task.questions[0].acknowledged=true;
  expect(taskSessionNotices([task]).old.unread).toBe(false);
  expect(taskSessionNotices([task]).old.questionIds).toEqual(["q"]);
  task.questions[0].answer="No";task.results[0].review="acknowledged";
  expect(taskSessionNotices([task])).toEqual({});
});
