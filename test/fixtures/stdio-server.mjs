// Minimal stdio MCP server used by the integration tests.
// Pass "bad" as the first argument to serve a deliberately poor schema.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const bad = process.argv[2] === "bad";

const goodTools = [
  {
    name: "get_weather",
    description: "Look up the current weather conditions for a named city.",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name, for example Chicago" },
      },
      required: ["city"],
    },
  },
  {
    name: "add_numbers",
    description: "Add two numbers together and return the sum.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "First addend" },
        b: { type: "number", description: "Second addend" },
      },
      required: ["a", "b"],
    },
  },
];

const badTools = [
  { name: "do", inputSchema: { type: "object", properties: { x: {} }, required: ["missing"] } },
];

const all = bad ? badTools : goodTools;

const server = new Server(
  { name: bad ? "bad-fixture" : "good-fixture", version: "1.2.3" },
  { capabilities: { tools: {} } },
);

// Serve one tool per page so the client has to follow nextCursor.
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  const index = request.params?.cursor ? Number(request.params.cursor) : 0;
  const next = index + 1 < all.length ? String(index + 1) : undefined;
  return { tools: [all[index]], ...(next ? { nextCursor: next } : {}) };
});

await server.connect(new StdioServerTransport());
