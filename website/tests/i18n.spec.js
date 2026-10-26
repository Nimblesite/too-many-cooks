import { test, expect } from './coverage.setup.js';
import {
  ALLOWED_LOCALES,
  LANGS,
  PATHS,
  SELECTORS,
  TEXT,
} from './support/constants.js';
import {
  clickLanguageLink,
  clearStoredLang,
  expectActiveLanguage,
  expectHtmlLang,
  expectLanguageLinkVisible,
  expectStoredLang,
  gotoWithLanguageDropdown,
  openLanguageDropdown,
  readLanguageLinkHref,
  readLanguageLinkText,
  readMetaContent,
  readOpenGraphLocales,
  reloadWithStoredLang,
} from './support/language.js';
import { gotoSettled } from './support/page.js';

const DROPDOWN_PAGES = [
  { title: 'language dropdown contains Chinese option', path: PATHS.home },
  { title: 'language dropdown contains Chinese option on docs page', path: PATHS.gettingStarted },
];

const PREFERENCE_SAVING_CASES = [
  { title: 'Chinese language link saves zh preference to localStorage', lang: LANGS.zh },
  { title: 'English language link saves en preference to localStorage', lang: LANGS.en },
];

const NATIVE_NAME_CASES = [
  {
    title: 'Chinese language entry exists in languages.json with correct nativeName',
    lang: LANGS.zh,
    nativeName: TEXT.zhNativeName,
  },
  {
    title: 'English language entry exists in languages.json with correct nativeName',
    lang: LANGS.en,
    nativeName: TEXT.enNativeName,
  },
];

const HTML_LANG_CASES = [
  { title: 'default html lang is en', storedLang: null, expected: LANGS.en },
  {
    title: 'html lang updates to zh when Chinese preference is saved',
    storedLang: LANGS.zh,
    expected: LANGS.zh,
  },
  {
    title: 'html lang stays en when English preference is saved',
    storedLang: LANGS.en,
    expected: LANGS.en,
  },
];

const OG_LOCALE_CASES = [
  { title: 'homepage has og:locale meta tag', property: 'og:locale' },
  { title: 'homepage has og:locale:alternate meta tag', property: 'og:locale:alternate' },
];

const HREF_CASES = [
  { title: 'Chinese link href points to zh prefixed path', lang: LANGS.zh, prefixed: true },
  { title: 'English link href does not contain zh prefix', lang: LANGS.en, prefixed: false },
];

const ZH_PREFIX = `/${LANGS.zh}/`;

test.describe('Chinese Translation - Language Dropdown', () => {
  for (const { title, path } of DROPDOWN_PAGES) {
    test(title, async ({ page }) => {
      await gotoWithLanguageDropdown(page, path);

      await expectLanguageLinkVisible(page, LANGS.zh, TEXT.zhNativeName);
    });
  }

  for (const { title, lang } of PREFERENCE_SAVING_CASES) {
    test(title, async ({ page }) => {
      await gotoSettled(page, PATHS.home);
      await clearStoredLang(page);
      await openLanguageDropdown(page);

      await clickLanguageLink(page, lang, { preventNavigation: true });

      await expectStoredLang(page, lang);
    });
  }
});

test.describe('Chinese Translation - i18n Data Completeness', () => {
  test('Chinese i18n data has all keys that English has', async ({ page }) => {
    await page.goto(PATHS.home);

    const ok = await page.evaluate(async (path) => {
      const response = await fetch(path);
      return response.ok;
    }, PATHS.gettingStarted);

    expect(ok).toBe(true);
  });

  for (const { title, lang, nativeName } of NATIVE_NAME_CASES) {
    test(title, async ({ page }) => {
      await gotoWithLanguageDropdown(page, PATHS.home);

      expect(await readLanguageLinkText(page, lang)).toBe(nativeName);
    });
  }
});

test.describe('Chinese Translation - HTML lang Attribute', () => {
  for (const { title, storedLang, expected } of HTML_LANG_CASES) {
    test(title, async ({ page }) => {
      await page.goto(PATHS.home);

      if (storedLang) {
        await reloadWithStoredLang(page, storedLang);
      } else {
        await clearStoredLang(page);
        await page.reload();
      }

      await expectHtmlLang(page, expected);
    });
  }
});

test.describe('Chinese Translation - OG Locale Meta Tags', () => {
  for (const { title, property } of OG_LOCALE_CASES) {
    test(title, async ({ page }) => {
      await page.goto(PATHS.home);

      const content = await readMetaContent(page, property);
      expect(content).not.toBeNull();
      expect(ALLOWED_LOCALES).toContain(content);
    });
  }

  test('og:locale and og:locale:alternate are different', async ({ page }) => {
    await page.goto(PATHS.home);

    const locales = await readOpenGraphLocales(page);
    expect(locales.locale).not.toBe(locales.alternate);
  });
});

test.describe('Chinese Translation - Language Switcher Links', () => {
  for (const { title, lang, prefixed } of HREF_CASES) {
    test(title, async ({ page }) => {
      await gotoWithLanguageDropdown(page, PATHS.gettingStarted);

      const href = await readLanguageLinkHref(page, lang);
      if (prefixed) {
        expect(href).toContain(ZH_PREFIX);
      } else {
        expect(href).not.toContain(ZH_PREFIX);
      }
    });
  }

  test('both language options are present in dropdown', async ({ page }) => {
    await gotoWithLanguageDropdown(page, PATHS.home);

    expect(await page.locator(SELECTORS.languageLinks).count()).toBe(Object.keys(LANGS).length);
  });

  test('active language is marked with active class', async ({ page }) => {
    await gotoWithLanguageDropdown(page, PATHS.home);

    await expectActiveLanguage(page, LANGS.en);
  });
});
