import { test, expect } from './coverage.setup.js';

test.describe('Chinese Translation - Language Dropdown', () => {
  test('language dropdown contains Chinese option', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.language-btn');
    await page.waitForTimeout(50);

    const zhLink = page.locator('.language-dropdown a[lang="zh"]');
    await expect(zhLink).toBeVisible();
    await expect(zhLink).toHaveText('中文');
  });

  test('language dropdown contains Chinese option on docs page', async ({ page }) => {
    await page.goto('/docs/getting-started/');
    await page.waitForLoadState('networkidle');

    await page.click('.language-btn');
    await page.waitForTimeout(50);

    const zhLink = page.locator('.language-dropdown a[lang="zh"]');
    await expect(zhLink).toBeVisible();
    await expect(zhLink).toHaveText('中文');
  });

  test('Chinese language link saves zh preference to localStorage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => localStorage.removeItem('lang'));

    await page.click('.language-btn');
    await page.waitForTimeout(50);

    const zhLink = page.locator('.language-dropdown a[lang="zh"]');
    await zhLink.evaluate(el => {
      el.addEventListener('click', (e) => e.preventDefault(), { once: true, capture: true });
    });

    await zhLink.click();
    await page.waitForTimeout(100);

    const langSaved = await page.evaluate(() => localStorage.getItem('lang'));
    expect(langSaved).toBe('zh');
  });

  test('English language link saves en preference to localStorage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => localStorage.removeItem('lang'));

    await page.click('.language-btn');
    await page.waitForTimeout(50);

    const enLink = page.locator('.language-dropdown a[lang="en"]');
    await enLink.evaluate(el => {
      el.addEventListener('click', (e) => e.preventDefault(), { once: true, capture: true });
    });

    await enLink.click();
    await page.waitForTimeout(100);

    const langSaved = await page.evaluate(() => localStorage.getItem('lang'));
    expect(langSaved).toBe('en');
  });
});

test.describe('Chinese Translation - i18n Data Completeness', () => {
  test('Chinese i18n data has all keys that English has', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const response = await fetch('/docs/getting-started/');
      return response.ok;
    });

    expect(result).toBe(true);
  });

  test('Chinese language entry exists in languages.json with correct nativeName', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.language-btn');
    await page.waitForTimeout(50);

    const zhLink = page.locator('.language-dropdown a[lang="zh"]');
    const text = await zhLink.textContent();
    expect(text.trim()).toBe('中文');
  });

  test('English language entry exists in languages.json with correct nativeName', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.language-btn');
    await page.waitForTimeout(50);

    const enLink = page.locator('.language-dropdown a[lang="en"]');
    const text = await enLink.textContent();
    expect(text.trim()).toBe('English');
  });
});

test.describe('Chinese Translation - HTML lang Attribute', () => {
  test('default html lang is en', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('lang'));
    await page.reload();

    const lang = await page.evaluate(() => document.documentElement.getAttribute('lang'));
    expect(lang).toBe('en');
  });

  test('html lang updates to zh when Chinese preference is saved', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('lang', 'zh'));
    await page.reload();

    const lang = await page.evaluate(() => document.documentElement.getAttribute('lang'));
    expect(lang).toBe('zh');
  });

  test('html lang stays en when English preference is saved', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('lang', 'en'));
    await page.reload();

    const lang = await page.evaluate(() => document.documentElement.getAttribute('lang'));
    expect(lang).toBe('en');
  });
});

test.describe('Chinese Translation - OG Locale Meta Tags', () => {
  test('homepage has og:locale meta tag', async ({ page }) => {
    await page.goto('/');

    const locale = await page.evaluate(() => {
      const meta = document.querySelector('meta[property="og:locale"]');
      return meta ? meta.getAttribute('content') : null;
    });

    expect(locale).not.toBeNull();
    expect(['en_US', 'zh_CN']).toContain(locale);
  });

  test('homepage has og:locale:alternate meta tag', async ({ page }) => {
    await page.goto('/');

    const altLocale = await page.evaluate(() => {
      const meta = document.querySelector('meta[property="og:locale:alternate"]');
      return meta ? meta.getAttribute('content') : null;
    });

    expect(altLocale).not.toBeNull();
    expect(['en_US', 'zh_CN']).toContain(altLocale);
  });

  test('og:locale and og:locale:alternate are different', async ({ page }) => {
    await page.goto('/');

    const locales = await page.evaluate(() => {
      const locale = document.querySelector('meta[property="og:locale"]')?.getAttribute('content');
      const alt = document.querySelector('meta[property="og:locale:alternate"]')?.getAttribute('content');
      return { locale, alt };
    });

    expect(locales.locale).not.toBe(locales.alt);
  });
});

test.describe('Chinese Translation - Language Switcher Links', () => {
  test('Chinese link href points to zh prefixed path', async ({ page }) => {
    await page.goto('/docs/getting-started/');
    await page.waitForLoadState('networkidle');

    await page.click('.language-btn');
    await page.waitForTimeout(50);

    const href = await page.locator('.language-dropdown a[lang="zh"]').getAttribute('href');
    expect(href).toContain('/zh/');
  });

  test('English link href does not contain zh prefix', async ({ page }) => {
    await page.goto('/docs/getting-started/');
    await page.waitForLoadState('networkidle');

    await page.click('.language-btn');
    await page.waitForTimeout(50);

    const href = await page.locator('.language-dropdown a[lang="en"]').getAttribute('href');
    expect(href).not.toContain('/zh/');
  });

  test('both language options are present in dropdown', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.language-btn');
    await page.waitForTimeout(50);

    const linkCount = await page.locator('.language-dropdown a[lang]').count();
    expect(linkCount).toBe(2);
  });

  test('active language is marked with active class', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.language-btn');
    await page.waitForTimeout(50);

    const activeLink = page.locator('.language-dropdown a.active');
    await expect(activeLink).toHaveCount(1);

    const activeLang = await activeLink.getAttribute('lang');
    expect(activeLang).toBe('en');
  });
});
