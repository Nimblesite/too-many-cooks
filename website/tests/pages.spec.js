import { test, expect } from './coverage.setup.js';

test.describe('Homepage', () => {
  test('homepage loads with all essential elements', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Too Many Cooks/i);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('nav')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();

    const docsLinks = await page.locator('a[href*="/docs/"]').count();
    expect(docsLinks).toBeGreaterThan(0);

    await expect(page.locator('a[href*="github.com"]').first()).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
  });
});

test.describe('Docs Pages', () => {
  test('getting started page loads with content', async ({ page }) => {
    const response = await page.goto('/docs/getting-started/');

    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveTitle(/Getting Started/i);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('#docs-sidebar')).toBeVisible();

    const headings = await page.locator('h1, h2, h3').count();
    expect(headings).toBeGreaterThan(0);
  });

  test('all tool docs pages load', async ({ page }) => {
    const pages = [
      { url: '/docs/how-it-works/', title: 'How It Works' },
      { url: '/docs/register/', title: 'Register' },
      { url: '/docs/lock/', title: 'Lock' },
      { url: '/docs/messages/', title: 'Messages' },
      { url: '/docs/plans/', title: 'Plans' },
      { url: '/docs/status/', title: 'Status' },
    ];

    for (const p of pages) {
      const response = await page.goto(p.url);
      expect(response?.status()).toBe(200);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.locator('main')).toBeVisible();
    }
  });
});

test.describe('XML Feeds', () => {
  test('sitemap exists with valid XML', async ({ page }) => {
    const response = await page.goto('/sitemap.xml');
    expect(response?.status()).toBe(200);
    const content = await page.content();
    expect(content).toContain('urlset');
    expect(content).toContain('<url>');
    expect(content).toContain('/docs/');
  });
});
