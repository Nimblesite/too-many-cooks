import { test, expect } from './coverage.setup.js';

test.describe('Chinese Translation Pages Exist', () => {
  test('Chinese homepage loads successfully', async ({ page }) => {
    const response = await page.goto('/zh/');
    expect(response.status()).toBe(200);
  });

  test('Chinese getting started page loads successfully', async ({ page }) => {
    const response = await page.goto('/zh/docs/getting-started/');
    expect(response.status()).toBe(200);
  });

  test('Chinese how it works page loads successfully', async ({ page }) => {
    const response = await page.goto('/zh/docs/how-it-works/');
    expect(response.status()).toBe(200);
  });

  test('Chinese getting started page contains Chinese text', async ({ page }) => {
    await page.goto('/zh/docs/getting-started/');
    const bodyText = await page.evaluate(() => document.body.textContent);
    expect(bodyText).toContain('中文');
  });

  test('Chinese homepage has lang zh on html element', async ({ page }) => {
    await page.goto('/zh/');
    const lang = await page.evaluate(() => document.documentElement.getAttribute('lang'));
    expect(lang).toBe('zh');
  });

  test('Chinese nav links use Chinese translations', async ({ page }) => {
    await page.goto('/zh/');
    const docsLink = page.locator('.nav-link').first();
    const text = await docsLink.textContent();
    expect(text.trim()).toBe('文档');
  });
});
