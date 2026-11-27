# mcpx

CLI linter and inspector for MCP servers. Powered by [MCP Playground](https://mcpplayground.tech).

[![Open in MCP Playground](https://mcpplayground.tech/badge.svg)](https://mcpplayground.tech/lint)
[![npm](https://img.shields.io/npm/v/@samsec/mcpx)](https://www.npmjs.com/package/@samsec/mcpx)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Think ESLint, but for MCP server schema quality. `mcpx` grades your server A–F, surfaces missing descriptions, flags token bloat, and fails CI when quality drops — all from a single command.

## Install

```bash
npm install -g @samsec/mcpx
```

Or run without installing:

```bash
npx @samsec/mcpx lint https://mcp.example.com/mcp
```

## Scan your own setup

One command, no arguments:

```bash
npx @samsec/mcpx scan
```

`scan` finds the MCP servers already configured for Claude Desktop, Claude Code, Cursor, VS Code and Windsurf, connects to each one, and reports:

- **Context cost**: how many tokens each server's tool definitions take, and the total per client as a share of the context window.
- **Security**: tool descriptions that carry instructions for the model, hidden characters, or references to credentials.
- **Changes since your last scan**: tools that were removed, changed shape, or had their description reworded after you first approved them.

```
  mcpx scan
  ────────────────────────────────────────────────────────
  SERVER      CLIENTS           TOOLS  TOKENS    GRADE
  github      Cursor, Windsurf  26     ~8,412    B
  weather     Cursor            2      ~117      A
  calculator  Cursor            1      ~95       B  ✗ security
  ────────────────────────────────────────────────────────

  CONTEXT COST
  Tool definitions are loaded into every conversation before you type anything.
  Cursor            ~8,624 tokens  4.3% of a 200,000-token window
  Windsurf          ~8,412 tokens  4.2% of a 200,000-token window

  SECURITY (1)
  ✗ calculator · tool "add_numbers" — Metadata tells the model to hide something from the user. This is a tool-poisoning pattern.
```

Everything runs on your machine. Servers are started the same way your client starts them, with the environment from your config. Values from your config (tokens, headers, arguments, URLs) are never printed or saved. The baseline in `~/.mcpx/scan-lock.json` holds only server names and tool definitions.

Config files checked into the current directory (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`) are skipped by default, because scanning starts the servers they define. Add `--project` for a repo you trust.

| Option | Description | Default |
|---|---|---|
| `--project` | Also scan config files in the current directory | off |
| `--context-window <tokens>` | Window size used for the percentage | `200000` |
| `--timeout <seconds>` | Seconds to wait for each server | `30` |
| `--no-save` | Do not update the baseline | — |
| `--list` | List the servers without starting them | — |
| `--format json` | Output raw JSON | — |

Exits `1` when a security error is found, `0` otherwise. Servers that need an interactive sign-in are listed but not read.

## Targets

Every command takes a **target**, which is either:

- a server URL (`http://`, `https://`, `ws://`, `wss://`), or
- a quoted command that starts a stdio server.

`mcpx` connects straight from the machine it runs on, so it works with localhost, private networks and servers that have no public URL. Nothing is sent to a third party.

```bash
# Remote server
mcpx lint https://mcp.example.com/mcp

# Server on your machine or inside your network
mcpx lint http://localhost:3001/mcp

# stdio server, started by mcpx
mcpx lint "node dist/server.js"
mcpx lint "npx -y your-mcp-package"

# Server that needs credentials
mcpx lint https://mcp.example.com/mcp --header "Authorization: Bearer $TOKEN"
```

Options shared by every command:

| Option | Description |
|---|---|
| `-H, --header <header>` | HTTP header as `"Name: value"`. Repeatable. URL targets only |
| `--timeout <seconds>` | Seconds to wait for the connection. Default 10 for URLs, 60 for commands |
| `--remote` | Run through the hosted MCP Playground API instead of connecting directly. Public URLs only |

## Commands

### `mcpx lint <target>`

Lint an MCP server schema. Exits `0` on pass, `1` on fail, `2` if the server is unreachable.

```bash
mcpx lint https://mcp.example.com/mcp
```

Example output:

```
  MCP Playground — Schema Linter
  ─────────────────────────────────────────
  Server : My MCP Server v1.0.0
  Tools  : 12  ·  Resources: 0  ·  Prompts: 0
  Grade  : B   ·  Score: 85/100
  Tokens : ~1,240 estimated

  ERRORS (1)
  ✗ tool "create_payment" — description too short (8 chars, min 20)

  WARNINGS (3)
  ⚠ tool "refund" — missing required fields declaration
  ⚠ tool "search" — Property "q" has no description.
  ⚠ tool "search" — Description is 420 chars — consider trimming.

  Open in MCP Playground → https://mcpplayground.tech/lint?url=...
  ─────────────────────────────────────────
  ✖ Failed (1 error, 3 warnings)
```

**Options:**

| Option | Description | Default |
|---|---|---|
| `--fail-on <level>` | Fail on `errors` or `warnings` | `errors` |
| `--min-grade <grade>` | Fail if grade is below threshold (A, B, C, D, F) | — |
| `--token-budget <n>` | Fail if token footprint exceeds N | — |
| `--format json` | Output raw JSON (no spinner, pipeable) | — |
| `--quiet` | No output — just the exit code | — |

**Examples:**

```bash
# Fail CI only on errors (default)
mcpx lint https://mcp.example.com/mcp --fail-on errors

# Fail CI on any warnings too
mcpx lint https://mcp.example.com/mcp --fail-on warnings

# Require at least a B grade
mcpx lint https://mcp.example.com/mcp --min-grade B

# Fail if server token footprint exceeds 5,000 tokens
mcpx lint https://mcp.example.com/mcp --token-budget 5000

# Machine-readable output for scripting
mcpx lint https://mcp.example.com/mcp --format json | jq '.grade'

# Silent — check exit code only
mcpx lint https://mcp.example.com/mcp --quiet && echo "passed"
```

---

### `mcpx inspect <target>`

Show all tools, resources, and prompts exposed by an MCP server.

```bash
mcpx inspect https://mcp.example.com/mcp
mcpx inspect https://mcp.example.com/mcp --format json
```

---

### `mcpx health <target>`

Check if an MCP server is reachable and measure latency.

```bash
mcpx health https://mcp.example.com/mcp
```

Output:

```
  MCP Playground — Health Check
  ─────────────────────────────────────────
  URL    : https://mcp.example.com/mcp
  Status : up
  Latency: 143ms
```

Exits `0` if up, `1` if down, `2` if unreachable.

---

### `mcpx diff --base <target> --head <target>`

Compare two versions of an MCP server. Fails CI on a breaking schema change, a grade drop, or a score or token regression beyond the thresholds.

```bash
mcpx diff --base https://mcp.example.com/mcp --head https://mcp-staging.example.com/mcp
```

Output:

```
  MCP Playground — Diff
  ─────────────────────────────────────────
  Grade  : A → B  ✖ dropped
  Score  : 95 → 82  (−13)
  Tokens : ~800 → ~1,240  (+55.0%)

  BREAKING (2)
  ✗ tool "get_weather" — New required parameter "units". Existing calls do not send it.
  ✗ tool "add_numbers" — Tool was removed or renamed. Agents that call it will fail.

  CHANGED (1)
  ~ tool "search" — Tool description changed. Models pick tools by description, so selection behaviour can shift.
```

Compare the server on your branch against production in a pull request:

```bash
mcpx diff --base https://mcp.example.com/mcp --head "node dist/server.js"
```

**What counts as breaking:**

| Change | Result |
|---|---|
| Tool, resource or prompt removed or renamed | Breaking |
| Parameter removed, or its type changed | Breaking |
| New required parameter, or optional made required | Breaking |
| Enum value removed, or free-form value restricted to an enum | Breaking |
| Tool or parameter description reworded | Changed |
| Enum value added, required made optional | Changed |
| New tool, new optional parameter | Added |

Only breaking changes fail the diff. `--format json` includes every change under `schema`.

**Options:**

| Option | Description | Default |
|---|---|---|
| `--score-drop <n>` | Fail if score drops more than N points | `10` |
| `--token-threshold <n>` | Fail if token footprint increases more than N% | `20` |
| `--allow-breaking` | Report breaking schema changes without failing | — |
| `--format json` | Output raw JSON | — |

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Passed — grade meets threshold, no blocking issues |
| `1` | Failed — errors found, grade below threshold, or budget exceeded |
| `2` | Error — server unreachable, auth required, or timeout |

---

## GitHub Action

Add `mcpx` to any CI pipeline with one step:

```yaml
- uses: sameenchand/mcpx@v1
  with:
    url: ${{ secrets.MCP_SERVER_URL }}
```

**Full example:**

```yaml
name: MCP Schema Quality

on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Lint MCP server
        id: lint
        uses: sameenchand/mcpx@v1
        with:
          url: ${{ secrets.MCP_SERVER_URL }}
          fail-on: errors
          min-grade: B
          token-budget: 5000

      - name: Print results
        run: |
          echo "Grade: ${{ steps.lint.outputs.grade }}"
          echo "Score: ${{ steps.lint.outputs.score }}"
```

**Lint the server in your repo on every pull request**, with no deployed URL needed:

```yaml
      - uses: actions/checkout@v4
      - run: npm ci && npm run build

      - uses: sameenchand/mcpx@v1
        with:
          command: node dist/server.js
          min-grade: B
```

**Lint a server that needs credentials:**

```yaml
      - uses: sameenchand/mcpx@v1
        with:
          url: ${{ secrets.MCP_SERVER_URL }}
          headers: |
            Authorization: Bearer ${{ secrets.MCP_TOKEN }}
```

Header values are masked in the job log.

**Inputs:**

| Input | Description | Required | Default |
|---|---|---|---|
| `url` | MCP server URL to lint. Set this or `command` | One of the two | — |
| `command` | Command that starts a stdio server in the workspace | One of the two | — |
| `headers` | HTTP headers, one `Name: value` per line | No | — |
| `timeout` | Seconds to wait for the connection | No | 10 (URL), 60 (command) |
| `remote` | `true` to run through the hosted API | No | `false` |
| `fail-on` | Fail on `errors` or `warnings` | No | `errors` |
| `min-grade` | Minimum required grade (A–F) | No | — |
| `token-budget` | Max allowed token footprint | No | — |

**Outputs:**

| Output | Description |
|---|---|
| `grade` | Letter grade (A–F) |
| `score` | Numeric score (0–100) |
| `errors` | Number of errors found |
| `warnings` | Number of warnings found |

Issues are surfaced as native GitHub annotations in the Actions UI — warnings and errors appear inline without any extra configuration.

---

## Grading

Scores start at 100 and are deducted per issue:

| Severity | Deduction |
|---|---|
| Error | −15 pts |
| Warning | −5 pts |
| Info | −1 pt |

| Grade | Score |
|---|---|
| A | 90–100 |
| B | 75–89 |
| C | 60–74 |
| D | 40–59 |
| F | 0–39 |

A server with zero tools, resources, and prompts automatically receives an F regardless of score. Full grading methodology: [mcpplayground.tech/docs/grading](https://mcpplayground.tech/docs/grading).

---

## Security checks

`mcpx lint` also scans tool names, descriptions and parameter schemas for tool poisoning: text written for the model instead of the user.

| Rule | Severity | Catches |
|---|---|---|
| `sec-prompt-injection` | Error | Instructions to ignore prior instructions, hide actions from the user, run before or instead of other tools, and instruction-style tags such as `<IMPORTANT>` |
| `sec-hidden-characters` | Error | Zero-width, direction-override and Unicode tag characters |
| `sec-sensitive-path` | Warning | References to SSH keys, cloud credentials, `.env` files and MCP client configuration |
| `sec-hidden-padding` | Warning | Long runs of blank space that push text out of view |

These are pattern checks for known techniques. A clean result does not prove a server is safe.

---

## MCP Playground

`mcpx` runs the [MCP Playground](https://mcpplayground.tech) schema rules locally, plus the security checks above. For a public server, the lint output links to the playground so you can explore the server in a browser.

Pass `--remote` to run a check through the playground's hosted API instead of from your machine. That only works for public URLs and cannot send custom headers. API documentation: [mcpplayground.tech/docs/api](https://mcpplayground.tech/docs/api)

---|---|
| `GET /api/v1/lint?url=` | `mcpx lint` |
| `GET /api/v1/inspect?url=` | `mcpx inspect` |
| `GET /api/v1/health?url=` | `mcpx health` |

API documentation: [mcpplayground.tech/docs/api](https://mcpplayground.tech/docs/api)

---

## License

MIT. See [LICENSE](./LICENSE).

Not affiliated with Anthropic or the Model Context Protocol project.
