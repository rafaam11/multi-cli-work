import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {McwV2Api} from '@shared/v2-api';
import {RecoverySettings} from './RecoverySettings';
afterEach(cleanup);
it('only reads on entry and explains the concrete restoration before the user starts it',async()=>{
  const status={available:true,backupDirectory:'C:/backup'};
  const api={recoveryStatus:vi.fn(async()=>status),beginRecovery:vi.fn(async()=>({...status,operation:{id:'op',phase:'waiting-work',observations:[{hostId:'PC-B',state:'unknown',observedAt:1}],canCancel:true,needsInspection:false}})),cancelRecovery:vi.fn(),openRecovery:vi.fn()} as unknown as McwV2Api;
  render(<RecoverySettings api={api}/>);
  await screen.findByRole('button',{name:'v1.55.1로 돌아가기'});expect(api.beginRecovery).not.toHaveBeenCalled();expect(api.cancelRecovery).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'v1.55.1로 돌아가기'}));expect(api.beginRecovery).not.toHaveBeenCalled();
  expect(screen.getByText(/업데이트 전 v1 데이터/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'새 작업 접수를 멈추고 복귀 준비'}));
  await waitFor(()=>expect(api.beginRecovery).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('PC-B: 상태를 확인할 수 없음')).toBeVisible();expect(api.cancelRecovery).not.toHaveBeenCalled();
});
it('retains failed recovery details and offers explicit cancellation without claiming success',async()=>{
  const status={available:false,backupDirectory:'C:/backup',reason:'복원 기록을 확인하세요.',operation:{id:'op',phase:'failed',error:'원격 연결 끊김',observations:[],canCancel:true,needsInspection:true}};
  const api={recoveryStatus:vi.fn(async()=>status),beginRecovery:vi.fn(),cancelRecovery:vi.fn(async()=>({...status,operation:{...status.operation,phase:'cancelled',canCancel:false}})),openRecovery:vi.fn()} as unknown as McwV2Api;
  render(<RecoverySettings api={api}/>);await screen.findByText('원격 연결 끊김');
  expect(screen.queryByRole('button',{name:'v1.55.1로 돌아가기'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'복귀 취소 · 접수 제한 해제'}));
  await waitFor(()=>expect(api.cancelRecovery).toHaveBeenCalledTimes(1));expect(await screen.findByText('복귀를 취소했습니다.')).toBeVisible();
});
