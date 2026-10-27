// Lock expiry timing shared by the agents view and the locks view.

import type { FileLock } from '../../state/types';
import { MS_PER_SECOND } from './relativeTime';

/** Remaining lifetime and expiry flag for one lock. */
export interface LockTiming {
  readonly expired: boolean;
  readonly expiresIn: number;
}

/** Remaining lifetime in seconds plus the expiry flag for `lock` at `now`. */
export function getLockTiming(lock: Readonly<FileLock>, now: number): LockTiming {
  return {
    expired: lock.expiresAt <= now,
    expiresIn: Math.max(0, Math.round((lock.expiresAt - now) / MS_PER_SECOND)),
  };
}
