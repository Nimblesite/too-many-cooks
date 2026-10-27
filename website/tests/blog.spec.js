import { test, expect } from './coverage.setup.js';
import { AUTHOR, MARKETPLACE_URL, PATHS, SELECTORS, TITLES } from './support/constants.js';
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

  test('blog grid cards carry a header image and the author', async ({ page }) => {
    await gotoExpectOk(page, PATHS.blog);
    const count = await page.locator(SELECTORS.postCard).count();
    expect(count).toBeGreaterThan(0);
    await expect(page.locator(SELECTORS.postCardCover)).toHaveCount(count);
    await expect(page.locator(SELECTORS.postCardByline).first()).toHaveText(AUTHOR);
  });

  test('0.16 post renders its title, author, author card and install CTA', async ({ page }) => {
    await gotoExpectOk(page, PATHS.blogPost);
    await expect(page.locator(SELECTORS.blogPostTitle)).toHaveText(TITLES.blogPost);
    await expect(page.locator(SELECTORS.postByline)).toHaveText(AUTHOR);
    await expectVisible(page.locator(SELECTORS.postAuthorCard));
    await expect(page.locator(SELECTORS.postCtaInstall)).toHaveAttribute('href', MARKETPLACE_URL);
  });
});
