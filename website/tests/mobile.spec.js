import { test, expect } from './coverage.setup.js';
import {
  CSS_PROPERTIES,
  CSS_VALUES,
  PATHS,
  SELECTORS,
  TEXT,
  THRESHOLDS,
  VIEWPORTS,
  WAITS,
} from './support/constants.js';
import {
  clickSidebarToggle,
  closeMobileMenu,
  elementExists,
  expectMobileMenuClosed,
  expectMobileMenuToggled,
  expectSidebarOnPage,
  expectSidebarToggleText,
  expectSidebarToggled,
  mobileMenu,
  openMobileMenu,
  openSidebar,
  readMobileMenuState,
  readStyle,
  readZIndex,
  sidebar,
} from './support/layout.js';
import {
  expectDropdownVisible,
  isLanguageTextHidden,
  openLanguageDropdown,
} from './support/language.js';
import {
  expectHidden,
  expectNoHorizontalScroll,
  expectVisible,
  gotoDesktop,
  gotoMobile,
  setViewport,
} from './support/page.js';

const NO_HORIZONTAL_SCROLL_CASES = [
  { title: 'no horizontal scroll on mobile docs page', path: PATHS.gettingStarted },
  { title: 'no horizontal scroll on mobile homepage', path: PATHS.home },
];

const SIDEBAR_PAGES = [PATHS.gettingStarted, PATHS.howItWorks];

test.describe('Mobile Menu', () => {
  test('mobile menu toggle opens and closes menu', async ({ page }) => {
    await gotoMobile(page, PATHS.home);
    await expectVisible(mobileMenu(page).toggle);

    // Click to open and close - the callback must execute.
    await expectMobileMenuToggled(page, WAITS.handler);
  });

  test('mobile menu toggle callback adds classes correctly', async ({ page }) => {
    await gotoMobile(page, PATHS.home);

    expect(await elementExists(page, SELECTORS.mobileMenuToggle)).toBe(true);
    expect(await elementExists(page, SELECTORS.navLinks)).toBe(true);

    const initialState = await readMobileMenuState(page);

    await page.click(SELECTORS.mobileMenuToggle);
    await page.waitForTimeout(WAITS.short);

    const afterClick = await readMobileMenuState(page);
    expect(afterClick.navLinksOpen).toBe(!initialState.navLinksOpen);
    expect(afterClick.toggleActive).toBe(!initialState.toggleActive);
  });

  test('mobile menu closes when clicking outside', async ({ page }) => {
    await gotoMobile(page, PATHS.home);
    await expectVisible(mobileMenu(page).toggle);

    await openMobileMenu(page);

    // Click outside (on the body/main).
    await page.locator(SELECTORS.main).click({ force: true });

    await expectMobileMenuClosed(page);
  });

  test('mobile menu toggle button exists on mobile homepage', async ({ page }) => {
    await gotoMobile(page, PATHS.home);
    await expectVisible(mobileMenu(page).toggle);

    await openMobileMenu(page);
    await closeMobileMenu(page);
  });
});

test.describe('Docs Sidebar Mobile', () => {
  test('sidebar toggle button appears on mobile and toggles sidebar', async ({ page }) => {
    await gotoMobile(page, PATHS.gettingStarted);

    await expectVisible(sidebar(page).toggle);
    await expectSidebarToggleText(page, TEXT.sidebarClosed);

    await expectSidebarToggled(page);
  });

  test('sidebar toggle hidden on desktop', async ({ page }) => {
    await gotoDesktop(page, PATHS.gettingStarted);

    await expectHidden(sidebar(page).toggle);
  });

  test('sidebar toggle responds to window resize', async ({ page }) => {
    await gotoDesktop(page, PATHS.gettingStarted);
    const { toggle } = sidebar(page);

    await expectHidden(toggle);

    await setViewport(page, VIEWPORTS.mobile);
    await expectVisible(toggle);

    await setViewport(page, VIEWPORTS.desktop);
    await expectHidden(toggle);
  });

  test('sidebar toggle text changes based on state', async ({ page }) => {
    await gotoMobile(page, PATHS.gettingStarted);

    await expectSidebarToggleText(page, TEXT.sidebarClosed);

    await expectSidebarToggled(page);

    // Reopen to verify the toggle works multiple times.
    await openSidebar(page);
    await expectSidebarToggleText(page, TEXT.sidebarOpen);
  });

  test('sidebar toggle on multiple pages', async ({ page }) => {
    await setViewport(page, VIEWPORTS.mobile);

    for (const path of SIDEBAR_PAGES) {
      await expectSidebarOnPage(page, path);
    }

    // Open and verify.
    await clickSidebarToggle(page);
    await expectSidebarToggleText(page, TEXT.sidebarOpen);
  });
});

test.describe('Language Dropdown Mobile', () => {
  test('language dropdown displays above page content on mobile', async ({ page }) => {
    await gotoMobile(page, PATHS.gettingStarted);

    await openLanguageDropdown(page);
    await expectDropdownVisible(page);

    const dropdownBox = await page.locator(SELECTORS.languageDropdown).boundingBox();
    expect(dropdownBox).not.toBeNull();
    expect(dropdownBox.height).toBeGreaterThan(THRESHOLDS.minDropdownHeight);
    expect(dropdownBox.width).toBeGreaterThan(THRESHOLDS.minDropdownWidth);
  });

  test('language dropdown z-index is above page content', async ({ page }) => {
    await gotoMobile(page, PATHS.home);

    await openLanguageDropdown(page);

    expect(await readZIndex(page, SELECTORS.header)).toBeGreaterThanOrEqual(
      THRESHOLDS.minZIndex
    );
    expect(await readZIndex(page, SELECTORS.languageDropdown)).toBeGreaterThanOrEqual(
      THRESHOLDS.minZIndex
    );
  });

  test('header container allows dropdown overflow', async ({ page }) => {
    await gotoMobile(page, PATHS.home);

    expect(await readStyle(page, SELECTORS.header, CSS_PROPERTIES.overflow)).toBe(
      CSS_VALUES.overflowVisible
    );
    expect(await readStyle(page, SELECTORS.nav, CSS_PROPERTIES.overflow)).toBe(
      CSS_VALUES.overflowVisible
    );
  });
});

test.describe('Mobile Layout', () => {
  for (const { title, path } of NO_HORIZONTAL_SCROLL_CASES) {
    test(title, async ({ page }) => {
      await gotoMobile(page, path);

      await expectNoHorizontalScroll(page);
    });
  }
});

test.describe('Mobile Responsive Breakpoints', () => {
  test('768px breakpoint applies correct styles', async ({ page }) => {
    await setViewport(page, VIEWPORTS.tablet);
    await page.goto(PATHS.home);

    await expectVisible(mobileMenu(page).toggle);

    const heroPadding = await readStyle(page, SELECTORS.hero, CSS_PROPERTIES.paddingTop);
    expect(heroPadding).not.toBeNull();
  });

  test('480px breakpoint applies correct styles', async ({ page }) => {
    await setViewport(page, VIEWPORTS.smallMobile);
    await page.goto(PATHS.home);

    const containerPadding = await readStyle(page, SELECTORS.container, CSS_PROPERTIES.paddingLeft);
    expect(containerPadding).not.toBeNull();
    expect(parseInt(containerPadding, 10)).toBeGreaterThanOrEqual(THRESHOLDS.minContainerPadding);
  });

  test('language button hides text on small mobile', async ({ page }) => {
    await gotoMobile(page, PATHS.home);

    expect(await isLanguageTextHidden(page)).toBe(true);
  });
});
