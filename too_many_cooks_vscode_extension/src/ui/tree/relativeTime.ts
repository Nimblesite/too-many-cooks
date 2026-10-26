// Relative-age formatting shared by tree items and tooltips.

const MS_PER_SECOND: number = 1000;
const SECONDS_PER_MINUTE: number = 60;
const MINUTES_PER_HOUR: number = 60;
const HOURS_PER_DAY: number = 24;

type AgeUnit = 'day' | 'hour' | 'minute' | 'now';

interface AgeValue {
  readonly count: number;
  readonly unit: AgeUnit;
}

function humanizeAge(timestamp: number): AgeValue {
  const diff: number = Date.now() - timestamp;
  const seconds: number = Math.floor(diff / MS_PER_SECOND);
  const minutes: number = Math.floor(seconds / SECONDS_PER_MINUTE);
  const hours: number = Math.floor(minutes / MINUTES_PER_HOUR);
  const days: number = Math.floor(hours / HOURS_PER_DAY);

  if (days > 0) { return { count: days, unit: 'day' }; }
  if (hours > 0) { return { count: hours, unit: 'hour' }; }
  if (minutes > 0) { return { count: minutes, unit: 'minute' }; }
  return { count: 0, unit: 'now' };
}

/** Suffix appended to the unit label for the long form. */
const LONG_SUFFIX: string = ' ago';

/** Suffix for the short form (no trailing text). */
const SHORT_SUFFIX: string = '';

/** Label shown when the age rounds to zero. */
const LONG_NOW_LABEL: string = 'just now';

/** Short label shown when the age rounds to zero. */
const SHORT_NOW_LABEL: string = 'now';

function formatAge(timestamp: number, suffix: string, nowLabel: string): string {
  const { count, unit }: AgeValue = humanizeAge(timestamp);
  switch (unit) {
    case 'day': return `${String(count)}d${suffix}`;
    case 'hour': return `${String(count)}h${suffix}`;
    case 'minute': return `${String(count)}m${suffix}`;
    default: return nowLabel;
  }
}

export function getRelativeTime(timestamp: number): string {
  return formatAge(timestamp, LONG_SUFFIX, LONG_NOW_LABEL);
}

export function getRelativeTimeShort(timestamp: number): string {
  return formatAge(timestamp, SHORT_SUFFIX, SHORT_NOW_LABEL);
}
