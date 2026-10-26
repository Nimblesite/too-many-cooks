import { test, expect } from './coverage.setup.js';
import { LANGS, PATHS, SELECTORS, TEXT } from './support/constants.js';
import { expectHtmlLang } from './support/language.js';
import { gotoExpectOk, gotoSettled } from './support/page.js';

const CHINESE_PAGES = [
  { title: 'Chinese homepage loads successfully', path: PATHS.zhHome },
  { title: 'Chinese getting started page loads successfully', path: PATHS.zhGettingStarted },
  { title: 'Chinese how it works page loads successfully', path: PATHS.zhHowItWorks },
];

test.describe('Chinese Translation Pages Exist', () => {
  for (const { title, path } of CHINESE_PAGES) {
    test(title, async ({ page }) => {
      await gotoExpectOk(page, path);
    });
  }

  test('Chinese getting started page contains Chinese text', async ({ page }) => {
    await gotoSettled(page, PATHS.zhGettingStarted);

    const bodyText = await page.evaluate(() => document.body.textContent);
    expect(bodyText).toContain(TEXT.zhNativeName);
  });

  test('Chinese homepage has lang zh on html element', async ({ page }) => {
    await gotoSettled(page, PATHS.zhHome);

    await expectHtmlLang(page, LANGS.zh);
  });

  test('Chinese nav links use Chinese translations', async ({ page }) => {
    await gotoSettled(page, PATHS.zhHome);

    const docsLink = page.locator(SELECTORS.navLink).first();
    const text = await docsLink.textContent();
    expect(text.trim()).toBe(TEXT.zhDocsNavLink);
  });
});
