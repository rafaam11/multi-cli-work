import {chromium,expect,type TestInfo} from '@playwright/test';
import type {HostClient} from '../src/main/host/host-client';
import type {StoredPairing} from '../src/renderer/src/mobile/remote-client';
/** Desktop Chrome at a narrow viewport. This is gateway/browser verification,
 * explicitly not physical Android, Android IME or APK verification. */
export async function openMobileHostBrowser(input:{client:HostClient;pairing:StoredPairing;sessionId:string;info:TestInfo}){
  const status=await input.client.request<{url:string;state:string}>('/mobile/status');expect(status.state).toBe('listening');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:412,height:860},hasTouch:true,isMobile:true});
    await context.addInitScript(pairing=>localStorage.setItem('mcw.remote.pairing',JSON.stringify(pairing)),input.pairing);
    const page=await context.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(status.url);await expect(page.getByRole('button',{name:'작업·결과',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'작업·결과',exact:true}).click();await expect(page.getByRole('region',{name:'협업 작업'})).toBeVisible();
    await expect(page.getByLabel('작업 저장소',{exact:true})).toBeVisible();await expect(page.getByText('호스트 연결 끊김',{exact:false})).toHaveCount(0);
    await page.screenshot({path:input.info.outputPath('mobile-host-tasks-chrome.png')});
    await page.getByRole('button',{name:'세션 목록으로'}).click();await page.locator('.m-row-open').first().click();
    await expect(page.getByTestId('herdr-terminal')).toHaveAttribute('data-session-id',input.sessionId);
    await expect(page.getByRole('button',{name:'제어 요청',exact:true})).toBeEnabled();
    await expect(page.getByLabel('터미널 입력',{exact:true})).toHaveAttribute('aria-readonly','true');
    await page.screenshot({path:input.info.outputPath('mobile-host-observer-chrome.png')});
    return {page,async afterGuiQuit(surfaceText:()=>string){
      await page.reload();await expect(page.getByRole('button',{name:'제어 요청',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'제어 요청',exact:true}).click();await expect(page.getByLabel('터미널 입력',{exact:true})).toHaveAttribute('aria-readonly','false');
      await page.getByLabel('터미널 입력',{exact:true}).pressSequentially('echo MCW_PHONE_SURVIVES');await page.getByLabel('터미널 입력',{exact:true}).press('Enter');
      await expect.poll(surfaceText).toContain('MCW_PHONE_SURVIVES');
      await page.getByRole('button',{name:'제어 놓기',exact:true}).click();
      await page.screenshot({path:input.info.outputPath('mobile-host-gui-closed-chrome.png')});expect(errors).toEqual([]);
    },close:()=>browser.close()};
  }catch(error){await browser.close();throw error;}
}
