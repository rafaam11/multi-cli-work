import { expect, type Locator, type Page } from "@playwright/test";

async function visibleChoice(direct: Locator, compact: Locator): Promise<"direct" | "compact"> {
  await expect
    .poll(async () => (await direct.isVisible()) || (await compact.isVisible()))
    .toBe(true);
  return (await direct.isVisible()) ? "direct" : "compact";
}

/** Starts an agent through the full launcher row or its narrow-header menu. */
export async function startAgentSession(page: Page, agentLabel: string): Promise<void> {
  const direct = page.getByRole("button", { name: `새 ${agentLabel} 세션`, exact: true }).first();
  const compact = page.getByRole("button", { name: "새 세션 메뉴 열기", exact: true });
  if ((await visibleChoice(direct, compact)) === "direct") {
    await direct.click();
    return;
  }
  if ((await compact.getAttribute("aria-expanded")) !== "true") await compact.click();
  await page
    .getByRole("menu", { name: "새 세션", exact: true })
    .getByRole("menuitem", { name: `${agentLabel} 시작`, exact: true })
    .click();
}

/** Confirms that an agent remains reachable, regardless of the responsive header form. */
export async function expectAgentLauncherAvailable(page: Page, agentLabel: string): Promise<void> {
  const direct = page.getByRole("button", { name: `새 ${agentLabel} 세션`, exact: true }).first();
  const compact = page.getByRole("button", { name: "새 세션 메뉴 열기", exact: true });
  if ((await visibleChoice(direct, compact)) === "direct") {
    await expect(direct).toBeVisible();
    return;
  }
  if ((await compact.getAttribute("aria-expanded")) !== "true") await compact.click();
  await expect(
    page
      .getByRole("menu", { name: "새 세션", exact: true })
      .getByRole("menuitem", { name: `${agentLabel} 시작`, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
}

/** Selects a layout through the full radio row or its narrow-header menu. */
export async function selectWorkspaceLayout(page: Page, label: string): Promise<void> {
  const direct = page
    .getByRole("radiogroup", { name: "레이아웃 선택" })
    .getByRole("radio", { name: label, exact: true });
  const compact = page.getByRole("button", { name: /배치 메뉴 열기, 현재/ });
  if ((await visibleChoice(direct, compact)) === "direct") {
    await direct.click();
    return;
  }
  if ((await compact.getAttribute("aria-expanded")) !== "true") await compact.click();
  await page
    .getByRole("menu", { name: "배치 선택", exact: true })
    .getByRole("menuitemradio", { name: label, exact: true })
    .click();
}
