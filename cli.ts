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
import { runProfile } from "./lib/profile";
import { runContext } from "./lib/context";

const API = `http://localhost:${process.env.MCBOT_API_PORT || 3847}`;
const PROFILES_DIR = join(import.meta.dirname, "profiles");
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
  runProfile(PROFILES_DIR, params);
}

if (spec.name === "context") {
  const name = params.name;
  if (!name) {
    console.error("usage: mcbot context <name> [--goal GOAL]");
    process.exit(1);
  }
  try {
    await runContext(API, PROFILES_DIR, name, params.goal || "");
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

try {
  const fetchOpts: RequestInit = needsPost
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) }
    : {};
  const res = await fetch(url, fetchOpts);
  const data: any = await res.json();

  if (!res.ok || data.error) {
    console.error(`error: ${data.error || `request failed (${res.status})`}`);
    process.exit(1);
  }

  formatOutput(spec.name, data);
} catch (err: any) {
  if (err.code === "ConnectionRefused" || err.message?.includes("fetch")) {
    console.error("error: mcbot server not running. start with: bun run server.ts");
  } else {
    console.error(`error: ${err.message}`);
  }
  process.exit(1);
}
