/// [VSIX-REFRESH-SURFACE] Issue #43: a non-ok /admin/status response must surface
/// as a thrown error rather than being silently swallowed (which left the UI
/// showing stale, pre-delete data with no indication of failure).

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ensureStatusOk } from '../../src/services/storeManagerHelpers';

describe('ensureStatusOk (#43 refresh failure surfacing)', () => {
  it('throws when the response is not ok', () => {
    assert.throws(
      (): void => { ensureStatusOk({ ok: false, status: 500 }); },
      /Status refresh failed: server returned 500/u,
      'a non-ok status must surface as an error, not a silent no-op',
    );
  });

  it('includes the failing status code in the error', () => {
    assert.throws(
      (): void => { ensureStatusOk({ ok: false, status: 404 }); },
      /404/u,
    );
  });

  it('does not throw when the response is ok', () => {
    assert.doesNotThrow((): void => { ensureStatusOk({ ok: true, status: 200 }); });
  });
});
