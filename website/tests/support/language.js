/**
 * Language switcher helpers shared by the website Playwright suite.
 * [TEST-SUPPORT]
 */
import { expect } from '@playwright/test';
import {
  ATTRIBUTES,
  CLASS_PATTERNS,
  SELECTORS,
  STORAGE_KEYS,
  TEXT,
  WAITS,
} from './constants.js';
import { gotoSettled } from './page.js';
import { createStorageHelpers } from './storage.js';

export const languageLink = (page, lang) =>
  page.locator(`${SELECTORS.languageDropdown} a[lang="${lang}"]`);

export const languageSwitcher = (page) => page.locator(SELECTORS.languageSwitcher);

export const readExpandedState = async (page) =>
  page.locator(SELECTORS.languageButton).getAttribute(ATTRIBUTES.expanded);

export const openLanguageDropdown = async (page, settleMs = WAITS.handler) => {
  await page.click(SELECTORS.languageButton);
  await page.waitForTimeout(settleMs);
};

export const gotoWithLanguageDropdown = async (page, path, settleMs) => {
  await gotoSettled(page, path);
  await openLanguageDropdown(page, settleMs);
};

export const expectDropdownOpen = async (page) => {
  await expect(languageSwitcher(page)).toHaveClass(CLASS_PATTERNS.open);
};

export const expectDropdownOpenedForAssistiveTech = async (page) => {
  await expectDropdownOpen(page);
  expect(await readExpandedState(page)).toBe(TEXT.ariaTrue);
};

export const expectDropdownClosed = async (page) => {
  await expect(languageSwitcher(page)).not.toHaveClass(CLASS_PATTERNS.open);
};

export const expectLanguageLinkVisible = async (page, lang, nativeName) => {
  const link = languageLink(page, lang);
  await expect(link).toBeVisible();
  await expect(link).toHaveText(nativeName);
};

export const expectDropdownVisible = async (page) => {
  await expect(page.locator(SELECTORS.languageDropdown)).toBeVisible();
};

export const readLanguageLinkText = async (page, lang) => {
  const text = await languageLink(page, lang).textContent();
  return text.trim();
};

export const readLanguageLinkHref = async (page, lang) =>
  languageLink(page, lang).getAttribute(ATTRIBUTES.href);

export const expectActiveLanguage = async (page, lang) => {
  const activeLink = page.locator(SELECTORS.activeLanguageLink);
  await expect(activeLink).toHaveCount(1);
  expect(await activeLink.getAttribute(ATTRIBUTES.lang)).toBe(lang);
};

const langStorage = createStorageHelpers(STORAGE_KEYS.lang);

export const readStoredLang = langStorage.read;

export const storeLang = langStorage.store;

export const clearStoredLang = langStorage.clear;

export const expectStoredLang = async (page, lang) => {
  expect(await readStoredLang(page)).toBe(lang);
};

export const blockNavigation = async (link) => {
  await link.evaluate((element) => {
    element.addEventListener('click', (event) => event.preventDefault(), {
      once: true,
      capture: true,
    });
  });
};

export const clickLanguageLink = async (page, lang, options = {}) => {
  const link = languageLink(page, lang);
  if (options.preventNavigation) {
    await blockNavigation(link);
  }
  await link.click();
  await page.waitForTimeout(WAITS.short);
};

export const readHtmlLang = async (page) =>
  page.evaluate((attribute) => document.documentElement.getAttribute(attribute), ATTRIBUTES.lang);

export const expectHtmlLang = async (page, lang) => {
  expect(await readHtmlLang(page)).toBe(lang);
};

export const reloadWithStoredLang = async (page, lang) => {
  await storeLang(page, lang);
  await page.reload();
};

export const readMetaContent = async (page, property) =>
  page.evaluate((name) => {
    const meta = document.querySelector(`meta[property="${name}"]`);
    return meta ? meta.getAttribute('content') : null;
  }, property);

export const readOpenGraphLocales = async (page) =>
  page.evaluate(([localeProperty, alternateProperty]) => {
    const read = (name) => {
      const meta = document.querySelector(`meta[property="${name}"]`);
      return meta ? meta.getAttribute('content') : null;
    };
    return { locale: read(localeProperty), alternate: read(alternateProperty) };
  }, ['og:locale', 'og:locale:alternate']);

export const isLanguageTextHidden = async (page) =>
  page.evaluate(([buttonSelector, textSelector]) => {
    const button = document.querySelector(buttonSelector);
    const text = button?.querySelector(textSelector);
    if (!text) return true;
    return getComputedStyle(text).display === 'none';
  }, [SELECTORS.languageButton, SELECTORS.languageText]);
