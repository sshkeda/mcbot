#!/usr/bin/env bun
import { join } from "node:path";
import {
  applyPositional,
  formatCommandError,
  getCommands,
  resolveCommand,
  validateParams,
} from "./lib/commands";
import { formatOutput } from "./lib/formatters";
import { runAgent } from "./lib/agent";
import { runContext } from "./lib/context";
import {
  readServerInfo,
  checkPortInUse,
  startBackground,
  waitForServer,
  stopServer,
} from "./lib/server-lifecycle";

const PORT = Number(process.env.MCBOT_API_PORT) || 3847;
const API = `http://localhost:${PORT}`;
const AGENTS_DIR = join(import.meta.dirname, "agents");
const DEFAULT_BOT = process.env.MCBOT_NAME || "";
const allArgs = process.argv.slice(2);

function printHelp() {
  const fleet = getCommands("fleet");
  const bot = getCommands("bot");

  const printRows = (rows: typeof fleet) => {
    for (const row of rows) {
      console.log(`  ${row.usage.padEnd(58)} ${row.summary}`);
    }
  };

  console.log(`mcbot - Minecraft bot CLI

USAGE
  mcbot <command>                     Fleet command
  mcbot <botName> <command> [opts]    Bot command

ENVIRONMENT
  MCBOT_NAME=<name>    Default bot — skip typing the name each time
  MCBOT_API_PORT=N     API port (default: 3847)
${DEFAULT_BOT ? `\n  (current default bot: ${DEFAULT_BOT})\n` : ""}
SERVER (auto-starts on first command)
  serve                                                    Start server in foreground
  stop                                                     Stop running server
  restart                                                  Restart server (background)
  status                                                   Show server PID, uptime, bots

FLEET`);
  printRows(fleet);

  console.log(`
BOT COMMANDS (mcbot <name> <cmd>)`);
  printRows(bot);
}

function parseArgs(args: string[]) {
  const params: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        params[key] = next;
        i++;
      } else {
        params[key] = "true";
      }
      continue;
    }

    positional.push(arg);
  }

  return { params, positional };
}

if (allArgs.length === 0 || allArgs[0] === "help" || allArgs[0] === "-h") {
  printHelp();
  process.exit(0);
}

// ── Lifecycle commands (handled before fleet/bot routing) ───────────
const LIFECYCLE = new Set(["serve", "stop", "restart", "status"]);
if (LIFECYCLE.has(allArgs[0]!)) {
  const cmd = allArgs[0]!;

  if (cmd === "serve") {
    const existing = readServerInfo();
    if (existing) {
      console.error(`error: server already running (pid ${existing.pid}, port ${existing.port})`);
      process.exit(1);
    }
    const portBusy = await checkPortInUse(PORT);
    if (portBusy) {
      console.error(`error: port ${PORT} is already in use by another process`);
      process.exit(1);
    }
    // Run server in foreground via dynamic import (holds event loop open)
    await import("./server.ts");

  } else if (cmd === "stop") {
    const info = readServerInfo();
    if (!info) {
      console.log("server is not running");
      process.exit(0);
    }
    console.log(`stopping server (pid ${info.pid})...`);
    await stopServer(info);
    console.log("server stopped");
    process.exit(0);

  } else if (cmd === "restart") {
    const existing = readServerInfo();
    if (existing) {
      console.log(`stopping server (pid ${existing.pid})...`);
      await stopServer(existing);
    }
    const portBusy = await checkPortInUse(PORT);
    if (portBusy) {
      console.error(`error: port ${PORT} is already in use by another process`);
      process.exit(1);
    }
    const pid = startBackground(PORT);
    console.log(`starting server (pid ${pid})...`);
    await waitForServer(PORT);
    console.log(`server ready on port ${PORT}`);
    process.exit(0);

  } else if (cmd === "status") {
    const info = readServerInfo();
    if (!info) {
      console.log("server is not running");
      process.exit(0);
    }
    const uptime = Math.floor((Date.now() - new Date(info.startedAt).getTime()) / 1000);
    const mins = Math.floor(uptime / 60);
    const secs = uptime % 60;
    console.log(`  pid:     ${info.pid}`);
    console.log(`  port:    ${info.port}`);
    console.log(`  uptime:  ${mins}m ${secs}s`);
    console.log(`  log:     ${info.logFile}`);
    // Try to fetch bot count from server
    try {
      const res = await fetch(`${API}/ping`);
      const data: any = await res.json();
      console.log(`  bots:    ${data.bots?.length || 0} active${data.bots?.length ? ` (${data.bots.join(", ")})` : ""}`);
    } catch {
      console.log(`  bots:    (could not reach server)`);
    }
    process.exit(0);
  }
}

let botName: string | null = null;
let cmdInput: string;
let args: string[];
let scope: "fleet" | "bot";

if (resolveCommand("fleet", allArgs[0])) {
  scope = "fleet";
  cmdInput = allArgs[0]!;
  args = allArgs.slice(1);
} else if (DEFAULT_BOT && resolveCommand("bot", allArgs[0])) {
  // MCBOT_NAME is set and first arg is a valid bot command — use default bot
  scope = "bot";
  botName = DEFAULT_BOT;
  cmdInput = allArgs[0]!;
  args = allArgs.slice(1);
} else {
  scope = "bot";
  botName = allArgs[0] || null;
  cmdInput = allArgs[1] || "status";
  args = allArgs.slice(2);
}

if (scope === "bot" && !botName) {
  console.error("error: need a bot name (or set MCBOT_NAME). use: mcbot <botName> <command>");
  process.exit(1);
}

const spec = resolveCommand(scope, cmdInput);
if (!spec) {
  console.error(`error: ${formatCommandError(scope, cmdInput)}`);
  process.exit(1);
}

const { params, positional } = parseArgs(args);
applyPositional(spec, positional, params);

const validationError = validateParams(spec, params);
if (validationError) {
  console.error(`error: ${validationError}`);
  process.exit(1);
}

// ── Client-side commands (no server round-trip needed) ──────────────
if (spec.name === "use") {
  const name = params.name;
  if (!name) {
    if (DEFAULT_BOT) {
      console.log(`current default bot: ${DEFAULT_BOT}`);
    } else {
      console.log("no default bot set");
    }
    console.log("\nusage: mcbot use <name>");
    console.log("  then run:  export MCBOT_NAME=<name>");
    console.log("  or:        eval $(mcbot use <name>)");
    process.exit(0);
  }
  // Output an export command — user can eval it or copy-paste it
  console.error(`# Run this in your terminal (or: eval $(mcbot use ${name}))`);
  console.log(`export MCBOT_NAME=${name}`);
  process.exit(0);
}

if (spec.name === "profile") {
  runAgent(AGENTS_DIR, params);
}

if (spec.name === "context") {
  const name = params.name;
  if (!name) {
    console.error("usage: mcbot context <name> [--goal GOAL]");
    process.exit(1);
  }
  try {
    await runContext(API, AGENTS_DIR, name, params.goal || "");
  } catch (err: any) {
    console.error(`error: could not reach mcbot server — ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// ── Server commands ─────────────────────────────────────────────────
const POST_COMMANDS = new Set(["execute", "save_skill"]);
const needsPost = POST_COMMANDS.has(spec.name);

const qs = needsPost ? "" : new URLSearchParams(params).toString();
const url = scope === "fleet"
  ? `${API}/${spec.name}${qs ? `?${qs}` : ""}`
  : `${API}/${botName}/${spec.name}${qs ? `?${qs}` : ""}`;

async function doFetch(): Promise<any> {
  const fetchOpts: RequestInit = needsPost
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) }
    : {};
  const res = await fetch(url, fetchOpts);
  const data: any = await res.json();
  if (!res.ok || data.error) {
    console.error(`error: ${data.error || `request failed (${res.status})`}`);
    process.exit(1);
  }
  return data;
}

function isConnectionError(err: any): boolean {
  return err.code === "ConnectionRefused" || err.message?.includes("fetch failed");
}

try {
  formatOutput(spec.name, await doFetch());
} catch (err: any) {
  if (!isConnectionError(err)) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }

  // Auto-start server
  const info = readServerInfo();
  if (info) {
    // PID file says server is alive but we can't connect — something is wrong
    console.error(`error: server pid ${info.pid} is running but not responding on port ${info.port}`);
    process.exit(1);
  }

  const portBusy = await checkPortInUse(PORT);
  if (portBusy) {
    console.error(`error: port ${PORT} is in use by another process (not mcbot)`);
    process.exit(1);
  }

  console.error("mcbot server not running, starting...");
  try {
    const pid = startBackground(PORT);
    console.error(`started server (pid ${pid}), waiting for ready...`);
    await waitForServer(PORT);
    console.error("server ready");
  } catch (startErr: any) {
    console.error(`error: failed to auto-start server — ${startErr.message}`);
    process.exit(1);
  }

  // Retry original command
  try {
    formatOutput(spec.name, await doFetch());
  } catch (retryErr: any) {
    console.error(`error: server started but command failed — ${retryErr.message}`);
    process.exit(1);
  }
}
