/// Shared JSON narrowing guards and row mappers.
///
/// Used by both the SQLite backend (raw better-sqlite3 rows) and the cloud
/// client (parsed HTTP JSON) so the two never re-implement each other.

import type { MessageHeader } from "too-many-cooks-core";

/** Type guard: value is a plain object (Record<string, unknown>). */
export const isRecord: (val: unknown) => val is Record<string, unknown> = (
  val: unknown
): val is Record<string, unknown> => typeof val === "object" && val !== null && !Array.isArray(val);

/// [STATUS-BOUNDED] Issues #41/#42: parse a message header (no body) from a
/// raw row/JSON. Never reads `content`.
export const messageHeaderFromJson: (raw: Record<string, unknown>) => MessageHeader = (
  raw: Record<string, unknown>
): MessageHeader => ({
  id: typeof raw.id === "string" ? raw.id : "",
  fromAgent: typeof raw.from_agent === "string" ? raw.from_agent : "",
  toAgent: typeof raw.to_agent === "string" ? raw.to_agent : "",
  createdAt: typeof raw.created_at === "number" ? raw.created_at : 0,
  readAt: typeof raw.read_at === "number" ? raw.read_at : undefined,
});
