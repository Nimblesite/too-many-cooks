import { test, expect } from './coverage.setup.js';
import { CONNECT_COMMANDS, PATHS, SELECTORS, STATUS_OK, VIDEO } from './support/constants.js';
import { expectVisible, gotoExpectOk } from './support/page.js';

/** A served asset: OK, of `type`, and real media rather than a Git LFS pointer. */
const expectMedia = async (page, url, type) => {
  const response = await page.request.get(url);
  expect(response.status()).toBe(STATUS_OK);
  expect(response.headers()['content-type']).toContain(type);
  expect((await response.body()).length).toBeGreaterThan(VIDEO.minMediaBytes);
};

// [WEB-VIDEO]
test.describe('Homepage quickstart film', () => {
  test('video has a poster, AV1 and H.264 sources, and English captions', async ({ page }) => {
    await gotoExpectOk(page, PATHS.home);
    const video = page.locator(SELECTORS.quickstartVideo);
    await expectVisible(video);
    await expect(page.locator(SELECTORS.videoSource)).toHaveCount(VIDEO.sourceCount);
    await expect(page.locator(SELECTORS.videoCaptions)).toHaveAttribute('srclang', VIDEO.captionsLang);
    await expect(video).toHaveAttribute('aria-label', /Claude Code, Codex and pi/);
  });

  test('poster and every source are real media, not LFS pointers', async ({ page }) => {
    await gotoExpectOk(page, PATHS.home);
    await expectMedia(page, await page.locator(SELECTORS.quickstartVideo).getAttribute('poster'), VIDEO.types.jpeg);
    for (const src of await page.locator(SELECTORS.videoSource).evaluateAll((sources) => sources.map((source) => source.getAttribute('src')))) {
      await expectMedia(page, src, VIDEO.types.mp4);
    }
  });

  test('captions are served as WebVTT', async ({ page }) => {
    await gotoExpectOk(page, PATHS.home);
    const response = await page.request.get(await page.locator(SELECTORS.videoCaptions).getAttribute('src'));
    expect(response.status()).toBe(STATUS_OK);
    expect(await response.text()).toMatch(/^WEBVTT/);
  });

  test('quickstart shows one connect line per agent', async ({ page }) => {
    await gotoExpectOk(page, PATHS.home);
    const quickstart = page.locator(SELECTORS.quickstart);
    for (const command of CONNECT_COMMANDS) await expect(quickstart).toContainText(command);
  });
});
