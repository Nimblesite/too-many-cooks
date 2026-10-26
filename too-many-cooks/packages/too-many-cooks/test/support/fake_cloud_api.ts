/// In-process fake of the TMC Cloud Edge Function HTTP contract.
///
/// src/db-cloud.ts maps every TooManyCooksDb method to
/// `POST {apiUrl}/{endpoint}` with `Authorization: Bearer <key>`,
/// `X-Workspace-Id: <id>` and a JSON body; responses are
/// Result<T, DbError>-shaped JSON. This harness implements that contract so
/// tests can drive the cloud client (and the encrypted backend built on it)
/// black-box over real HTTP. [DEDUP-DESLOP] shared by cloud coverage tests.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** One recorded cloud API call. */
export type RecordedRequest = {
  readonly endpoint: string;
  readonly httpMethod: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: unknown;
};

/** Scripted response for an endpoint: HTTP status + JSON payload. */
export type ScriptedResponse = {
  readonly status: number;
  readonly payload: unknown;
};

/** Success envelope for `value`. */
export const okEnvelope: (value: unknown) => unknown = (value: unknown): unknown => ({
  ok: true,
  value,
});

/** Error envelope with explicit code/message. */
export const errEnvelope: (code: string, message: string) => unknown = (
  code: string,
  message: string,
): unknown => ({ ok: false, error: { code, message } });

/** Fake TMC Cloud API: records requests, replays scripted responses. */
export class FakeCloudApi {
  private readonly requests: RecordedRequest[] = [];
  private readonly scripted = new Map<string, ScriptedResponse>();
  private server: Server | undefined;

  /** Script the next response for an endpoint. */
  public script(endpoint: string, status: number, payload: unknown): void {
    this.scripted.set(endpoint, { status, payload });
  }

  /** All recorded requests for one endpoint, in order. */
  public recorded(endpoint: string): readonly RecordedRequest[] {
    return this.requests.filter((r: RecordedRequest): boolean => r.endpoint === endpoint);
  }

  /** The single recorded request for an endpoint (fails if not exactly one). */
  public one(endpoint: string): RecordedRequest {
    const all: readonly RecordedRequest[] = this.recorded(endpoint);
    const only: RecordedRequest | undefined = all[0];
    if (all.length !== 1 || only === undefined) {
      throw new Error(`expected 1 recorded ${endpoint} call, got ${String(all.length)}`);
    }
    return only;
  }

  /** The most recently recorded request for an endpoint (fails if none). */
  public last(endpoint: string): RecordedRequest {
    const all: readonly RecordedRequest[] = this.recorded(endpoint);
    const lastReq: RecordedRequest | undefined = all[all.length - 1];
    if (lastReq === undefined) {
      throw new Error(`no recorded ${endpoint} call`);
    }
    return lastReq;
  }

  /** Start listening on an ephemeral localhost port; returns the base URL. */
  public async start(): Promise<string> {
    return await new Promise<string>((resolve: (url: string) => void): void => {
      this.server = createServer((req: IncomingMessage, res: ServerResponse): void => {
        void this.handle(req, res);
      });
      this.server.listen(0, "127.0.0.1", (): void => {
        const address = this.server?.address();
        if (typeof address === "object" && address !== null) {
          resolve(`http://127.0.0.1:${String(address.port)}`);
        }
      });
    });
  }

  /** Stop the server. */
  public async close(): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
      this.server?.close((): void => { resolve(); });
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const endpoint: string = req.url === undefined ? "" : req.url.replace("/", "");
    const body: unknown = await readBody(req);
    this.requests.push({
      endpoint,
      httpMethod: req.method ?? "",
      headers: { ...req.headers },
      body,
    });
    const scripted: ScriptedResponse | undefined = this.scripted.get(endpoint);
    const status: number = scripted?.status ?? 200;
    const payload: unknown =
      scripted?.payload ?? { ok: false, error: { code: "NOT_SCRIPTED", message: endpoint } };
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  }
}

/** Read and JSON-parse a request body. */
const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    chunks.push(buf);
  }
  const text: string = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? {} : JSON.parse(text);
};
