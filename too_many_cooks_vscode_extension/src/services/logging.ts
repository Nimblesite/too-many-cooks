// Shared logger signature used by services and command handlers.

/** Structured logger signature: one already-formatted message per call. */
export type LogFn = (msg: string) => void;
