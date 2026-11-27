/**
 * Direct MCP connections. Nothing here talks to the hosted MCP Playground API,
 * so private, localhost and stdio servers can be inspected from the machine
 * running the CLI.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Target } from "./target.js";
import type {
  HealthResult,
  InspectResult,
  PromptInfo,
  ResourceInfo,
  ToolSchema,
  TransportKind,
} from "./types.js";

export type ConnectErrorCode = "TIMEOUT" | "UNAUTHORIZED" | "CONNECTION_FAILED";

export class ConnectError extends Error {
  constructor(
    public readonly code: ConnectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectError";
  }
}

export interface ConnectOptions {
  /** Extra HTTP headers, for example an Authorization token. URL targets only. */
  headers?: Record<string, string>;
  /** Overall time allowed to connect, in milliseconds. */
  timeoutMs?: number;
}

const DEFAULT_URL_TIMEOUT_MS = 10_000;
/** stdio servers are often started through npx, which may install first. */
const DEFAULT_STDIO_TIMEOUT_MS = 60_000;
const MAX_PAGES = 50;
const STDERR_TAIL_CHARS = 2_000;

const CLIENT_INFO = { name: "mcpx", version: __VERSION__ };

function isAuthError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("invalid_token") ||
    lower.includes("access denied")
  );
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ConnectError("TIMEOUT", "timed out")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

interface Connected {
  client: Client;
  transport: TransportKind;
  connectionTimeMs: number;
}

async function tryConnect(transport: Transport, timeoutMs: number): Promise<Client> {
  const client = new Client(CLIENT_INFO);
  try {
    await withTimeout(client.connect(transport), timeoutMs);
    return client;
  } catch (err) {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    throw err;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function connect(target: Target, opts: ConnectOptions): Promise<Connected> {
  const started = Date.now();

  if (target.kind === "stdio") {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STDIO_TIMEOUT_MS;
    const transport = new StdioClientTransport({
      command: target.command,
      args: target.args,
      env: target.env ? { ...getDefaultEnvironment(), ...target.env } : inheritedEnv(),
      ...(target.cwd ? { cwd: target.cwd } : {}),
      stderr: "pipe",
    });

    let stderrTail = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_CHARS);
    });

    try {
      const client = await tryConnect(transport, timeoutMs);
      return { client, transport: "stdio", connectionTimeMs: Date.now() - started };
    } catch (err) {
      if (err instanceof ConnectError && err.code === "TIMEOUT") {
        throw new ConnectError(
          "TIMEOUT",
          `Command did not complete the MCP handshake within ${Math.round(timeoutMs / 1000)}s.`,
        );
      }
      const tail = stderrTail.trim();
      throw new ConnectError(
        "CONNECTION_FAILED",
        `Could not start "${target.command}": ${describe(err)}${tail ? `\n${tail}` : ""}`,
      );
    }
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_URL_TIMEOUT_MS;
  const serverUrl = new URL(target.url);
  const hasHeaders = opts.headers && Object.keys(opts.headers).length > 0;
  const requestInit: RequestInit | undefined = hasHeaders ? { headers: opts.headers } : undefined;
  const transportOpts = requestInit ? { requestInit } : undefined;

  const fail = (err: unknown): ConnectError => {
    if (err instanceof ConnectError) {
      return new ConnectError("TIMEOUT", `Server did not respond within ${Math.round(timeoutMs / 1000)}s.`);
    }
    const msg = describe(err);
    if (isAuthError(msg)) {
      return new ConnectError(
        "UNAUTHORIZED",
        "Server requires authentication. Pass credentials with --header \"Authorization: Bearer <token>\".",
      );
    }
    return new ConnectError("CONNECTION_FAILED", `Could not connect: ${msg}`);
  };

  if (/^wss?:/i.test(target.url)) {
    if (typeof globalThis.WebSocket === "undefined") {
      throw new ConnectError("CONNECTION_FAILED", "WebSocket servers need Node.js 22 or newer.");
    }
    try {
      const client = await tryConnect(new WebSocketClientTransport(serverUrl), timeoutMs);
      return { client, transport: "websocket", connectionTimeMs: Date.now() - started };
    } catch (err) {
      throw fail(err);
    }
  }

  try {
    const client = await tryConnect(new StreamableHTTPClientTransport(serverUrl, transportOpts), timeoutMs);
    return { client, transport: "streamable-http", connectionTimeMs: Date.now() - started };
  } catch (err) {
    const first = fail(err);
    if (first.code !== "CONNECTION_FAILED") throw first;

    // Older servers only speak the HTTP+SSE transport.
    try {
      const client = await tryConnect(new SSEClientTransport(serverUrl, transportOpts), timeoutMs);
      return { client, transport: "sse", connectionTimeMs: Date.now() - started };
    } catch (sseErr) {
      const second = fail(sseErr);
      throw second.code === "CONNECTION_FAILED" ? first : second;
    }
  }
}

/** Follow nextCursor until the server stops returning one. */
async function listAll<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string }>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, nextCursor } = await fetchPage(cursor);
    all.push(...items);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return all;
}

export async function inspectDirect(target: Target, opts: ConnectOptions = {}): Promise<InspectResult> {
  const { client, transport, connectionTimeMs } = await connect(target, opts);

  try {
    const info = client.getServerVersion();
    const caps = client.getServerCapabilities();
    const hasTools = !!caps?.tools;
    const hasResources = !!caps?.resources;
    const hasPrompts = !!caps?.prompts;

    const [tools, resources, prompts] = await Promise.all([
      hasTools
        ? listAll<ToolSchema>(async (cursor) => {
            const r = await client.listTools(cursor ? { cursor } : undefined);
            return {
              items: r.tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema as Record<string, unknown>,
              })),
              nextCursor: r.nextCursor,
            };
          })
        : Promise.resolve([]),
      hasResources
        ? listAll<ResourceInfo>(async (cursor) => {
            const r = await client.listResources(cursor ? { cursor } : undefined);
            return {
              items: r.resources.map((x) => ({
                uri: x.uri,
                name: x.name,
                description: x.description,
                mimeType: x.mimeType,
              })),
              nextCursor: r.nextCursor,
            };
          })
        : Promise.resolve([]),
      hasPrompts
        ? listAll<PromptInfo>(async (cursor) => {
            const r = await client.listPrompts(cursor ? { cursor } : undefined);
            return {
              items: r.prompts.map((p) => ({
                name: p.name,
                description: p.description,
                arguments: p.arguments,
              })),
              nextCursor: r.nextCursor,
            };
          })
        : Promise.resolve([]),
    ]);

    return {
      url: target.label,
      serverInfo: {
        name: info?.name ?? "Unknown Server",
        version: info?.version ?? "unknown",
      },
      capabilities: { tools: hasTools, resources: hasResources, prompts: hasPrompts },
      tools,
      resources,
      prompts,
      transport,
      connectionTimeMs,
    };
  } catch (err) {
    if (err instanceof ConnectError) throw err;
    throw new ConnectError("CONNECTION_FAILED", `Connected, but listing failed: ${describe(err)}`);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function healthDirect(target: Target, opts: ConnectOptions = {}): Promise<HealthResult> {
  const started = Date.now();
  try {
    const { client, connectionTimeMs } = await connect(target, opts);
    await client.close().catch(() => {});
    return { status: "up", latencyMs: connectionTimeMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (err instanceof ConnectError && err.code === "UNAUTHORIZED") {
      return { status: "auth_required", latencyMs };
    }
    return { status: "down", latencyMs };
  }
}
