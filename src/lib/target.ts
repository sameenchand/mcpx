/**
 * A lint target is either a remote MCP endpoint (http, https, ws, wss)
 * or a shell command that starts a stdio MCP server.
 */

export type Target =
  | { kind: "url"; url: string; label: string }
  | { kind: "stdio"; command: string; args: string[]; label: string };

const URL_PREFIX = /^(https?|wss?):\/\//i;

export function parseTarget(input: string): Target {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Target is empty. Pass a server URL or a command that starts a stdio server.");
  }

  if (URL_PREFIX.test(trimmed)) {
    try {
      new URL(trimmed);
    } catch {
      throw new Error(`"${trimmed}" is not a valid URL.`);
    }
    return { kind: "url", url: trimmed, label: trimmed };
  }

  const parts = splitCommand(trimmed);
  const [command, ...args] = parts;
  if (!command) {
    throw new Error(`Could not parse a command from "${trimmed}".`);
  }
  return { kind: "stdio", command, args, label: trimmed };
}

/**
 * Split a command string into argv, honouring single quotes, double quotes
 * and backslash escapes. No shell is involved, so variables, pipes and
 * globs are passed through literally.
 */
export function splitCommand(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let inToken = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < input.length) {
        current += input[++i];
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
    } else if (ch === "\\" && i + 1 < input.length) {
      current += input[++i];
      inToken = true;
    } else if (/\s/.test(ch)) {
      if (inToken) {
        out.push(current);
        current = "";
        inToken = false;
      }
    } else {
      current += ch;
      inToken = true;
    }
  }

  if (quote) {
    throw new Error(`Unterminated ${quote} quote in command.`);
  }
  if (inToken) out.push(current);
  return out;
}

/** True when a URL points at this machine or a private network. */
export function isLocalUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    !host.includes(".")
  );
}

/** Parse repeated "Name: value" header flags into a header map. */
export function parseHeaders(raw: string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of raw ?? []) {
    const line = entry.trim();
    if (line.length === 0) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) {
      throw new Error(`Invalid header (expected "Name: value"). Check the header named "${line.split(/[:=\s]/)[0]}".`);
    }
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    headers[name] = value;
  }
  return headers;
}
