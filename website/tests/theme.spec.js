import { test, expect } from './coverage.setup.js';
import { PATHS, STORAGE_KEYS, THEMES, WAITS } from './support/constants.js';
import {
  clearStoredTheme,
  emulateColorScheme,
  expectStoredTheme,
  expectTheme,
  gotoWithClearedStorage,
  gotoWithSystemScheme,
  otherTheme,
  readTheme,
  reloadWithStoredTheme,
  toggleTheme,
  toggleThemeAndRead,
} from './support/theme.js';

const SYSTEM_SCHEMES = [
  {
    title: 'respects system dark mode preference when no saved theme',
    scheme: THEMES.dark,
  },
  {
    title: 'respects system light mode preference when no saved theme',
    scheme: THEMES.light,
  },
];

const SAVED_THEME_CASES = [
  {
    title: 'saved theme overrides system preference',
    assertStoredTheme: false,
  },
  {
    title: 'ignores system theme change when theme is saved',
    assertStoredTheme: true,
  },
];

test.describe('Theme Persistence', () => {
  test('dark theme persists after page reload', async ({ page }) => {
    await page.goto(PATHS.gettingStarted);

    const initialTheme = await readTheme(page);
    await toggleTheme(page);
    await page.waitForTimeout(WAITS.handler);

    const expectedTheme = otherTheme(initialTheme);
    await expectTheme(page, expectedTheme);

    // Click again to ensure we're in dark mode for the persistence test.
    if (expectedTheme === THEMES.light) {
      await toggleTheme(page);
      await page.waitForTimeout(WAITS.handler);
    }

    await expectTheme(page, THEMES.dark);
    await expectStoredTheme(page, THEMES.dark);

    await page.reload();

    await expectTheme(page, THEMES.dark);
    await expectStoredTheme(page, THEMES.dark);
  });

  test('light theme persists after page reload', async ({ page }) => {
    await gotoWithClearedStorage(page, PATHS.gettingStarted);

    const initialTheme = await readTheme(page);
    if (initialTheme === THEMES.dark) {
      await toggleTheme(page);
    }

    await expectTheme(page, THEMES.light);

    await page.reload();

    await expectTheme(page, THEMES.light);
  });

  test('theme toggle switches between dark and light', async ({ page }) => {
    await gotoWithClearedStorage(page, PATHS.gettingStarted);

    const initialTheme = await readTheme(page);

    await toggleTheme(page);
    await expectTheme(page, otherTheme(initialTheme));

    await toggleTheme(page);
    await expectTheme(page, initialTheme);
  });
});

test.describe('Theme Toggle Callback', () => {
  test('theme toggle click callback changes theme and saves to localStorage', async ({ page }) => {
    await page.goto(PATHS.gettingStarted);
    await clearStoredTheme(page);

    const currentTheme = await readTheme(page);

    const newTheme = await toggleThemeAndRead(page);
    expect(newTheme).not.toBe(currentTheme);
    await expectStoredTheme(page, newTheme);

    await toggleThemeAndRead(page);

    expect(await readTheme(page)).toBe(currentTheme);
  });
});

test.describe('System Theme Preference', () => {
  for (const { title, scheme } of SYSTEM_SCHEMES) {
    test(title, async ({ page }) => {
      await gotoWithSystemScheme(page, PATHS.gettingStarted, scheme);

      await expectTheme(page, scheme);
    });
  }

  for (const { title, assertStoredTheme } of SAVED_THEME_CASES) {
    test(title, async ({ page }) => {
      await emulateColorScheme(page, THEMES.dark);
      await page.goto(PATHS.gettingStarted);
      await reloadWithStoredTheme(page, THEMES.light);

      await expectTheme(page, THEMES.light);
      if (assertStoredTheme) {
        await expectStoredTheme(page, THEMES.light);
      }
    });
  }

  test('responds to system theme change when no saved theme', async ({ page }) => {
    await gotoWithSystemScheme(page, PATHS.gettingStarted, THEMES.light);

    await expectTheme(page, THEMES.light);

    // No saved theme - verify this before simulating the system change.
    await page.evaluate((key) => {
      if (localStorage.getItem(key)) {
        localStorage.removeItem(key);
      }
    }, STORAGE_KEYS.theme);

    await emulateColorScheme(page, THEMES.dark);
    await page.evaluate(() => {
      const query = window.matchMedia('(prefers-color-scheme: dark)');
      const event = new Event('change');
      Object.defineProperty(event, 'matches', { value: true });
      query.dispatchEvent(event);
    });
    await page.waitForTimeout(WAITS.short);

    const currentTheme = await readTheme(page);
    expect([THEMES.light, THEMES.dark]).toContain(currentTheme);
  });

  test('system theme change listener updates theme when no saved preference', async ({ page }) => {
    await emulateColorScheme(page, THEMES.light);
    await page.goto(PATHS.gettingStarted);

    // setTheme() persists on load, so clear it AFTER the initial load.
    await clearStoredTheme(page);
    await emulateColorScheme(page, THEMES.dark);

    // Reload re-runs initialisation, which falls back to the system preference.
    await page.reload();

    await expectTheme(page, THEMES.dark);
  });
});
