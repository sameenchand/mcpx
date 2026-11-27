import { describe, expect, it } from "vitest";
import { isLocalUrl, parseHeaders, parseTarget, splitCommand } from "../src/lib/target";

describe("parseTarget", () => {
  it("treats http, https, ws and wss as URL targets", () => {
    for (const url of ["http://localhost:3001/mcp", "https://a.example/mcp", "ws://h/x", "wss://h/x"]) {
      expect(parseTarget(url)).toMatchObject({ kind: "url", url });
    }
  });

  it("treats anything else as a stdio command", () => {
    expect(parseTarget("npx -y some-server --flag")).toEqual({
      kind: "stdio",
      command: "npx",
      args: ["-y", "some-server", "--flag"],
      label: "npx -y some-server --flag",
    });
  });

  it("rejects an empty target", () => {
    expect(() => parseTarget("   ")).toThrow(/empty/i);
  });
});

describe("splitCommand", () => {
  it("honours quotes and escapes", () => {
    expect(splitCommand(`node "my server.js" --name='a b' c\\ d ""`)).toEqual([
      "node",
      "my server.js",
      "--name=a b",
      "c d",
      "",
    ]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => splitCommand(`node "oops`)).toThrow(/quote/i);
  });
});

describe("isLocalUrl", () => {
  it("flags local and private hosts", () => {
    for (const url of [
      "http://localhost:3000/mcp",
      "http://127.0.0.1/mcp",
      "http://10.1.2.3/mcp",
      "http://192.168.1.5/mcp",
      "http://172.20.0.1/mcp",
      "http://[::1]:8080/mcp",
      "http://build-box/mcp",
      "https://mcp.corp.internal/mcp",
    ]) {
      expect(isLocalUrl(url), url).toBe(true);
    }
  });

  it("does not flag public hosts", () => {
    expect(isLocalUrl("https://mcp.example.com/mcp")).toBe(false);
    expect(isLocalUrl("https://172.32.0.1/mcp")).toBe(false);
  });
});

describe("parseHeaders", () => {
  it("parses Name: value pairs and keeps colons in the value", () => {
    expect(parseHeaders(["Authorization: Bearer a:b", " X-Team : core ", ""])).toEqual({
      Authorization: "Bearer a:b",
      "X-Team": "core",
    });
  });

  it("rejects a malformed header without echoing its value", () => {
    let message = "";
    try {
      parseHeaders(["Authorization=supersecretvalue"]);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Invalid header/);
    expect(message).not.toContain("supersecretvalue");
  });
});
