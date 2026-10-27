/**
 * Targeted tests specifically designed to hit uncovered code paths.
 * These tests focus on ensuring event handlers execute within V8 coverage tracking.
 */
import { test, expect } from './coverage.setup.js';
import {
  ALLOWED_THEMES,
  CLIPBOARD_PERMISSIONS,
  LANGS,
  PATHS,
  SELECTORS,
  TEXT,
  THRESHOLDS,
  TIMEOUTS,
  WAITS,
} from './support/constants.js';
import {
  dispatchCodeHover,
  expectCopyButtonText,
  firstCopyButton,
  readCodeText,
  readCopyButtonOpacity,
  showCopyButtonByHover,
} from './support/code-blocks.js';
import {
  expectMobileMenuClosed,
  expectMobileMenuToggled,
  expectSidebarToggled,
  hoverNavigation,
  openMobileMenu,
  readOpacity,
  sidebar,
} from './support/layout.js';
import {
  clickLanguageLink,
  clearStoredLang,
  expectDropdownClosed,
  expectDropdownOpenedForAssistiveTech,
  expectDropdownVisible,
  expectStoredLang,
  openLanguageDropdown,
} from './support/language.js';
import {
  expectVisible,
  gotoMobileSettled,
  gotoSettled,
  waitForVisible,
} from './support/page.js';
import { readTheme, toggleThemeAndRead } from './support/theme.js';

const LANGUAGE_PREFERENCE_CASES = [
  {
    title: 'language link click saves preference',
    lang: LANGS.en,
    preventNavigation: false,
  },
  {
    title: 'language link click zh saves preference',
    lang: LANGS.zh,
    preventNavigation: true,
  },
];

const gotoDocsPage = async (page) => {
  await gotoSettled(page, PATHS.gettingStarted);
  await page.waitForTimeout(WAITS.pageSettled);
};

test.describe('Event Handler Coverage', () => {
  test('theme toggle click handler executes', async ({ page }) => {
    await page.goto(PATHS.gettingStarted);
    await waitForVisible(page, SELECTORS.themeToggle);

    const initialTheme = await readTheme(page);

    const newTheme = await toggleThemeAndRead(page);
    expect(newTheme).not.toBe(initialTheme);
    expect(ALLOWED_THEMES).toContain(newTheme);
  });

  test('language button click opens dropdown', async ({ page }) => {
    await gotoDocsPage(page);

    await openLanguageDropdown(page);

    await expectDropdownOpenedForAssistiveTech(page);
  });

  for (const { title, lang, preventNavigation } of LANGUAGE_PREFERENCE_CASES) {
    test(title, async ({ page }) => {
      await gotoDocsPage(page);
      await clearStoredLang(page);

      await openLanguageDropdown(page);
      await expectDropdownVisible(page);

      await clickLanguageLink(page, lang, { preventNavigation });

      await expectStoredLang(page, lang);
    });
  }

  test('click outside closes language dropdown', async ({ page }) => {
    await gotoDocsPage(page);

    await openLanguageDropdown(page);
    await expectDropdownVisible(page);

    await page.evaluate(() => {
      document.body.click();
    });
    await page.waitForTimeout(WAITS.short);

    await expectDropdownClosed(page);
  });

  test('escape key closes language dropdown', async ({ page }) => {
    await gotoDocsPage(page);

    await openLanguageDropdown(page);
    await expectDropdownVisible(page);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(WAITS.short);

    await expectDropdownClosed(page);
  });

  test('mobile menu toggle click', async ({ page }) => {
    await gotoMobileSettled(page, PATHS.home);
    await page.waitForTimeout(WAITS.pageSettled);

    await expectMobileMenuToggled(page, WAITS.short);
  });

  test('click outside closes mobile menu', async ({ page }) => {
    await gotoMobileSettled(page, PATHS.home);
    await page.waitForTimeout(WAITS.pageSettled);

    await openMobileMenu(page);

    await page.evaluate((selector) => {
      const main = document.querySelector(selector);
      if (main) main.click();
    }, SELECTORS.main);
    await page.waitForTimeout(WAITS.short);

    await expectMobileMenuClosed(page);
  });

  test('sidebar toggle click', async ({ page }) => {
    await gotoMobileSettled(page, PATHS.gettingStarted);
    await page.waitForTimeout(WAITS.pageSettled);

    await expectVisible(sidebar(page).toggle);

    await expectSidebarToggled(page);
  });

  test('anchor link smooth scroll', async ({ page }) => {
    await gotoDocsPage(page);

    // The smooth scroll handler attaches to every `a[href^="#"]` at page load.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(WAITS.short);

    const scrollResult = await page.evaluate(() => {
      const anchors = document.querySelectorAll('a[href^="#"]');
      for (const anchor of anchors) {
        const href = anchor.getAttribute('href');
        if (!href || href === '#') continue;

        const targetId = href.substring(1);
        const target = document.getElementById(targetId);

        if (target) {
          anchor.click();
          return { clicked: true, targetId };
        }
      }
      return { clicked: false };
    });

    if (scrollResult.clicked) {
      await page.waitForTimeout(WAITS.smoothScroll);

      const inViewport = await page.evaluate((id) => {
        const target = document.getElementById(id);
        if (!target) return false;
        const rect = target.getBoundingClientRect();
        return rect.top >= -100 && rect.top < window.innerHeight;
      }, scrollResult.targetId);

      expect(inViewport).toBe(true);
    }
  });

  test('code block mouseenter shows copy button', async ({ page }) => {
    await gotoDocsPage(page);
    await showCopyButtonByHover(page);

    expect(await readCopyButtonOpacity(page)).toBeGreaterThan(THRESHOLDS.opacityVisible);
  });

  test('code block mouseleave hides copy button', async ({ page }) => {
    await gotoDocsPage(page);
    await showCopyButtonByHover(page);

    await hoverNavigation(page);

    expect(await readCopyButtonOpacity(page)).toBeLessThan(THRESHOLDS.opacityHidden);
  });

  test('copy button click copies code', async ({ page, context }) => {
    await context.grantPermissions(CLIPBOARD_PERMISSIONS);
    await gotoDocsPage(page);

    const codeText = await readCodeText(page);

    await dispatchCodeHover(page);

    const copyBtn = firstCopyButton(page);
    await copyBtn.click();
    await page.waitForTimeout(WAITS.short);

    await expectCopyButtonText(page, TEXT.copyDone);

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(codeText);

    // The button resets to its idle label after 2000ms.
    await page.waitForTimeout(WAITS.clipboardReset);
    await expectCopyButtonText(page, TEXT.copyIdle, { timeout: TIMEOUTS.copyReset });
  });

  test('copy button shows Failed on error', async ({ page }) => {
    await gotoDocsPage(page);

    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error('Denied');
      };
    });

    await dispatchCodeHover(page);

    await firstCopyButton(page).click();
    await page.waitForTimeout(WAITS.short);

    await expectCopyButtonText(page, TEXT.copyFailed);
  });

  test('heading anchor mouseenter/leave', async ({ page }) => {
    await gotoDocsPage(page);

    const heading = page.locator(SELECTORS.headingWithAnchor).first();
    const anchor = heading.locator(SELECTORS.headingAnchor);

    if ((await heading.count()) === 0 || (await anchor.count()) === 0) {
      // No headings with anchors - nothing to verify.
      return;
    }

    await heading.hover();
    await page.waitForTimeout(WAITS.style);

    expect(await readOpacity(anchor)).toBeGreaterThan(THRESHOLDS.opacityVisible);

    await hoverNavigation(page);

    expect(await readOpacity(anchor)).toBeLessThan(THRESHOLDS.opacityHidden);
  });
});
