import { test, expect } from '@playwright/test';
import { login, newPage, focusNewBlock, blocks, waitSaved } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await login(page, 'alice@example.com');
});

test('markdown shortcuts create the right block types and persist', async ({ page }) => {
  await newPage(page, 'Shortcuts');
  await focusNewBlock(page);
  const k = page.keyboard;
  await k.type('# Heading one');
  await k.press('Enter');
  await k.type('## Heading two');
  await k.press('Enter');
  await k.type('- bullet item');
  await k.press('Enter');
  await k.press('Enter'); // empty list item -> back to text
  await k.type('1. numbered item');
  await k.press('Enter');
  await k.press('Enter');
  await k.type('[] task item');
  await k.press('Enter');
  await k.press('Enter');
  await k.type('> toggle item');
  await k.press('Enter');
  await k.type('" quoted');
  await k.press('Enter');
  await k.type('---');
  await k.type('```');
  await k.type('let a = 1;');
  await waitSaved(page);

  const expectTypes = async () => {
    await expect(page.locator('.type-heading_1 .rich')).toHaveText('Heading one');
    await expect(page.locator('.type-heading_2 .rich')).toHaveText('Heading two');
    await expect(page.locator('.type-bulleted_list .rich')).toHaveText('bullet item');
    await expect(page.locator('.type-numbered_list .rich')).toHaveText('numbered item');
    await expect(page.locator('.type-numbered_list .list-marker')).toHaveText('1.');
    await expect(page.locator('.type-to_do .rich')).toHaveText('task item');
    await expect(page.locator('.type-toggle .rich').first()).toHaveText('toggle item');
    await expect(page.locator('.type-quote .rich')).toHaveText('quoted');
    await expect(page.locator('.type-divider')).toHaveCount(1);
    await expect(page.locator('.type-code code')).toHaveText('let a = 1;');
  };
  await expectTypes();
  await page.reload();
  await expectTypes();
});

test('slash menu, inline formatting, undo and block menu', async ({ page }) => {
  await newPage(page, 'Slash menu');
  await focusNewBlock(page);
  await page.keyboard.type('/callout');
  await expect(page.getByTestId('slash-menu')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Important note');
  await expect(page.locator('.type-callout .rich')).toHaveText('Important note');
  await page.keyboard.press('Enter');

  // inline markdown + keyboard shortcut formatting
  await page.keyboard.type('Make this **bold** now');
  await expect(page.locator('.rich b').filter({ hasText: 'bold' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('italic words');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Control+i');
  await expect(page.locator('.rich i').filter({ hasText: 'italic words' })).toBeVisible();
  await page.keyboard.press('End');

  // undo removes the typed text
  await page.keyboard.press('Enter');
  await page.keyboard.type('temporary text');
  await page.waitForTimeout(1700); // new undo group
  await page.keyboard.press('Control+z');
  await expect(page.getByText('temporary text')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('temporary text')).toHaveCount(1);

  // block menu: turn into heading, then delete
  const target = page.locator('.block-wrap', { hasText: 'temporary text' });
  await target.hover();
  await target.getByTestId('block-handle').click();
  await expect(page.getByTestId('block-menu')).toBeVisible();
  await page.getByTestId('block-menu-turn').click();
  await page.getByTestId('turn-into-menu').getByText('Heading 3', { exact: true }).click();
  await expect(page.locator('.type-heading_3 .rich')).toHaveText('temporary text');
  await target.hover();
  await target.getByTestId('block-handle').click();
  await page.getByTestId('block-menu-delete').click();
  await expect(page.getByText('temporary text')).toHaveCount(0);
  await waitSaved(page);
  await page.reload();
  await expect(page.locator('.type-callout .rich')).toHaveText('Important note');
  await expect(page.getByText('temporary text')).toHaveCount(0);
});

test('enter splits, backspace merges, tab nests blocks', async ({ page }) => {
  await newPage(page, 'Structure');
  await focusNewBlock(page);
  await page.keyboard.type('HelloWorld');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(blocks(page)).toHaveCount(2);
  await expect(blocks(page).nth(0)).toHaveText('Hello');
  await expect(blocks(page).nth(1)).toHaveText('World');
  await page.keyboard.press('Backspace');
  await expect(blocks(page)).toHaveCount(1);
  await expect(blocks(page).nth(0)).toHaveText('HelloWorld');

  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- parent');
  await page.keyboard.press('Enter');
  await page.keyboard.type('child');
  await page.keyboard.press('Tab');
  await expect(page.locator('.type-bulleted_list .block-children .type-bulleted_list .rich')).toHaveText('child');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.block-children .rich', { hasText: 'child' })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await waitSaved(page);
  await page.reload();
  await expect(page.locator('.type-bulleted_list .block-children .rich')).toHaveText('child');
});

test('sub-pages, mentions, search and navigation', async ({ page }) => {
  await newPage(page, 'Parent doc');
  await focusNewBlock(page);
  await page.keyboard.type('/page');
  await page.getByTestId('slash-page').click();
  await expect(page.getByTestId('page-title')).toBeEmpty();
  await page.getByTestId('page-title').click();
  await page.keyboard.type('Child doc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Unicorn content lives here');
  await waitSaved(page);
  // breadcrumb back to parent
  await page.getByTestId('topbar').getByRole('button', { name: 'Parent doc' }).click();
  await expect(page.getByTestId('page-block')).toContainText('Child doc');
  // mention the child page with @
  await page.locator('.editor-bottom').click();
  await page.keyboard.type('See @Child');
  await expect(page.getByTestId('mention-menu')).toContainText('Child doc');
  await page.keyboard.press('Enter');
  await expect(page.locator('.mention[data-type=page]')).toHaveText('Child doc');
  await waitSaved(page);
  // search by body text
  await page.keyboard.press('Control+k');
  await page.getByTestId('search-input').fill('unicorn');
  await expect(page.getByTestId('search-result').first()).toContainText('Child doc');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-title')).toHaveText('Child doc');
  // the child shows up nested in the sidebar and has a backlink
  await expect(page.getByTestId('backlinks')).toContainText('1 backlink');
});

test('page options: icon, cover, full width, lock, favorite and dark mode', async ({ page }) => {
  await newPage(page, 'Styled page');
  await page.getByTestId('page-title').hover();
  await page.getByTestId('add-icon').click();
  await expect(page.getByTestId('page-icon')).toBeVisible();
  await page.getByTestId('page-title').hover();
  await page.getByTestId('add-cover').click();
  await expect(page.getByTestId('page-cover')).toBeVisible();
  await page.getByTestId('page-menu-button').click();
  await page.getByTestId('toggle-full-width').click();
  await expect(page.locator('.page-body.full-width')).toBeVisible();
  await page.getByTestId('toggle-lock').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('page-title')).toHaveAttribute('contenteditable', 'false');
  await page.getByTestId('favorite-button').click();
  await expect(page.getByText('Favorites')).toBeVisible();
  await page.reload();
  await expect(page.locator('.page-body.full-width')).toBeVisible();
  await expect(page.getByTestId('page-title')).toHaveAttribute('contenteditable', 'false');
  await page.keyboard.press('Control+Shift+L');
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/);
});
