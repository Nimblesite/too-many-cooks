import { test, expect } from './coverage.setup.js';
import {
  PATHS,
  SELECTORS,
  TITLES,
  TOOL_DOC_PATHS,
} from './support/constants.js';
import {
  expectBodyVisible,
  expectCountAboveZero,
  expectVisible,
  expectVisibleAll,
  gotoExpectOk,
} from './support/page.js';

test.describe('Homepage', () => {
  test('homepage loads with all essential elements', async ({ page }) => {
    await gotoExpectOk(page, PATHS.home);

    await expect(page).toHaveTitle(TITLES.home);
    await expectBodyVisible(page);
    await expectVisibleAll(page, [SELECTORS.nav, SELECTORS.main]);
    await expectCountAboveZero(page.locator(SELECTORS.docsLinks));
    await expectVisible(page.locator(SELECTORS.githubLink).first());
    await expectVisible(page.locator(SELECTORS.footer));
  });
});

test.describe('Docs Pages', () => {
  test('getting started page loads with content', async ({ page }) => {
    await gotoExpectOk(page, PATHS.gettingStarted);

    await expectBodyVisible(page);
    await expect(page).toHaveTitle(TITLES.gettingStarted);
    await expectVisibleAll(page, [SELECTORS.main, SELECTORS.docsSidebar]);
    await expectCountAboveZero(page.locator(SELECTORS.headings));
  });

  test('all tool docs pages load', async ({ page }) => {
    for (const path of TOOL_DOC_PATHS) {
      await gotoExpectOk(page, path);
      await expectBodyVisible(page);
      await expectVisible(page.locator(SELECTORS.main));
    }
  });
});

test.describe('XML Feeds', () => {
  test('sitemap exists with valid XML', async ({ page }) => {
    await gotoExpectOk(page, PATHS.sitemap);

    const content = await page.content();
    expect(content).toContain('urlset');
    expect(content).toContain('<url>');
    expect(content).toContain('/docs/');
  });
});
