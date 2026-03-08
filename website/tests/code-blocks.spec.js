import { test, expect } from './coverage.setup.js';

test.describe('Code Blocks', () => {
  test('copy button appears on hover', async ({ page }) => {
    await page.goto('/docs/getting-started/');

    await expect(page.locator('body')).toBeVisible();

    const codeBlockCount = await page.locator('pre code').count();
    expect(codeBlockCount).toBeGreaterThan(0);

    const codeWrapper = page.locator('pre').first().locator('..');
    await expect(codeWrapper).toBeVisible();

    await codeWrapper.hover();
    await expect(codeWrapper.locator('.copy-btn')).toBeVisible();
  });
});
