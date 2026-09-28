import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { login, newPage, focusNewBlock, waitSaved } from './helpers.js';

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('database layouts: list, gallery, calendar, timeline and a formula property', async ({ page }) => {
  await login(page, 'alice@example.com');
  await newPage(page, 'Content plan');
  await page.getByTestId('convert-table').click();
  const db = page.getByTestId('database-view');
  await db.getByTestId('db-new-row').click();
  await db.getByTestId('table-row').first().locator('[data-prop="Name"]').click();
  await page.getByTestId('cell-editor').fill('Launch post');
  await page.keyboard.press('Enter');

  // number + formula properties
  await db.getByTestId('add-property').click();
  await page.getByTestId('type-number').click();
  await page.getByTestId('property-name').fill('Words');
  await page.keyboard.press('Enter');
  await db.getByTestId('table-row').first().locator('[data-prop="Words"]').click();
  await page.getByTestId('cell-editor').fill('1200');
  await page.keyboard.press('Enter');
  await db.getByTestId('add-property').click();
  await page.getByTestId('type-formula').click();
  await page.getByTestId('property-name').fill('Minutes');
  await page.getByTestId('edit-property').click();
  await page.getByTestId('formula-input').fill('round(prop("Words") / 200)');
  await page.getByTestId('formula-save').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(db.getByTestId('table-row').first().locator('[data-prop="Minutes"]')).toHaveText('6');

  // date property for calendar / timeline
  await db.getByTestId('add-property').click();
  await page.getByTestId('type-date').click();
  await page.getByTestId('property-name').fill('Publish');
  await page.keyboard.press('Enter');
  await db.getByTestId('table-row').first().locator('[data-prop="Publish"]').click();
  await page.getByTestId('date-picker').locator('.dp-day.today').click();
  await page.keyboard.press('Escape');
  await expect(db.getByTestId('table-row').first().locator('[data-prop="Publish"]')).not.toBeEmpty();

  for (const [type, testid] of [['list', 'list-row'], ['gallery', 'gallery-card'], ['calendar', 'cal-card'], ['timeline', 'timeline-bar']]) {
    await db.getByTestId('add-view').click();
    await page.getByTestId('add-view-' + type).click();
    await expect(db.getByTestId(testid).first()).toContainText('Launch post');
  }
  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('view-tab')).toHaveCount(5);
});

test('image upload via the slash menu', async ({ page }) => {
  await login(page, 'alice@example.com');
  await newPage(page, 'Photo page');
  await focusNewBlock(page);
  await page.keyboard.type('/image');
  await page.keyboard.press('Enter');
  const file = path.join(os.tmpdir(), 'e2e-pixel.png');
  fs.writeFileSync(file, PNG);
  await page.getByTestId('upload-input').setInputFiles(file);
  const img = page.locator('.type-image img');
  await expect(img).toHaveAttribute('src', /\/uploads\/.+\.png$/);
  await waitSaved(page);
  await page.reload();
  await expect(page.locator('.type-image img')).toHaveAttribute('src', /\/uploads\//);
  const src = await page.locator('.type-image img').getAttribute('src');
  const res = await page.request.get(src);
  expect(res.status()).toBe(200);
});

test('invite a member from Settings; they gain access to workspace pages', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const email = `carol-${Date.now()}@example.com`;
  await login(a, 'alice@example.com');
  await a.getByTestId('workspace-switcher').click();
  await a.getByTestId('new-workspace').click();
  await a.getByTestId('new-workspace-name').fill('Design Team');
  await a.keyboard.press('Enter');
  await expect(a.getByTestId('workspace-switcher')).toContainText('Design Team');
  await a.getByTestId('section-workspace-add').click();
  await a.getByTestId('page-title').click();
  await a.keyboard.type('Brand guidelines');
  await waitSaved(a);
  await a.getByTestId('invite-members').click();
  await a.getByTestId('invite-emails').fill(email);
  await a.getByTestId('invite-submit').click();
  await expect(a.getByText('Invitation pending')).toBeVisible();

  // Carol signs up with the invited email and lands in the workspace
  const ctxC = await browser.newContext();
  const c = await ctxC.newPage();
  await c.goto('/signup');
  await c.getByTestId('auth-email').fill(email);
  await c.getByTestId('auth-name').fill('Carol');
  await c.getByTestId('auth-password').fill('password123');
  await c.getByTestId('auth-submit').click();
  await c.getByTestId('workspace-switcher').click();
  await c.getByTestId('workspace-option').filter({ hasText: 'Design Team' }).click();
  await expect(c.getByTestId('section-workspace')).toContainText('Brand guidelines');
  await ctxA.close();
  await ctxC.close();
});
