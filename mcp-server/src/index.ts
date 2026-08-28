#!/usr/bin/env node
/**
 * Maestro Connect MCP server (Beta).
 *
 * Speaks MCP to Claude over stdio, and hosts a localhost WebSocket the running
 * editor connects to. Tool calls from Claude are relayed to the bound tab, which
 * executes them against the live schematic and replies.
 *
 * IMPORTANT: stdout is reserved for the MCP stdio protocol — all human-facing
 * logging goes to stderr.
 */
import { randomBytes } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AppBridge } from "./bridge.js";
import { saveToGit, listGitSchematics, openGitFile } from "./git.js";
import { TOOLS } from "./tools.js";
import { PROMPTS, getPrompt, SERVER_INSTRUCTIONS } from "./prompts.js";
import { DEFAULT_BRIDGE_PORT } from "./protocol.generated.js";

const log = (msg: string) => process.stderr.write(`[maestro-mcp] ${msg}\n`);

const port = Number(process.env.MAESTRO_MCP_PORT) || DEFAULT_BRIDGE_PORT;
const token = process.env.MAESTRO_MCP_TOKEN || randomBytes(16).toString("hex");
const allowedOrigins = (process.env.MAESTRO_MCP_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Git integration: set MAESTRO_GIT_ROOT to the directory holding your
// project repositories (each project = its own repo). Enables the app's
// File > Open from Git and File > Save to Git. MAESTRO_GIT_REPO is
// accepted as a legacy alias; MAESTRO_GIT_SUBDIR applies to ref-less
// first-time saves only.
const gitRoot = (process.env.MAESTRO_GIT_ROOT || process.env.MAESTRO_GIT_REPO)?.trim();
const gitSubdir = process.env.MAESTRO_GIT_SUBDIR?.trim() || undefined;
const gitConfig = gitRoot ? { root: gitRoot, subdir: gitSubdir } : null;

const requireGit = () => {
  if (!gitConfig) {
    throw new Error("Git features are not configured — start the MCP server with MAESTRO_GIT_ROOT=/path/to/repos.");
  }
  return gitConfig;
};

const bridge = new AppBridge({
  port,
  token,
  allowedOrigins,
  log,
  onClientRequest: async (command, params) => {
    switch (command) {
      case "listGitFiles":
        return listGitSchematics(requireGit());
      case "openGitFile":
        return openGitFile(requireGit(), String((params as { ref?: unknown }).ref ?? ""));
      case "saveToGit":
        return saveToGit(requireGit(), params as { ref?: string; fileName: string; json: string; message: string });
      default:
        throw new Error(`Unknown request "${command}".`);
    }
  },
});
bridge.start();

log("");
log(`WebSocket bridge listening on ws://127.0.0.1:${port}`);
log(`Pairing token: ${token}`);
if (gitRoot) log(`Git root: ${gitRoot} (Open from Git / Save to Git enabled)`);
log("Paste this token into Maestro Connect → Preferences → AI (Beta), then turn the toggle on.");
log("");

const server = new Server(
  { name: "maestro", version: "0.1.0" },
  { capabilities: { tools: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

server.setRequestHandler(GetPromptRequestSchema, async (req) =>
  getPrompt(req.params.name, req.params.arguments),
);

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const result = await bridge.call(name, (args ?? {}) as Record<string, unknown>);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: message }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
log("MCP server ready (stdio). Waiting for the editor to connect…");
