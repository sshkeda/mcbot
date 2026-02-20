#!/usr/bin/env bun
import {
  applyPositional,
  formatCommandError,
  getCommands,
  resolveCommand,
  validateParams,
} from "./lib/commands";

const API = `http://localhost:${process.env.MCBOT_API_PORT || 3847}`;
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
} else {
  scope = "bot";
  botName = allArgs[0] || null;
  cmdInput = allArgs[1] || "status";
  args = allArgs.slice(2);
}

if (scope === "bot" && !botName) {
  console.error("error: need a bot name. use: mcbot <botName> <command>");
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

const qs = new URLSearchParams(params).toString();
const url = scope === "fleet"
  ? `${API}/${spec.name}${qs ? `?${qs}` : ""}`
  : `${API}/${botName}/${spec.name}${qs ? `?${qs}` : ""}`;

function formatOutput(command: string, data: any): void {
  if (command === "spawn") {
    console.log(`spawned ${data.name} at ${data.x} ${data.y} ${data.z}`);
    return;
  }
  if (command === "list") {
    if (data.bots.length === 0) {
      console.log("no bots spawned");
    } else {
      for (const b of data.bots) {
        console.log(`  ${b.name}  pos: ${b.position.x} ${b.position.y} ${b.position.z}  hp: ${b.health}`);
      }
    }
    return;
  }
  if (command === "kill" || command === "killall") {
    console.log(data.status);
    return;
  }
  if (command === "ping") {
    console.log(`server: ok  bots: [${data.bots.join(", ")}]`);
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
  if (command === "chop") {
    console.log(`chopped ${data.chopped} logs`);
    return;
  }
  if (command === "pickup") {
    console.log(`collected ${data.collected} items`);
    return;
  }
  if (command === "mine") {
    console.log(`mined ${data.mined} blocks: ${data.blocks.join(", ") || "none"}`);
    return;
  }
  if (command === "craft") {
    if (data.error) console.log(`craft failed: ${data.error}`);
    else console.log(`crafted ${data.item} x${data.crafted}`);
    return;
  }
  if (command === "smelt") {
    if (data.error) console.log(`smelt failed: ${data.error}`);
    else console.log(`smelted ${data.item} x${data.smelted}`);
    return;
  }
  if (command === "place") {
    if (data.placed) console.log(`placed ${data.block} at ${data.position.x} ${data.position.y} ${data.position.z}`);
    else console.log(`place failed: ${data.error}`);
    return;
  }
  if (command === "fight") {
    console.log(`killed ${data.killed} mobs: ${data.mobs.join(", ") || "none"}`);
    return;
  }
  if (command === "farm") {
    console.log(`harvested ${data.harvested}, replanted ${data.replanted}`);
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
    if (entities.players.length > 0) console.log(`  players: ${entities.players.join(", ")}`);
    console.log(`  hostiles: ${entities.hostiles}  animals: ${entities.animals}`);
    return;
  }
  if (command === "camera") {
    console.log(`camera ${data.name} placed at ${data.position.x} ${data.position.y} ${data.position.z}`);
    return;
  }
  if (command === "screenshot" || command === "pov" || command === "render") {
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
  const res = await fetch(url);
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
