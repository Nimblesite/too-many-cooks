/**
 * Theme (dark/light) helpers shared by the website Playwright suite.
 * [TEST-SUPPORT]
 */
import { expect } from '@playwright/test';
import { ATTRIBUTES, SELECTORS, STORAGE_KEYS, THEMES, WAITS } from './constants.js';
import { clearAllStorage, createStorageHelpers } from './storage.js';

export const readTheme = async (page) =>
  page.evaluate((attribute) => document.documentElement.getAttribute(attribute), ATTRIBUTES.theme);

const themeStorage = createStorageHelpers(STORAGE_KEYS.theme);

export const readStoredTheme = themeStorage.read;

export const storeTheme = themeStorage.store;

export const clearStoredTheme = themeStorage.clear;

export const clearStorage = clearAllStorage;

export const expectTheme = async (page, theme) => {
  await expect(page.locator(SELECTORS.html)).toHaveAttribute(ATTRIBUTES.theme, theme);
};

export const expectStoredTheme = async (page, theme) => {
  expect(await readStoredTheme(page)).toBe(theme);
};

export const toggleTheme = async (page) => {
  await page.click(SELECTORS.themeToggle);
};

export const toggleThemeAndRead = async (page, settleMs = WAITS.short) => {
  await toggleTheme(page);
  await page.waitForTimeout(settleMs);
  return readTheme(page);
};

export const otherTheme = (theme) => (theme === THEMES.dark ? THEMES.light : THEMES.dark);

export const emulateColorScheme = async (page, scheme) => {
  await page.emulateMedia({ colorScheme: scheme });
};

export const reloadWithStoredTheme = async (page, theme) => {
  await storeTheme(page, theme);
  await page.reload();
};

export const reloadWithClearedTheme = async (page) => {
  await clearStoredTheme(page);
  await page.reload();
};

// Load the page with no saved preference so the emulated system scheme applies.
export const gotoWithSystemScheme = async (page, path, scheme) => {
  await emulateColorScheme(page, scheme);
  await page.goto(path);
  await reloadWithClearedTheme(page);
};

// Load the page after wiping every persisted preference.
export const gotoWithClearedStorage = async (page, path) => {
  await page.goto(path);
  await clearStorage(page);
  await page.reload();
};
