import { test } from './coverage.setup.js';
import { PATHS, SELECTORS } from './support/constants.js';
import { firstCodeWrapper, hoverCodeWrapper } from './support/code-blocks.js';
import {
  expectBodyVisible,
  expectCountAboveZero,
  expectVisible,
  gotoSettled,
} from './support/page.js';

test.describe('Code Blocks', () => {
  test('copy button appears on hover', async ({ page }) => {
    await gotoSettled(page, PATHS.gettingStarted);

    await expectBodyVisible(page);
    await expectCountAboveZero(page.locator(SELECTORS.codeElement));

    const codeWrapper = firstCodeWrapper(page);
    await expectVisible(codeWrapper);

    await hoverCodeWrapper(page);
    await expectVisible(codeWrapper.locator(SELECTORS.copyButton));
  });
});
