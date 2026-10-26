// Messages tree provider leaf coverage. WHITE-BOX: builds its own
// MessagesTreeProvider over the extension's store (testHelpers), because the
// messages view never expands message items in the UI (they are leaf nodes),
// so getChildren(element) for a message element is unreachable through
// commands. Proves message items are leaves and covers that early return.

import {
  assertEqual,
  assertOk,
  ensureServerReady,
  getTestAPI,
  messagesTreeLeafStats,
  safeDisconnect,
} from './testHelpers';

suite('Messages Tree Leaf', () => {
  suiteSetup(async () => {
    await ensureServerReady();
  });

  suiteTeardown(async () => {
    await safeDisconnect();
  });

  test('getChildren on a message item returns an empty list', () => {
    const api = getTestAPI();
    const [rootCount, firstChildCount] = messagesTreeLeafStats(api);
    assertOk(rootCount > 0, 'root always has at least the placeholder item');
    assertEqual(firstChildCount, 0, 'message items are leaves');
  });
});
