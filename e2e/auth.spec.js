import { test, expect } from '@playwright/test';
import { login, PASSWORD } from './helpers.js';

test('sign up, log out and log back in', async ({ page }) => {
  const email = `new-${Date.now()}@example.com`;
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByText('Sign up').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-name').fill('Grace Hopper');
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('home')).toContainText('Grace');
  await expect(page.getByTestId('workspace-switcher')).toContainText("Grace's Notion");
  // onboarding page is created for new accounts
  await page.getByTestId('sidebar-page').filter({ hasText: 'Getting Started' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Getting Started');

  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('wrong-password');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByRole('alert')).toContainText('Incorrect email or password');
  await login(page, email);
  await expect(page.getByTestId('home')).toBeVisible();
});

test('protected routes redirect to login and back', async ({ page }) => {
  await page.goto('/p/does-not-exist');
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByTestId('auth-email').fill('alice@example.com');
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page).toHaveURL(/\/p\/does-not-exist/);
  await expect(page.getByText('does not exist, or you do not have access')).toBeVisible();
});
