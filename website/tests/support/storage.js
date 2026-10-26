/**
 * localStorage helpers shared by the website Playwright suite.
 * [TEST-SUPPORT] Browser-side storage access lives here once; feature helpers
 * (theme/language) add the key names.
 */

export const readStored = async (page, key) =>
  page.evaluate((storageKey) => localStorage.getItem(storageKey), key);

export const storeValue = async (page, key, value) => {
  await page.evaluate(
    ([storageKey, storageValue]) => localStorage.setItem(storageKey, storageValue),
    [key, value]
  );
};

export const clearStored = async (page, key) => {
  await page.evaluate((storageKey) => localStorage.removeItem(storageKey), key);
};

export const clearAllStorage = async (page) => {
  await page.evaluate(() => localStorage.clear());
};

// Build read/store/clear helpers scoped to a single localStorage key.
export const createStorageHelpers = (key) => ({
  read: (page) => readStored(page, key),
  store: (page, value) => storeValue(page, key, value),
  clear: (page) => clearStored(page, key),
});
