import { test, expect } from '@playwright/test';
import { login, newPage, focusNewBlock, waitSaved, switchWorkspace } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await login(page, 'alice@example.com');
});

test('inline database: rows, properties, board view, filters and persistence', async ({ page }) => {
  await newPage(page, 'Roadmap');
  await focusNewBlock(page);
  await page.keyboard.type('/table view');
  await page.getByTestId('slash-db-table').click();
  const db = page.getByTestId('database-view');
  await expect(db).toBeVisible();
  await db.getByTestId('inline-db-title').fill('Features');

  // two rows
  await db.getByTestId('db-new-row').click();
  await db.getByTestId('db-new-row').click();
  await expect(db.getByTestId('table-row')).toHaveCount(2);
  const row1 = db.getByTestId('table-row').nth(0);
  await row1.locator('[data-prop="Name"]').click();
  await page.getByTestId('cell-editor').fill('Dark mode');
  await page.keyboard.press('Enter');
  const row2 = db.getByTestId('table-row').nth(1);
  await row2.locator('[data-prop="Name"]').click();
  await page.getByTestId('cell-editor').fill('Offline sync');
  await page.keyboard.press('Enter');
  await expect(row1).toContainText('Dark mode');

  // add a Select property named Stage
  await db.getByTestId('add-property').click();
  await page.getByTestId('type-select').click();
  await expect(page.getByTestId('property-menu')).toBeVisible();
  await page.getByTestId('property-name').fill('Stage');
  await page.keyboard.press('Enter');
  await expect(db.getByTestId('table-header').filter({ hasText: 'Stage' })).toBeVisible();

  // set values (creating options)
  await row1.locator('[data-prop="Stage"]').click();
  await page.getByTestId('select-search').fill('Shipped');
  await page.keyboard.press('Enter');
  await expect(row1.locator('[data-prop="Stage"]')).toContainText('Shipped');
  await row2.locator('[data-prop="Stage"]').click();
  await page.getByTestId('select-search').fill('Planned');
  await page.keyboard.press('Enter');
  await expect(row2.locator('[data-prop="Stage"]')).toContainText('Planned');

  // filter by Stage = Shipped
  await db.getByTestId('db-filter').click();
  await page.getByTestId('pick-prop-Stage').click();
  await page.getByTestId('filter-editor').getByText('Shipped').click();
  await page.keyboard.press('Escape');
  await expect(db.getByTestId('table-row')).toHaveCount(1);
  await expect(db.getByTestId('filter-pill')).toContainText('Stage: Shipped');
  await db.getByTestId('filter-pill').click();
  await page.getByTestId('delete-filter').click();
  await expect(db.getByTestId('table-row')).toHaveCount(2);

  // sort descending by name
  await db.getByTestId('table-header').filter({ hasText: 'Name' }).click();
  await page.getByTestId('sort-desc').click();
  await expect(db.getByTestId('table-row').nth(0)).toContainText('Offline sync');

  // board view grouped by Stage
  await db.getByTestId('add-view').click();
  await page.getByTestId('add-view-board').click();
  await expect(db.getByTestId('board-view')).toBeVisible();
  await db.getByTestId('db-settings').click();
  await page.getByTestId('settings-group').click();
  await page.getByTestId('group-by-Stage').click();
  await page.keyboard.press('Escape');
  await expect(db.getByTestId('board-column').filter({ hasText: 'Shipped' }).getByTestId('board-card')).toContainText('Dark mode');

  // drag a card to another column
  const card = db.getByTestId('board-card').filter({ hasText: 'Offline sync' });
  await card.dragTo(db.getByTestId('board-column').filter({ hasText: 'Shipped' }));
  await expect(db.getByTestId('board-column').filter({ hasText: 'Shipped' }).getByTestId('board-card')).toHaveCount(2);

  await waitSaved(page);
  await page.reload();
  const db2 = page.getByTestId('database-view');
  await expect(db2.getByTestId('inline-db-title')).toHaveValue('Features');
  await expect(db2.getByTestId('view-tab')).toHaveCount(2);
  await db2.getByTestId('view-tab').first().click();
  await expect(db2.getByTestId('table-row')).toHaveCount(2);
  await expect(db2.getByTestId('table-row').nth(0)).toContainText('Offline sync');
  await expect(db2.getByTestId('table-row').nth(0)).toContainText('Shipped');
});

test('row pages open in side peek with editable properties and content', async ({ page }) => {
  await switchWorkspace(page, 'Acme Inc');
  const wiki = page.getByTestId('sidebar-page').filter({ hasText: 'Team Wiki' });
  await wiki.hover();
  await wiki.getByTestId('sidebar-toggle').click();
  await page.getByTestId('sidebar-page').filter({ hasText: 'Projects' }).click();
  const db = page.getByTestId('database-view');
  const row = db.getByTestId('table-row').filter({ hasText: 'Customer portal' });
  await row.hover();
  await row.getByTestId('open-row').click();
  const peek = page.getByTestId('peek');
  await expect(peek.getByTestId('page-title')).toHaveText('Customer portal');
  // edit a property from the peek
  await peek.locator('.prop-row[data-prop="Budget"] [data-testid=prop-value]').click();
  await page.getByTestId('cell-editor').fill('20000');
  await page.keyboard.press('Enter');
  await expect(peek.locator('.prop-row[data-prop="Budget"]')).toContainText('$20,000.00');
  // write in the row page body
  await peek.getByTestId('page-title').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Scope agreed with sales');
  await waitSaved(page);
  await page.getByTestId('peek-close').click();
  await expect(peek).toHaveCount(0);
  await expect(db.getByTestId('table-row').filter({ hasText: 'Customer portal' })).toContainText('$20,000.00');
  // reopen: content persisted
  await row.hover();
  await row.getByTestId('open-row').click();
  await expect(page.getByTestId('peek').getByText('Scope agreed with sales')).toBeVisible();
});

test('empty page can become a full-page board database', async ({ page }) => {
  await newPage(page, 'Sprint board');
  await page.getByTestId('convert-board').click();
  const db = page.getByTestId('database-view');
  await expect(db.getByTestId('board-view')).toBeVisible();
  await expect(db.getByTestId('board-column')).toHaveCount(4); // No Status + 3 status options
  await db.getByTestId('board-column').filter({ hasText: 'In progress' }).getByText('New page').click();
  await page.getByTestId('card-title-input').fill('Build feature');
  await page.keyboard.press('Enter');
  await expect(db.getByTestId('board-column').filter({ hasText: 'In progress' }).getByTestId('board-card')).toContainText('Build feature');
  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('board-column').filter({ hasText: 'In progress' }).getByTestId('board-card')).toContainText('Build feature');
});
