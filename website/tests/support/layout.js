/**
 * Mobile menu, docs sidebar and computed-style helpers for the Playwright suite.
 * [TEST-SUPPORT]
 */
import { expect } from '@playwright/test';
import { CLASS_PATTERNS, SELECTORS, STATE_CLASS, TEXT, WAITS } from './constants.js';
import { expectVisible } from './page.js';

export const mobileMenu = (page) => ({
  toggle: page.locator(SELECTORS.mobileMenuToggle),
  navLinks: page.locator(SELECTORS.navLinks),
});

export const clickMobileMenuToggle = async (page) => {
  await page.locator(SELECTORS.mobileMenuToggle).click();
};

export const expectMobileMenuOpen = async (page) => {
  const { toggle, navLinks } = mobileMenu(page);
  await expect(navLinks).toHaveClass(CLASS_PATTERNS.open);
  await expect(toggle).toHaveClass(CLASS_PATTERNS.active);
};

export const expectMobileMenuClosed = async (page) => {
  const { toggle, navLinks } = mobileMenu(page);
  await expect(navLinks).not.toHaveClass(CLASS_PATTERNS.open);
  await expect(toggle).not.toHaveClass(CLASS_PATTERNS.active);
};

// Click a toggle, let its handler settle, then assert the resulting state.
export const toggleStep = async (page, click, expectState, settleMs = 0) => {
  await click();
  await page.waitForTimeout(settleMs);
  await expectState();
};

// Run the open then the close step of a two-state toggle.
export const expectToggled = async (page, openStep, closeStep, settleMs) => {
  await openStep(page, settleMs);
  await closeStep(page, settleMs);
};

export const openMobileMenu = (page, settleMs = 0) =>
  toggleStep(page, () => clickMobileMenuToggle(page), () => expectMobileMenuOpen(page), settleMs);

export const closeMobileMenu = (page, settleMs = 0) =>
  toggleStep(page, () => clickMobileMenuToggle(page), () => expectMobileMenuClosed(page), settleMs);

export const expectMobileMenuToggled = (page, settleMs = WAITS.short) =>
  expectToggled(page, openMobileMenu, closeMobileMenu, settleMs);

export const readMobileMenuState = async (page) =>
  page.evaluate(
    ([toggleSelector, linksSelector, openClass, activeClass]) => ({
      navLinksOpen:
        document.querySelector(linksSelector)?.classList.contains(openClass) ?? false,
      toggleActive:
        document.querySelector(toggleSelector)?.classList.contains(activeClass) ?? false,
    }),
    [SELECTORS.mobileMenuToggle, SELECTORS.navLinks, STATE_CLASS.open, STATE_CLASS.active]
  );

export const sidebar = (page) => ({
  toggle: page.locator(SELECTORS.sidebarToggle),
  sidebar: page.locator(SELECTORS.docsSidebar),
});

export const clickSidebarToggle = async (page) => {
  await page.locator(SELECTORS.sidebarToggle).click();
};

export const expectSidebarOpen = async (page) => {
  const parts = sidebar(page);
  await expect(parts.sidebar).toHaveClass(CLASS_PATTERNS.open);
  await expect(parts.toggle).toHaveText(TEXT.sidebarOpen);
};

export const expectSidebarClosed = async (page) => {
  const parts = sidebar(page);
  await expect(parts.sidebar).not.toHaveClass(CLASS_PATTERNS.open);
  await expect(parts.toggle).toHaveText(TEXT.sidebarClosed);
};

export const openSidebar = (page, settleMs = 0) =>
  toggleStep(page, () => clickSidebarToggle(page), () => expectSidebarOpen(page), settleMs);

export const closeSidebar = (page, settleMs = 0) =>
  toggleStep(page, () => clickSidebarToggle(page), () => expectSidebarClosed(page), settleMs);

export const expectSidebarToggled = (page, settleMs = WAITS.short) =>
  expectToggled(page, openSidebar, closeSidebar, settleMs);

// A docs page always ships the mobile sidebar toggle showing its idle label.
export const expectSidebarOnPage = async (page, path) => {
  await page.goto(path);
  await expectVisible(sidebar(page).toggle);
  await expectSidebarToggleText(page, TEXT.sidebarClosed);
};

export const expectSidebarToggleText = async (page, text) => {
  await expect(page.locator(SELECTORS.sidebarToggle)).toHaveText(text);
};

export const hoverNavigation = async (page, settleMs = WAITS.style) => {
  await page.locator(SELECTORS.nav).hover();
  await page.waitForTimeout(settleMs);
};

export const elementExists = async (page, selector) =>
  page.evaluate((elementSelector) => Boolean(document.querySelector(elementSelector)), selector);

export const readStyle = async (page, selector, property) =>
  page.evaluate(
    ([elementSelector, cssProperty]) => {
      const element = document.querySelector(elementSelector);
      return element ? getComputedStyle(element)[cssProperty] : null;
    },
    [selector, property]
  );

export const readZIndex = async (page, selector) =>
  page.evaluate((elementSelector) => {
    const element = document.querySelector(elementSelector);
    return parseInt(getComputedStyle(element).zIndex, 10) || 0;
  }, selector);

export const readOpacity = async (locator) =>
  locator.evaluate((element) => parseFloat(getComputedStyle(element).opacity));
