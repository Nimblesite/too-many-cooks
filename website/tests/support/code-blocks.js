/**
 * Code-block copy button helpers shared by the website Playwright suite.
 * [TEST-SUPPORT]
 */
import { expect } from '@playwright/test';
import { SELECTORS, WAITS } from './constants.js';
import { readOpacity } from './layout.js';
import { expectVisible } from './page.js';

export const firstCodeWrapper = (page) =>
  page.locator(SELECTORS.firstCodeBlock).first().locator('..');

export const firstCopyButton = (page) => page.locator(SELECTORS.copyButton).first();

export const hoverCodeWrapper = async (page) => {
  await firstCodeWrapper(page).hover();
};

export const dispatchCodeHover = async (page) => {
  await page.evaluate((selector) => {
    const wrapper = document.querySelector(selector)?.parentElement;
    if (wrapper) {
      wrapper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    }
  }, SELECTORS.firstCodeBlock);
  await page.waitForTimeout(WAITS.short);
};

// Hover the first code block so its copy button becomes visible.
export const showCopyButtonByHover = async (page) => {
  await expectVisible(firstCodeWrapper(page));
  await hoverCodeWrapper(page);
  await page.waitForTimeout(WAITS.style);
};

export const readCopyButtonOpacity = async (page) => readOpacity(firstCopyButton(page));

export const expectCopyButtonText = async (page, text, options) => {
  await expect(firstCopyButton(page)).toHaveText(text, options);
};

export const readCodeText = async (page) =>
  page.evaluate((selector) => {
    const code = document.querySelector(selector);
    return code ? code.textContent : '';
  }, SELECTORS.codeElement);
