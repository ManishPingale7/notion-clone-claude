import { test, expect } from '@playwright/test';
import { login, newPage, focusNewBlock, waitSaved } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await login(page, 'alice@example.com');
});

test('trash: delete from sidebar, restore, delete permanently', async ({ page }) => {
  await newPage(page, 'Disposable');
  const item = page.getByTestId('sidebar-page').filter({ hasText: 'Disposable' });
  await item.hover();
  await item.getByTestId('sidebar-page-menu').click();
  await page.getByTestId('menu-trash').click();
  await expect(item).toHaveCount(0);

  await page.getByTestId('nav-trash').click();
  const trashItem = page.getByTestId('trash-item').filter({ hasText: 'Disposable' });
  await expect(trashItem).toBeVisible();
  await trashItem.getByTestId('trash-restore').click();
  await expect(page.getByTestId('trash-item').filter({ hasText: 'Disposable' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sidebar-page').filter({ hasText: 'Disposable' })).toBeVisible();

  // delete again and remove permanently
  await item.hover();
  await item.getByTestId('sidebar-page-menu').click();
  await page.getByTestId('menu-trash').click();
  await page.getByTestId('nav-trash').click();
  await page.getByTestId('trash-item').filter({ hasText: 'Disposable' }).getByTestId('trash-delete').click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: /Delete this page/ }).click();
  await expect(page.getByTestId('trash-item').filter({ hasText: 'Disposable' })).toHaveCount(0);
});

test('sidebar: nested pages, rename, duplicate, favorites, drag to nest', async ({ page }) => {
  await newPage(page, 'Outer');
  const priv = page.getByTestId('section-private');
  const outer = priv.getByTestId('sidebar-page').filter({ hasText: /^Outer$/ });
  await outer.hover();
  await outer.getByTestId('sidebar-add-child').click();
  await page.getByTestId('page-title').click();
  await page.keyboard.type('Inner');
  await expect(page.getByTestId('topbar')).toContainText('Outer');
  await expect(page.getByTestId('sidebar-page').filter({ hasText: 'Inner' })).toBeVisible();

  // rename
  await outer.hover();
  await outer.getByTestId('sidebar-page-menu').click();
  await page.getByTestId('menu-rename').click();
  await page.getByTestId('rename-input').fill('Outer renamed');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sidebar-page').filter({ hasText: 'Outer renamed' })).toBeVisible();

  // duplicate
  const renamed = priv.getByTestId('sidebar-page').filter({ hasText: /^Outer renamed$/ });
  await renamed.hover();
  await renamed.getByTestId('sidebar-page-menu').click();
  await page.getByTestId('menu-duplicate').click();
  await expect(page.getByTestId('page-title')).toHaveText('Outer renamed (1)');

  // favorite
  await renamed.hover();
  await renamed.getByTestId('sidebar-page-menu').click();
  await page.getByTestId('menu-favorite').click();
  await expect(page.getByText('Favorites', { exact: true })).toBeVisible();

  // drag "Outer renamed (1)" into "Outer renamed"
  const copy = priv.getByTestId('sidebar-page').filter({ hasText: 'Outer renamed (1)' });
  await copy.dragTo(renamed);
  // it is now nested: the parent is expanded and the copy is indented under it
  await expect(priv.locator('.page-children').getByTestId('sidebar-page').filter({ hasText: 'Outer renamed (1)' })).toBeVisible();
  await page.reload();
  await priv.getByTestId('sidebar-page').filter({ hasText: 'Outer renamed (1)' }).first().click();
  await expect(page.getByTestId('topbar')).toContainText('Outer renamed');
});

test('comments on text selections and version history', async ({ page }) => {
  await newPage(page, 'Reviewed doc');
  await focusNewBlock(page);
  await page.keyboard.type('This sentence needs review');
  await waitSaved(page);
  // select the word "review" and comment on it
  await page.keyboard.press('Shift+ArrowLeft');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('inline-toolbar')).toBeVisible();
  await page.getByTestId('inline-toolbar').locator('[data-tb=comment]').click();
  await page.getByTestId('discussion-popover').getByTestId('comment-input').click();
  await page.keyboard.type('Please double-check this');
  await page.keyboard.press('Enter');
  await expect(page.locator('.comment-anchor')).toHaveText('review');
  await waitSaved(page);
  await page.reload();
  await expect(page.locator('.comment-anchor')).toHaveText('review');
  await page.getByTestId('comments-button').click();
  await expect(page.getByTestId('comments-panel')).toContainText('Please double-check this');
  await page.getByTestId('comments-panel').getByTestId('resolve-discussion').click();
  await expect(page.getByTestId('comments-panel')).not.toContainText('Please double-check this');

  // history modal lists versions
  await page.getByTestId('history-button').click();
  await expect(page.getByTestId('history-modal')).toBeVisible();
  await expect(page.getByTestId('restore-version')).toBeVisible();
});
