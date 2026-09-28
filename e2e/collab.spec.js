import { test, expect } from '@playwright/test';
import { login, newPage, focusNewBlock, waitSaved, switchWorkspace } from './helpers.js';

test('two users see each other’s edits and presence in real time', async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();
  await login(alice, 'alice@example.com');
  await login(bob, 'bob@example.com');
  await switchWorkspace(alice, 'Acme Inc');
  await switchWorkspace(bob, 'Acme Inc');
  await alice.getByTestId('sidebar-page').filter({ hasText: 'Meeting Notes' }).click();
  await bob.getByTestId('sidebar-page').filter({ hasText: 'Meeting Notes' }).click();
  await expect(bob.getByTestId('page-title')).toHaveText('Meeting Notes');

  // presence
  await expect(alice.getByTestId('presence')).toBeVisible();
  await expect(bob.getByTestId('presence')).toBeVisible();

  // Alice types, Bob sees it without reloading
  await alice.getByText('Bob: write migration runbook').click();
  await alice.keyboard.press('End');
  await alice.keyboard.press('Enter');
  await alice.keyboard.type('Carol: book the offsite');
  await expect(bob.getByText('Carol: book the offsite')).toBeVisible({ timeout: 10_000 });

  // Bob edits the title, Alice's title + sidebar update
  await bob.getByTestId('page-title').click();
  await bob.keyboard.press('End');
  await bob.keyboard.type(' (Q3)');
  await expect(alice.getByTestId('page-title')).toHaveText('Meeting Notes (Q3)', { timeout: 10_000 });
  await expect(alice.getByTestId('sidebar-page').filter({ hasText: 'Meeting Notes (Q3)' })).toBeVisible();

  // Bob adds a comment; Alice sees it in the comments panel
  await bob.getByTestId('comments-button').click();
  await bob.getByTestId('page-title').hover();
  await bob.getByRole('button', { name: 'Add comment' }).click();
  await bob.getByTestId('comment-input').click();
  await bob.keyboard.type('Can we move this to Friday?');
  await bob.keyboard.press('Enter');
  await expect(alice.getByTestId('page-comments')).toContainText('Can we move this to Friday?', { timeout: 10_000 });

  await aliceCtx.close();
  await bobCtx.close();
});

test('sharing: invite with view access, upgrade to edit, revoke', async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();
  await login(alice, 'alice@example.com');
  const pageId = await newPage(alice, 'Salary review');
  await focusNewBlock(alice);
  await alice.keyboard.type('Confidential numbers');
  await waitSaved(alice);

  await login(bob, 'bob@example.com');
  await bob.goto('/p/' + pageId);
  await expect(bob.getByText('does not exist, or you do not have access')).toBeVisible();

  // Alice shares with Bob (view only)
  await alice.getByTestId('share-button').click();
  await alice.getByTestId('share-email').fill('bob@example.com');
  await alice.getByTestId('share-menu').getByTestId('role-picker').first().click();
  await alice.getByText('Can view', { exact: true }).click();
  await alice.getByTestId('share-invite').click();
  await expect(alice.getByTestId('share-person').filter({ hasText: 'Bob Martinez' })).toContainText('Can view');
  await alice.keyboard.press('Escape');

  await bob.reload();
  await expect(bob.getByTestId('page-title')).toHaveText('Salary review');
  await expect(bob.getByTestId('page-title')).toHaveAttribute('contenteditable', 'false');
  await expect(bob.locator('.editor .rich').first()).toHaveAttribute('contenteditable', 'false');
  // it appears in Bob's "Shared" sidebar section of Alice's workspace
  await expect(bob.getByTestId('section-shared')).toContainText('Salary review');
  // Bob got an inbox notification
  await bob.getByTestId('nav-inbox').click();
  await expect(bob.getByTestId('inbox-item').first()).toContainText('invited you to');
  await bob.keyboard.press('Escape');

  // upgrade to edit
  await alice.getByTestId('share-button').click();
  await alice.getByTestId('share-person').filter({ hasText: 'Bob Martinez' }).getByTestId('role-picker').click();
  await alice.getByText('Can edit', { exact: true }).click();
  await alice.keyboard.press('Escape');
  await bob.reload();
  await expect(bob.locator('.editor .rich').first()).toHaveAttribute('contenteditable', 'true');
  await bob.locator('.editor .rich').first().click();
  await bob.keyboard.press('End');
  await bob.keyboard.type(' (approved)');
  await expect(alice.getByText('Confidential numbers (approved)')).toBeVisible({ timeout: 10_000 });

  // revoke
  await alice.getByTestId('share-button').click();
  await alice.getByTestId('share-person').filter({ hasText: 'Bob Martinez' }).getByTestId('role-picker').click();
  await alice.getByText('Remove', { exact: true }).click();
  await alice.keyboard.press('Escape');
  await bob.reload();
  await expect(bob.getByText('does not exist, or you do not have access')).toBeVisible();

  await aliceCtx.close();
  await bobCtx.close();
});

test('publish to web shows a read-only public page to anonymous visitors', async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  await login(alice, 'alice@example.com');
  const pageId = await newPage(alice, 'Launch announcement');
  await focusNewBlock(alice);
  await alice.keyboard.type('We are live!');
  await waitSaved(alice);
  await alice.getByTestId('share-button').click();
  await alice.getByTestId('publish-tab').click();
  await alice.getByTestId('publish').click();
  await expect(alice.getByTestId('public-link')).toHaveValue(new RegExp(`/share/${pageId}$`));

  const anonCtx = await browser.newContext();
  const anon = await anonCtx.newPage();
  await anon.goto('/share/' + pageId);
  await expect(anon.getByTestId('public-page')).toContainText('Launch announcement');
  await expect(anon.getByText('We are live!')).toBeVisible();
  await expect(anon.locator('[contenteditable=true]')).toHaveCount(0);

  await alice.getByTestId('unpublish').click();
  await anon.reload();
  await expect(anon.getByText('This page is not published')).toBeVisible();
  await aliceCtx.close();
  await anonCtx.close();
});
