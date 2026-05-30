/// Status-bar mode label — Issue #12.
///
/// When the extension auto-connects (restore on activation) the connection
/// picker is bypassed, so StoreManager.getTarget() stays null even though the
/// connection is live. The status bar must still read the live mode, NOT
/// "Disconnected" (cloud always sets a target via the picker, so connected +
/// null target is, by construction, the default local server).

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  MODE_CLOUD_HTTP,
  MODE_CLOUD_STDIO,
  MODE_DISCONNECTED,
  MODE_LOCAL,
  selectModeLabel,
} from '../../src/state/selectors';
import type { CloudTarget, LocalTarget } from '../../src/services/connectionTypes';

const LOCAL_TARGET: LocalTarget = { mode: 'local', port: 4040, transport: 'http-streamable' };
const CLOUD_STDIO_TARGET: CloudTarget = {
  apiKey: 'k',
  apiUrl: 'https://api',
  mode: 'cloud',
  passphrase: 'p',
  tenantId: 't',
  transport: 'stdio',
  workspaceId: 'w',
};
const CLOUD_HTTP_TARGET: CloudTarget = { ...CLOUD_STDIO_TARGET, transport: 'http-streamable' };

describe('selectModeLabel (#12)', () => {
  it('shows the live mode when connected without an explicit target (auto-connect)', () => {
    assert.strictEqual(selectModeLabel('connected', null), MODE_LOCAL);
    assert.notStrictEqual(selectModeLabel('connected', null), MODE_DISCONNECTED);
  });

  it('labels explicit local and cloud targets correctly', () => {
    assert.strictEqual(selectModeLabel('connected', LOCAL_TARGET), MODE_LOCAL);
    assert.strictEqual(selectModeLabel('connected', CLOUD_STDIO_TARGET), MODE_CLOUD_STDIO);
    assert.strictEqual(selectModeLabel('connected', CLOUD_HTTP_TARGET), MODE_CLOUD_HTTP);
  });

  it('reads Disconnected only when actually not connected', () => {
    assert.strictEqual(selectModeLabel('disconnected', null), MODE_DISCONNECTED);
    assert.strictEqual(selectModeLabel('connecting', null), MODE_DISCONNECTED);
  });
});
