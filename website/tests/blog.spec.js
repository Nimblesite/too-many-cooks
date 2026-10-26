import { test, expect } from './coverage.setup.js';
import { PATHS, SELECTORS, TITLES } from './support/constants.js';
import { expectVisible, gotoExpectOk } from './support/page.js';

test.describe('Blog', () => {
  test('main navigation links to the blog', async ({ page }) => {
    await gotoExpectOk(page, PATHS.home);
    await expectVisible(page.locator(SELECTORS.blogNavLink).first());
  });

  test('blog index lists the 0.16 post and links to it', async ({ page }) => {
    await gotoExpectOk(page, PATHS.blog);
    const link = page.locator(SELECTORS.blogPostLink, { hasText: TITLES.blogPost });
    await expect(link).toHaveAttribute('href', PATHS.blogPost);
  });

  test('0.16 post renders its title', async ({ page }) => {
    await gotoExpectOk(page, PATHS.blogPost);
    await expect(page.locator(SELECTORS.blogPostTitle)).toHaveText(TITLES.blogPost);
  });
});
