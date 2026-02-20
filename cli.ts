#!/usr/bin/env bun
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyPositional,
  formatCommandError,
  getCommands,
  resolveCommand,
  validateParams,
} from "./lib/commands";

const API = `http://localhost:${process.env.MCBOT_API_PORT || 3847}`;
const PROFILES_DIR = join(import.meta.dirname, "mcbots");
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
  const name = params.name;
  if (!name) {
    console.error("usage: mcbot profile <name> [--init] [--memory TEXT]");
    process.exit(1);
  }
  const profileDir = join(PROFILES_DIR, name);
  const soulPath = join(profileDir, "SOUL.md");
  const metaPath = join(profileDir, "metadata.json");

  if (params.init === "true") {
    if (existsSync(profileDir)) {
      console.error(`profile already exists: ${profileDir}`);
      process.exit(1);
    }
    const templateDir = join(PROFILES_DIR, "_template");
    mkdirSync(profileDir, { recursive: true });
    const soulTemplate = readFileSync(join(templateDir, "SOUL.md"), "utf-8");
    writeFileSync(join(profileDir, "SOUL.md"), soulTemplate.replace(/\{\{NAME\}\}/g, name));
    const metaTemplate = JSON.parse(readFileSync(join(templateDir, "metadata.json"), "utf-8"));
    metaTemplate.createdAt = new Date().toISOString();
    writeFileSync(join(profileDir, "metadata.json"), JSON.stringify(metaTemplate, null, 2) + "\n");
    console.log(`created profile: ${profileDir}`);
    process.exit(0);
  }

  if (params.memory) {
    if (!existsSync(metaPath)) {
      console.error(`no profile for "${name}". create one with: mcbot profile ${name} --init`);
      process.exit(1);
    }
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    if (!Array.isArray(meta.memories)) meta.memories = [];
    meta.memories.push(params.memory);
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
    console.log(`added memory (${meta.memories.length} total)`);
    process.exit(0);
  }

  // Show profile
  if (!existsSync(profileDir)) {
    console.log(`no profile for "${name}". create one with: mcbot profile ${name} --init`);
    process.exit(0);
  }
  if (existsSync(soulPath)) {
    console.log(readFileSync(soulPath, "utf-8"));
  }
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    console.log("--- metadata ---");
    if (meta.role) console.log(`role: ${meta.role}`);
    if (meta.home) console.log(`home: ${meta.home.x} ${meta.home.y} ${meta.home.z}`);
    if (meta.preferredEquipment?.length) console.log(`equipment: ${meta.preferredEquipment.join(", ")}`);
    if (meta.specializations?.length) console.log(`specializations: ${meta.specializations.join(", ")}`);
    if (meta.relationships && Object.keys(meta.relationships).length) {
      console.log("relationships:");
      for (const [bot, rel] of Object.entries(meta.relationships)) console.log(`  ${bot}: ${rel}`);
    }
    if (meta.memories?.length) {
      console.log(`memories (${meta.memories.length}):`);
      for (const m of meta.memories.slice(-10)) console.log(`  - ${m}`);
    }
    if (meta.createdAt) console.log(`created: ${meta.createdAt}`);
  }
  process.exit(0);
}

if (spec.name === "context") {
  const name = params.name;
  if (!name) {
    console.error("usage: mcbot context <name> [--goal GOAL]");
    process.exit(1);
  }
  const goal = params.goal || "";
  try {
    // Fetch bot status + inventory for context
    const [statusResRaw, invResRaw, listResRaw] = await Promise.all([
      fetch(`${API}/${name}/status`).then(r => r.json()).catch(() => null),
      fetch(`${API}/${name}/inventory`).then(r => r.json()).catch(() => null),
      fetch(`${API}/list`).then(r => r.json()).catch(() => null),
    ]);
    const statusRes = statusResRaw as any;
    const invRes = invResRaw as any;
    const listRes = listResRaw as any;

    const botCommands = getCommands("bot");
    const cmdList = botCommands.map(c => `  bun run cli.ts ${name} ${c.usage.padEnd(50)} ${c.summary}`).join("\n");

    // Read bot profile if it exists
    let profileBlock = "";
    const profileDir = join(PROFILES_DIR, name);
    const soulPath = join(profileDir, "SOUL.md");
    const metaPath = join(profileDir, "metadata.json");

    if (existsSync(soulPath)) {
      const soul = readFileSync(soulPath, "utf-8").trim();
      if (soul) profileBlock += `\n\n## Personality & Identity\n${soul}`;
    }

    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        const parts: string[] = [];
        if (meta.role) parts.push(`- Role: ${meta.role}`);
        if (meta.home) parts.push(`- Home base: ${meta.home.x} ${meta.home.y} ${meta.home.z}`);
        if (meta.preferredEquipment?.length) parts.push(`- Preferred equipment: ${meta.preferredEquipment.join(", ")}`);
        if (meta.specializations?.length) parts.push(`- Specializations: ${meta.specializations.join(", ")}`);
        if (meta.relationships && Object.keys(meta.relationships).length) {
          parts.push("- Relationships:");
          for (const [bot, rel] of Object.entries(meta.relationships)) parts.push(`  - ${bot}: ${rel}`);
        }
        if (meta.memories?.length) {
          const recent = meta.memories.slice(-20);
          parts.push(`- Memories (${meta.memories.length} total, showing last ${recent.length}):`);
          for (const m of recent) parts.push(`  - ${m}`);
        }
        if (parts.length > 0) profileBlock += `\n\n## Profile Data\n${parts.join("\n")}`;
      } catch {}
    }

    let statusBlock = "";
    if (statusRes && !statusRes.error && statusRes.position) {
      const s = statusRes;
      statusBlock = `\n## Current State\n- Position: ${s.position.x} ${s.position.y} ${s.position.z}\n- Health: ${s.health}  Food: ${s.food}\n- Time: ${s.time}  Biome: ${s.biome}`;
    }

    let invBlock = "";
    if (Array.isArray(invRes) && invRes.length > 0) {
      invBlock = `\n\n## Inventory\n${invRes.map((i: any) => `- ${i.name} x${i.count}`).join("\n")}`;
    }

    let otherBots = "";
    if (Array.isArray(listRes?.bots) && listRes.bots.length > 1) {
      const others = listRes.bots.filter((b: any) => b.name !== name);
      if (others.length > 0) {
        otherBots = `\n\n## Other Active Bots\n${others.map((b: any) => `- ${b.name} at ${b.position.x} ${b.position.y} ${b.position.z}`).join("\n")}`;
      }
    }

    const goalBlock = goal
      ? `\n\n## Your Goal\n${goal}`
      : `\n\n## Your Goal\nExplore and report on your surroundings`;

    const prompt = `You are controlling the Minecraft bot "${name}" via CLI commands.
All commands must be run from \`/srv/blockgame-server\` using \`bun run cli.ts\`.
${profileBlock}${statusBlock}${invBlock}${otherBots}${goalBlock}

## Available Commands
${cmdList}

## Rules
- Run all commands via Bash: \`bun run cli.ts ${name} <command> [args]\`
- After running pov or render, use the Read tool to view the returned PNG file path.
- screenshot returns a text context grid (not a PNG).
- Check \`bun run cli.ts ${name} status\` and \`bun run cli.ts ${name} inventory\` periodically to stay aware of your state.
- If a command fails, read the error and try an alternative approach. Do not retry the same command blindly.
- When done with the goal, report what you accomplished.
- **Be efficient with turns** — batch independent commands together in a single response when possible (e.g. run \`goto\` and \`chat\` in parallel if they don't depend on each other). Each tool call costs a turn, and you have a finite budget.

## Disconnect Detection & Recovery
Your bot can disconnect at any time (server restart, kick, network issue). Watch for these signs:
- **Error containing "not found" or "disconnected"** — the bot is gone from the server.
- **Error containing "server not running"** — the mcbot API server itself is down.
- **Commands hanging or timing out** — the bot may be in a broken state.

**When you detect a disconnect:**
1. Check if the server is still running: \`bun run cli.ts ping\`
2. If the server is up but your bot is gone, respawn it: \`bun run cli.ts spawn ${name} --port 25565\`
3. After respawning, re-check status and continue your goal from where you left off.
4. If the server is also down, report the issue — you cannot recover without the server.

## Progress Tracking
Use task tracking tools to keep the user informed:
- At the start, use **TaskCreate** to break your goal into concrete sub-tasks. Give each task a clear \`subject\`, \`description\`, and \`activeForm\`.
- Use **TaskUpdate** to set status to \`in_progress\` when starting and \`completed\` when done.
- If you discover new work mid-task, use **TaskCreate** to add it.`;

    console.log(prompt);
  } catch (err: any) {
    console.error(`error: could not reach mcbot server — ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

const POST_COMMANDS = new Set(["execute", "save_skill"]);
const needsPost = POST_COMMANDS.has(spec.name);

const qs = needsPost ? "" : new URLSearchParams(params).toString();
const url = scope === "fleet"
  ? `${API}/${spec.name}${qs ? `?${qs}` : ""}`
  : `${API}/${botName}/${spec.name}${qs ? `?${qs}` : ""}`;

function formatOutput(command: string, data: any): void {
  if (command === "spawn") {
    if (data.status === "batch") {
      for (const s of data.spawned) console.log(`spawned ${s.name} at ${s.x} ${s.y} ${s.z}`);
      for (const e of data.errors) console.log(`failed ${e.name}: ${e.error}`);
      console.log(`${data.spawned.length}/${data.total} spawned`);
    } else {
      console.log(`spawned ${data.name} at ${data.x} ${data.y} ${data.z}`);
    }
    return;
  }
  if (command === "list") {
    if (data.bots.length === 0) {
      console.log("no bots spawned");
    } else {
      const now = Date.now();
      for (const b of data.bots) {
        if (b.status === "connecting") {
          console.log(`  ${b.name}  (connecting...)`);
        } else {
          let line = `  ${b.name}  pos: ${b.position.x} ${b.position.y} ${b.position.z}  hp: ${b.health}`;
          if (b.lock) line += `  \x1b[33m🔒 ${b.lock.agent || "locked"}\x1b[0m`;
          if (b.lastCommandAt) {
            const ago = Math.round((now - b.lastCommandAt) / 1000);
            if (ago < 30) line += `  \x1b[32m● active (${ago}s ago)\x1b[0m`;
          }
          console.log(line);
        }
      }
    }
    return;
  }
  if (command === "kill" || command === "killall") {
    console.log(data.status);
    return;
  }
  if (command === "ping") {
    const parts = [`server: ok  bots: [${data.bots.join(", ")}]`];
    if (data.connecting?.length > 0) parts.push(`connecting: [${data.connecting.join(", ")}]`);
    console.log(parts.join("  "));
    return;
  }
  if (command === "tools") {
    if (!Array.isArray(data.tools) || data.tools.length === 0) {
      console.log("no tools");
      return;
    }
    for (const t of data.tools) {
      console.log(`  ${t.tool}  (${t.scope})  -> ${t.command}`);
      console.log(`    ${t.usage}`);
    }
    return;
  }
  if (command === "tool") {
    if (!data.command || data.result === undefined) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    console.log(`[tool] ${data.tool} -> ${data.command}`);
    formatOutput(data.command, data.result);
    return;
  }
  if (command === "status") {
    const { position: p, health, food, time, biome } = data;
    console.log(`pos: ${p.x} ${p.y} ${p.z}  hp: ${health}  food: ${food}  ${time}  ${biome}`);
    return;
  }
  if (command === "inventory") {
    if (data.length === 0) {
      console.log("(empty)");
    } else {
      for (const i of data) console.log(`  ${i.name} x${i.count}`);
    }
    return;
  }
  if (command === "look") {
    console.log(`pos: ${data.position.x} ${data.position.y} ${data.position.z}`);
    if (data.lookingAt) console.log(`looking at: ${data.lookingAt}`);
    if (data.standingOn) console.log(`standing on: ${data.standingOn}`);
    if (data.nearby.length > 0) {
      console.log("nearby:");
      for (const e of data.nearby) console.log(`  ${e.name} (${e.type}) ${e.distance}m`);
    }
    return;
  }
  if (command === "block") {
    console.log(`${data.name} at ${data.position.x} ${data.position.y} ${data.position.z}`);
    console.log(`  hardness: ${data.hardness}  diggable: ${data.diggable}  bbox: ${data.boundingBox}`);
    if (data.metadata) console.log(`  metadata: ${data.metadata}`);
    return;
  }
  if (command === "recipes") {
    if (!data.craftable) {
      console.log(`${data.item}: not craftable (${data.reason})`);
      if (data.ingredients) {
        console.log(`  requires${data.needsTable ? " (crafting table)" : ""}:`);
        for (const [name, count] of Object.entries(data.ingredients)) console.log(`    ${name} x${count}`);
      }
    } else {
      console.log(`${data.item}: craftable${data.needsTable ? " (needs crafting table)" : ""}`);
      console.log("  ingredients:");
      for (const [name, count] of Object.entries(data.ingredients)) console.log(`    ${name} x${count}`);
    }
    return;
  }
  if (command === "execute") {
    console.log(`[${data.id}] ${data.name} — ${data.status}`);
    if (data.status === "done" && data.result !== undefined) console.log(`  result: ${JSON.stringify(data.result)}`);
    if (data.error) console.log(`  error: ${data.error}`);
    if (data.logs?.length) for (const l of data.logs) console.log(`  > ${l}`);
    return;
  }
  if (command === "queue") {
    if (data.status) { console.log(data.status); return; }
    const q = data.queue || [];
    if (q.length === 0) { console.log("(queue empty)"); return; }
    for (const a of q) {
      const dur = a.finishedAt && a.startedAt ? `${new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()}ms` : "";
      console.log(`  [${a.status.padEnd(9)}] ${a.name} ${dur}`);
      if (a.error) console.log(`           error: ${a.error}`);
    }
    if (data.current) console.log(`\ncurrent: ${data.current.name} (${data.current.id})`);
    return;
  }
  if (command === "state") {
    const p = data.position;
    const v = data.velocity;
    let line = `pos: ${p.x} ${p.y} ${p.z}  vel: ${v.x} ${v.y} ${v.z}  hp: ${data.health}  food: ${data.food}`;
    if (data.isCollidedHorizontally) line += "  COLLIDED";
    if (!data.onGround) line += "  AIRBORNE";
    console.log(line);
    if (data.currentAction) console.log(`action: ${data.currentAction.name} (${data.currentAction.status})`);
    console.log(`queue: ${data.queueLength} pending  inbox: ${data.inboxCount}  directives: ${data.directiveCount}  ${data.time}  ${data.biome}`);
    return;
  }
  if (command === "skills") {
    const skills = data.skills || [];
    if (skills.length === 0) { console.log("(no skills)"); return; }
    for (const s of skills) console.log(`  ${s.name.padEnd(20)} ${s.description}`);
    return;
  }
  if (command === "load_skill") {
    console.log(`--- ${data.skill.name} ---`);
    if (data.skill.description) console.log(`# ${data.skill.description}`);
    console.log(data.code);
    return;
  }
  if (command === "save_skill") {
    console.log(`saved skill: ${data.name}`);
    return;
  }
  if (command === "locks") {
    const locks = data.locks || [];
    if (locks.length === 0) { console.log("(no locks)"); return; }
    for (const l of locks) {
      console.log(`  ${l.bot.padEnd(16)} pid:${l.pid} agent:${l.agent || "?"} goal:${l.goal || "-"} since:${l.lockedAt.slice(11, 19)}`);
    }
    return;
  }
  if (command === "lock") {
    console.log(`locked ${data.lock.bot} (pid:${data.lock.pid})`);
    return;
  }
  if (command === "unlock") {
    console.log(data.status);
    return;
  }
  if (command === "place") {
    if (data.placed) console.log(`placed ${data.block} at ${data.position.x} ${data.position.y} ${data.position.z}`);
    else console.log(`place failed: ${data.error}`);
    return;
  }
  if (command === "give") {
    console.log(data.status);
    if (data.items) for (const i of data.items) console.log(`  ${i.name} x${i.count}`);
    return;
  }
  if (command === "survey") {
    const { position: p, radius, blocks, entities } = data;
    console.log(`survey at ${p.x} ${p.y} ${p.z} (radius ${radius})`);
    console.log(`  logs: ${blocks.logs}  water: ${blocks.water}  lava: ${blocks.lava}`);
    if (Object.keys(blocks.ores).length > 0) {
      console.log("  ores:");
      for (const [name, count] of Object.entries(blocks.ores)) console.log(`    ${name}: ${count}`);
    }
    if (data.nearest) {
      const n = data.nearest;
      if (n.log) console.log(`  nearest log: ${n.log.x} ${n.log.y} ${n.log.z}`);
      if (n.water) console.log(`  nearest water: ${n.water.x} ${n.water.y} ${n.water.z}`);
      if (n.lava) console.log(`  nearest lava: ${n.lava.x} ${n.lava.y} ${n.lava.z}`);
      if (n.ores && Object.keys(n.ores).length > 0) {
        for (const [name, pos] of Object.entries(n.ores) as [string, any][]) {
          console.log(`  nearest ${name}: ${pos.x} ${pos.y} ${pos.z}`);
        }
      }
    }
    if (entities.players.length > 0) console.log(`  players: ${entities.players.join(", ")}`);
    console.log(`  hostiles: ${entities.hostiles}  animals: ${entities.animals}`);
    return;
  }
  if (command === "camera") {
    console.log(`camera ${data.name} placed at ${data.position.x} ${data.position.y} ${data.position.z}`);
    return;
  }
  if (command === "logs") {
    if (!data.entries || data.entries.length === 0) {
      console.log("no activity yet");
      if (data.file) console.log(`log file: ${data.file}`);
      return;
    }
    for (const e of data.entries) {
      const time = e.ts.slice(11, 19); // HH:MM:SS
      const dur = `${e.durationMs}ms`.padStart(7);
      const status = e.ok ? " " : "!";
      console.log(`${time} ${status} [${e.bot.padEnd(12)}] ${e.command.padEnd(12)} ${dur}  ${e.summary}`);
    }
    console.log(`\n${data.entries.length} entries (log file: ${data.file})`);
    return;
  }
  if (command === "inbox") {
    if (data.count === 0) {
      console.log("(no messages)");
    } else {
      for (const m of data.messages) {
        const time = m.ts.slice(11, 19);
        console.log(`${time} <${m.sender}> ${m.message}`);
      }
      console.log(`\n${data.count} message(s)`);
    }
    return;
  }
  if (command === "direct") {
    console.log(`directive posted (${data.pending} pending)`);
    return;
  }
  if (command === "directives") {
    if (data.count === 0) {
      console.log("(no directives)");
    } else {
      for (const d of data.directives) {
        const time = d.ts.slice(11, 19);
        console.log(`${time} ${d.text}`);
      }
      console.log(`\n${data.count} directive(s)`);
    }
    return;
  }
  if (command === "screenshot") {
    if (data.context) {
      console.log(`context ${data.size}x${data.size} @ ${data.center.x} ${data.center.y} ${data.center.z}`);
      console.log(data.legend);
      console.log(data.context);
      return;
    }
    if (data.file) {
      console.log(data.file);
      return;
    }
    console.log(JSON.stringify(data));
    return;
  }
  if (command === "pov" || command === "render") {
    console.log(data.file);
    return;
  }
  if (command === "map") {
    console.log(data.map);
    return;
  }

  const msg = data.status || data.message || JSON.stringify(data);
  console.log(msg);
}

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
