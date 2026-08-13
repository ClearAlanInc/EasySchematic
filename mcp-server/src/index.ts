#!/usr/bin/env node
/**
 * EasySchematic MCP server (Beta).
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
import { saveToGit } from "./git.js";
import { TOOLS } from "./tools.js";
import { PROMPTS, getPrompt, SERVER_INSTRUCTIONS } from "./prompts.js";
import { DEFAULT_BRIDGE_PORT } from "./protocol.generated.js";

const log = (msg: string) => process.stderr.write(`[easyschematic-mcp] ${msg}\n`);

const port = Number(process.env.EASYSCHEMATIC_MCP_PORT) || DEFAULT_BRIDGE_PORT;
const token = process.env.EASYSCHEMATIC_MCP_TOKEN || randomBytes(16).toString("hex");
const allowedOrigins = (process.env.EASYSCHEMATIC_MCP_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// "Save to Git": set EASYSCHEMATIC_GIT_REPO to a working tree to let the app's
// File > Save to Git write + commit there (EASYSCHEMATIC_GIT_SUBDIR optional).
const gitRepo = process.env.EASYSCHEMATIC_GIT_REPO?.trim();
const gitSubdir = process.env.EASYSCHEMATIC_GIT_SUBDIR?.trim() || undefined;

const bridge = new AppBridge({
  port,
  token,
  allowedOrigins,
  log,
  onClientRequest: async (command, params) => {
    if (command !== "saveToGit") throw new Error(`Unknown request "${command}".`);
    if (!gitRepo) {
      throw new Error("Save to Git is not configured — start the MCP server with EASYSCHEMATIC_GIT_REPO=/path/to/repo.");
    }
    return saveToGit(
      { repoDir: gitRepo, subdir: gitSubdir },
      params as { fileName: string; json: string; message: string },
    );
  },
});
bridge.start();

log("");
log(`WebSocket bridge listening on ws://127.0.0.1:${port}`);
log(`Pairing token: ${token}`);
if (gitRepo) log(`Save to Git enabled: ${gitRepo}${gitSubdir ? "/" + gitSubdir : ""}`);
log("Paste this token into EasySchematic → Preferences → AI (Beta), then turn the toggle on.");
log("");

const server = new Server(
  { name: "easyschematic", version: "0.1.0" },
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
