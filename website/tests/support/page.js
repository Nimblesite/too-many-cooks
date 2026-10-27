/**
 * Navigation and page-level assertions shared by the website Playwright suite.
 * [TEST-SUPPORT]
 */
import { expect } from '@playwright/test';
import {
  ELEMENT_STATE,
  SELECTORS,
  STATUS_OK,
  TIMEOUTS,
  VIEWPORTS,
} from './constants.js';

export const setViewport = async (page, viewport) => {
  await page.setViewportSize(viewport);
};

export const gotoSettled = async (page, path) => {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
};

export const gotoMobile = async (page, path) => {
  await setViewport(page, VIEWPORTS.mobile);
  await page.goto(path);
};

export const gotoMobileSettled = async (page, path) => {
  await setViewport(page, VIEWPORTS.mobile);
  await gotoSettled(page, path);
};

export const gotoDesktop = async (page, path) => {
  await setViewport(page, VIEWPORTS.desktop);
  await page.goto(path);
};

export const gotoExpectOk = async (page, path) => {
  const response = await page.goto(path);
  expect(response?.status()).toBe(STATUS_OK);
};

export const gotoSettledExpectOk = async (page, path) => {
  const response = await page.goto(path);
  expect(response?.status()).toBe(STATUS_OK);
  await page.waitForLoadState('networkidle');
};

export const waitForVisible = async (page, selector, timeout = TIMEOUTS.elementVisible) => {
  await page.waitForSelector(selector, { state: ELEMENT_STATE.visible, timeout });
};

export const expectVisible = async (locator) => {
  await expect(locator).toBeVisible();
};

export const expectVisibleAll = async (page, selectors) => {
  for (const selector of selectors) {
    await expectVisible(page.locator(selector));
  }
};

export const expectHidden = async (locator) => {
  await expect(locator).toBeHidden();
};

export const expectCountAboveZero = async (locator) => {
  expect(await locator.count()).toBeGreaterThan(0);
};

export const expectNoHorizontalScroll = async (page) => {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflows).toBe(false);
};

export const expectBodyVisible = async (page) => {
  await expectVisible(page.locator(SELECTORS.body));
};
