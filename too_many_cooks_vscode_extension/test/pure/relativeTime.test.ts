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

/** One formatting function plus the exact strings it must produce. */
interface RelativeFormatCase {
  readonly day: string;
  readonly format: (timestamp: number) => string;
  readonly hour: string;
  readonly minute: string;
  readonly name: string;
  readonly now: string;
}

const FORMAT_CASES: readonly RelativeFormatCase[] = [
  {
    day: '2d ago',
    format: getRelativeTime,
    hour: '2h ago',
    minute: '2m ago',
    name: 'formats day, hour, minute, and now ages in the long form',
    now: 'just now',
  },
  {
    day: '2d',
    format: getRelativeTimeShort,
    hour: '2h',
    minute: '2m',
    name: 'formats day, hour, minute, and now ages in the short form',
    now: 'now',
  },
];

describe('Relative Time Formatting', () => {
  for (const formatCase of FORMAT_CASES) {
    it(formatCase.name, () => {
      assert.strictEqual(formatCase.format(ago(ONE_DAY_MS * AGE_MULTIPLIER)), formatCase.day);
      assert.strictEqual(formatCase.format(ago(ONE_HOUR_MS * AGE_MULTIPLIER)), formatCase.hour);
      assert.strictEqual(formatCase.format(ago(ONE_MINUTE_MS * AGE_MULTIPLIER)), formatCase.minute);
      assert.strictEqual(formatCase.format(Date.now()), formatCase.now);
    });
  }
});
