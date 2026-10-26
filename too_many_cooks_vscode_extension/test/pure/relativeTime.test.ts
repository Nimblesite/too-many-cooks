/// Tests for relative-time formatting helpers.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getRelativeTime, getRelativeTimeShort } from '../../src/ui/tree/relativeTime';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const AGE_MULTIPLIER = 2;

const ONE_MINUTE_MS: number = MS_PER_SECOND * SECONDS_PER_MINUTE;
const ONE_HOUR_MS: number = ONE_MINUTE_MS * MINUTES_PER_HOUR;
const ONE_DAY_MS: number = ONE_HOUR_MS * HOURS_PER_DAY;

function ago(ms: number): number {
  return Date.now() - ms;
}

describe('Relative Time Formatting', () => {
  it('formats day, hour, minute, and now ages in the long form', () => {
    assert.strictEqual(getRelativeTime(ago(ONE_DAY_MS * AGE_MULTIPLIER)), '2d ago');
    assert.strictEqual(getRelativeTime(ago(ONE_HOUR_MS * AGE_MULTIPLIER)), '2h ago');
    assert.strictEqual(getRelativeTime(ago(ONE_MINUTE_MS * AGE_MULTIPLIER)), '2m ago');
    assert.strictEqual(getRelativeTime(Date.now()), 'just now');
  });

  it('formats day, hour, minute, and now ages in the short form', () => {
    assert.strictEqual(getRelativeTimeShort(ago(ONE_DAY_MS * AGE_MULTIPLIER)), '2d');
    assert.strictEqual(getRelativeTimeShort(ago(ONE_HOUR_MS * AGE_MULTIPLIER)), '2h');
    assert.strictEqual(getRelativeTimeShort(ago(ONE_MINUTE_MS * AGE_MULTIPLIER)), '2m');
    assert.strictEqual(getRelativeTimeShort(Date.now()), 'now');
  });
});
