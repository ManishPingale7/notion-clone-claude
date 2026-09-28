import { expect } from '@playwright/test';

export const PASSWORD = 'password123';

export async function login(page, email) {
  await page.goto('/login');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
}

export async function switchWorkspace(page, name) {
  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('workspace-option').filter({ hasText: name }).click();
  await expect(page.getByTestId('workspace-switcher')).toContainText(name);
}

/** Creates a private page from the sidebar and gives it a title. Returns its id. */
export async function newPage(page, title) {
  await page.getByTestId('new-page-top').click();
  const t = page.getByTestId('page-title');
  await expect(t).toBeVisible();
  await expect(page).toHaveURL(/\/p\//);
  await t.click();
  await page.keyboard.type(title);
  await expect(page.getByTestId('sidebar-page').filter({ hasText: title })).toBeVisible();
  return page.url().split('/p/')[1].split(/[?#]/)[0];
}

/** Focuses a fresh block at the end of the page body. */
export async function focusNewBlock(page) {
  await page.getByTestId('page-title').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
}

export function blocks(page) {
  return page.locator('[data-testid=editor] .block-wrap');
}

export async function waitSaved(page) {
  // edits are flushed to the server within ~350ms
  await page.waitForTimeout(700);
}
