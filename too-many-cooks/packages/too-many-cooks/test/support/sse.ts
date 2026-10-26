/// Shared SSE stream collector for /mcp and /admin/event streams
/// ([DEDUP-DESLOP]).
///
/// Replaces the per-file AgentStreamClient/AdminStreamClient classes:
/// connect, collect `data:` lines in the background, waitForEvents,
/// close via AbortController.

import { sleep } from "./server_process.js";
import { isRecord, parseJsonRecord } from "./json.js";

const DATA_PREFIX = "data: ";
const DATA_PREFIX_LENGTH = DATA_PREFIX.length;

export const STREAM_SETTLE_MS = 200;
export const EVENT_POLL_MS = 50;
export const DEFAULT_EVENT_TIMEOUT_MS = 3000;

// Re-exported for existing imports; canonical home is ./json.js.
export { parseJsonRecord };

/** Extracts data.event from a notifications/message SSE payload. */
export const extractEventType = (
  streamData: string,
): string | undefined => {
  const json = parseJsonRecord(streamData);
  if (!isRecord(json.params)) { return undefined; }
  const { data } = json.params;
  if (!isRecord(data)) { return undefined; }
  return typeof data.event === "string" ? data.event : undefined;
};

type SseChunk = {
  readonly data: readonly string[];
  readonly rest: string;
};

const takeDataLines = (buffer: string): SseChunk => {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const data = lines
    .filter((line: string): boolean => line.startsWith(DATA_PREFIX))
    .map((line: string): string =>
      line.substring(DATA_PREFIX_LENGTH).trim(),
    )
    .filter((line: string): boolean => line.length > 0);
  return { data, rest };
};

export class SseEventCollector {
  private readonly events: string[] = [];
  private consumed = 0;
  private controller: AbortController | undefined;

  /** Opens the stream, starts the background read loop, settles. */
  public static async open(opts: {
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly settleMs?: number;
  }): Promise<SseEventCollector> {
    const client = new SseEventCollector();
    client.controller = new AbortController();
    void client.readLoop(opts.url, opts.headers).catch((): void => {
      /* Stream aborted — expected on close() */
    });
    await sleep(opts.settleMs ?? STREAM_SETTLE_MS);
    return client;
  }

  /** Waits for `count` unread events; returns whatever arrived on timeout. */
  public async waitForEvents(
    count: number,
    timeoutMs: number = DEFAULT_EVENT_TIMEOUT_MS,
    pollMs: number = EVENT_POLL_MS,
  ): Promise<string[]> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.events.length - this.consumed >= count) {
        return this.takeUnconsumed();
      }
      await sleep(pollMs);
    }
    return this.takeUnconsumed();
  }

  public close(): void {
    this.controller?.abort();
  }

  private takeUnconsumed(): string[] {
    const result = this.events.slice(this.consumed);
    this.consumed = this.events.length;
    return result;
  }

  private async readLoop(
    url: string,
    headers: Record<string, string>,
  ): Promise<void> {
    const controller = this.controller;
    if (controller === undefined) {
      return;
    }
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok || response.body === null) {
      return;
    }
    await this.readBody(response.body);
  }

  private async readBody(
    body: ReadableStream<Uint8Array>,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunk = takeDataLines(buffer);
      buffer = chunk.rest;
      for (const datum of chunk.data) {
        this.events.push(datum);
      }
    }
  }
}
