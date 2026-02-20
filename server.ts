import { createServer } from "node:http";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const mineflayer = require("mineflayer");
const pathfinder = require("mineflayer-pathfinder");
const { GoalNear, GoalFollow, GoalBlock } = pathfinder.goals;
const Vec3 = require("vec3").Vec3;
const sharp = require("sharp");
import { withTimeout } from "./lib/utils";
import { ActionQueue } from "./lib/action-queue";
import { type ExecuteContext, executeCode } from "./lib/executor";
import { listSkills, loadSkill, saveSkill } from "./lib/skill-manager";
import { acquireLock, releaseLock, getLocks, isLocked } from "./lib/locks";
import { vanillaMeleeAttack } from "./lib/combat";
import {
  findByTool,
  formatCommandError,
  getCommands,
  resolveCommand,
  validateParams,
  type CommandSpec,
} from "./lib/commands";

interface ChatMessage {
  sender: string;
  message: string;
  ts: string;
}

interface Directive {
  text: string;
  ts: string;
  interrupt?: boolean;
}

interface BotInstance {
  bot: any;
  mcData: any;
  name: string;
  host: string;
  port: number;
  version: string;
  chatInbox: ChatMessage[];
  directives: Directive[];
  actionQueue: ActionQueue;
}

// ── Activity log ────────────────────────────────────────────────────
interface LogEntry {
  ts: string;
  bot: string;
  command: string;
  params: Record<string, string>;
  ok: boolean;
  summary: string;
  durationMs: number;
}

const LOG_MAX = 500;
const activityLog: LogEntry[] = [];
const LOG_DIR = process.env.MCBOT_LOG_DIR || "/tmp";
const LOG_FILE = `${LOG_DIR}/mcbot-activity.log`;

function logActivity(entry: LogEntry) {
  activityLog.push(entry);
  if (activityLog.length > LOG_MAX) activityLog.shift();
  const line = `${entry.ts} [${entry.bot.padEnd(12)}] ${entry.ok ? "OK" : "ERR"} ${entry.command}${Object.keys(entry.params).length ? " " + JSON.stringify(entry.params) : ""} (${entry.durationMs}ms) ${entry.summary}\n`;
  try { appendFileSync(LOG_FILE, line); } catch {}
}

function summarizeResult(command: string, data: any): string {
  if (!data) return "";
  if (data.error) return `error: ${data.error}`;
  if (command === "spawn") return `spawned at ${data.x} ${data.y} ${data.z}`;
  if (command === "status") return `hp:${data.health} food:${data.food} pos:${data.position?.x},${data.position?.y},${data.position?.z}`;
  if (command === "execute") return data.success ? `ok (${data.durationMs}ms)` : `error: ${data.error}`;
  if (command === "queue") return `${data.queue?.length || 0} actions`;
  if (command === "state") return `pos:${data.position?.x},${data.position?.y},${data.position?.z} hp:${data.health}`;
  if (command === "skills") return `${data.skills?.length || 0} skills`;
  if (command === "load_skill") return data.skill?.name || "";
  if (command === "save_skill") return data.status || "";
  if (command === "goto") return data.status || "";
  if (command === "place") return data.placed ? `placed ${data.block}` : `failed: ${data.error}`;
  if (command === "kill" || command === "killall") return data.status;
  if (command === "list") return `${data.bots?.length || 0} bots`;
  if (command === "screenshot") return data.file || `${data.size || 0}x${data.size || 0} context`;
  if (command === "pov" || command === "render") return data.file || "";
  return data.status || data.message || "";
}

const bots = new Map<string, BotInstance>();
const connecting = new Set<string>(); // bots currently connecting
const lastCommandAt = new Map<string, number>(); // track last command time per bot
const PORT = Number(process.env.MCBOT_API_PORT) || 3847;

const PREFERRED_INGREDIENTS = new Set([
  "cobblestone", "oak_planks", "spruce_planks", "birch_planks",
  "jungle_planks", "acacia_planks", "dark_oak_planks", "stick",
  "iron_ingot", "gold_ingot", "diamond", "copper_ingot",
  "string", "redstone", "lapis_lazuli", "coal", "flint",
  "leather", "paper", "feather",
]);

const PROFILES_DIR = join(import.meta.dirname, "mcbots");
const TEMPLATE_DIR = join(PROFILES_DIR, "_template");

function ensureProfile(name: string) {
  const profileDir = join(PROFILES_DIR, name);
  if (existsSync(profileDir)) return;
  if (!existsSync(TEMPLATE_DIR)) return;
  mkdirSync(profileDir, { recursive: true });
  const soulTemplate = readFileSync(join(TEMPLATE_DIR, "SOUL.md"), "utf-8");
  writeFileSync(join(profileDir, "SOUL.md"), soulTemplate.replace(/\{\{NAME\}\}/g, name));
  const metaTemplate = JSON.parse(readFileSync(join(TEMPLATE_DIR, "metadata.json"), "utf-8"));
  metaTemplate.createdAt = new Date().toISOString();
  writeFileSync(join(profileDir, "metadata.json"), JSON.stringify(metaTemplate, null, 2) + "\n");
  console.log(`[mcbot] Created profile: ${profileDir}`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  const parts = url.pathname.slice(1).split("/").filter(Boolean);
  let params = Object.fromEntries(url.searchParams);

  // Parse POST body (JSON) and merge with query params
  if (req.method === "POST") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      params = { ...params, ...body };
    } catch {}
  }

  const json = (data: any, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  try {
    let result: any;
    const first = parts[0];
    if (!first) throw new Error("use /<command> or /<botName>/<command>");

    const t0 = Date.now();
    const fleetCommand = parts.length === 1 ? resolveCommand("fleet", first) : undefined;
    if (fleetCommand) {
      // logs endpoint — return activity log directly
      if (fleetCommand.name === "logs") {
        const botFilter = params.bot;
        const count = Math.min(Number(params.count) || 50, LOG_MAX);
        let entries = botFilter
          ? activityLog.filter(e => e.bot === botFilter)
          : activityLog;
        entries = entries.slice(-count);
        json({ entries, file: LOG_FILE });
        return;
      }
      const validationError = validateParams(fleetCommand, params);
      if (validationError) throw new Error(validationError);
      result = await runFleetCommand(fleetCommand, params);
      logActivity({
        ts: new Date().toISOString(),
        bot: params.name || "*",
        command: fleetCommand.name,
        params,
        ok: true,
        summary: summarizeResult(fleetCommand.name, result),
        durationMs: Date.now() - t0,
      });
    } else {
      const botName = first;
      const cmd = parts[1] || "status";
      const instance = bots.get(botName);
      if (!instance) throw new Error(`bot "${botName}" not found (disconnected or never spawned). active bots: [${[...bots.keys()].join(", ") || "none"}]`);
      const botCommand = resolveCommand("bot", cmd);
      if (!botCommand) throw new Error(formatCommandError("bot", cmd));
      const validationError = validateParams(botCommand, params);
      if (validationError) throw new Error(validationError);
      result = await runBotCommand(instance, botCommand, params);
      lastCommandAt.set(botName, Date.now());
      logActivity({
        ts: new Date().toISOString(),
        bot: botName,
        command: botCommand.name,
        params,
        ok: true,
        summary: summarizeResult(botCommand.name, result),
        durationMs: Date.now() - t0,
      });
    }

    json(result);
  } catch (err: any) {
    json({ error: err.message }, 500);
  }
});

server.timeout = 255_000;
server.listen(PORT, () => {
  console.log(`[mcbot] API server on http://localhost:${PORT}`);
});

// --- Meta commands ---

function spawnBot(name: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (bots.has(name) || connecting.has(name)) return reject(new Error(`bot "${name}" already exists`));

    connecting.add(name);
    const opts = {
      host: params.host || "localhost",
      port: Number(params.port) || 25565,
      username: name,
      version: params.version || "1.21.11",
    };

    const bot = mineflayer.createBot(opts);
    bot.loadPlugin(pathfinder.pathfinder);
    let knockbackUntil = 0;
    let pausedForKnockback = false;

    const releaseMovementControls = () => {
      for (const key of ["forward", "back", "left", "right", "jump", "sprint", "sneak"]) {
        bot.setControlState(key as any, false);
      }
    };

    const applyKnockbackWindow = (ms = 325) => {
      knockbackUntil = Math.max(knockbackUntil, Date.now() + ms);
      if (!pausedForKnockback) {
        pausedForKnockback = true;
        bot.pathfinder.stop();
      }
      releaseMovementControls();
    };

    bot.once("spawn", () => {
      connecting.delete(name);
      const mcData = require("minecraft-data")(bot.version);
      const movements = new pathfinder.Movements(bot, mcData);
      movements.allow1by1towers = true;   // pillar up to escape holes
      movements.allowParkour = true;
      movements.canDig = true;
      movements.scafoldingBlocks = [mcData.blocksByName.dirt?.id, mcData.blocksByName.cobblestone?.id, mcData.blocksByName.oak_planks?.id].filter(Boolean);
      bot.pathfinder.setMovements(movements);

      // Wrap goto to clear stale stopPathing flag from previous failed navigations.
      // mineflayer-pathfinder bug: calling bot.pathfinder.stop() sets stopPathing=true
      // but it only gets cleared when the physics loop runs. If goto() is called before
      // the next tick, it immediately fails. We use a patched resetStopFlag() to clear it.
      const _origGoto = bot.pathfinder.goto.bind(bot.pathfinder);
      bot.pathfinder.goto = (goal: any) => {
        bot.pathfinder.resetStopFlag();
        return _origGoto(goal);
      };

      const buildContext = (signal: AbortSignal): ExecuteContext => ({
        bot, mcData, pathfinder, Vec3,
        GoalNear, GoalFollow, GoalBlock: pathfinder.goals.GoalBlock,
        sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
        signal,
        log: () => {},
      });
      const actionQueue = new ActionQueue(buildContext);
      const instance: BotInstance = { bot, mcData, name, host: opts.host, port: opts.port, version: bot.version, chatInbox: [], directives: [], actionQueue };
      bots.set(name, instance);

      bot.on("chat", (username: string, message: string) => {
        if (username === name) return; // ignore self
        if (!username || username === "" || message.startsWith("[Server]")) return; // ignore server messages
        instance.chatInbox.push({ sender: username, message, ts: new Date().toISOString() });
        if (instance.chatInbox.length > 100) instance.chatInbox.shift();
      });

      // Keep bot knockback native-like by letting server velocity move it before resuming path input.
      bot.on("entityHurt", (entity: any) => {
        if (entity === bot.entity || entity?.id === bot.entity?.id) applyKnockbackWindow(350);
      });
      bot.on("physicsTick", () => {
        if (Date.now() < knockbackUntil) {
          releaseMovementControls();
          return;
        }
        pausedForKnockback = false;
      });
      bot._client?.on?.("entity_velocity", (packet: any) => {
        if (packet?.entityId === bot.entity?.id) applyKnockbackWindow(350);
      });

      try { ensureProfile(name); } catch {}
      console.log(`[mcbot] Spawned "${name}" on ${opts.host}:${opts.port} (${bot.version})`);
      resolve({ status: "spawned", name, ...posOf(bot) });
    });

    bot.once("error", (err: Error) => {
      connecting.delete(name);
      reject(err);
    });

    bot.on("kicked", (reason: string) => {
      connecting.delete(name);
      console.log(`[mcbot] "${name}" kicked: ${reason}`);
      logActivity({ ts: new Date().toISOString(), bot: name, command: "disconnect", params: { reason: "kicked" }, ok: false, summary: `kicked: ${reason}`, durationMs: 0 });
      bots.delete(name);
    });

    bot.on("end", (reason: string) => {
      connecting.delete(name);
      if (!bots.has(name)) return; // already cleaned up by kicked handler
      console.log(`[mcbot] "${name}" disconnected: ${reason || "unknown"}`);
      logActivity({ ts: new Date().toISOString(), bot: name, command: "disconnect", params: { reason: reason || "connection lost" }, ok: false, summary: `disconnected: ${reason || "connection lost"}`, durationMs: 0 });
      bots.delete(name);
    });

    bot.on("death", () => console.log(`[mcbot] "${name}" died`));
  });
}

function listBots() {
  const locks = getLocks();
  const lockMap = new Map(locks.map(l => [l.bot, l]));
  const entries = [...bots.entries()].map(([name, inst]) => {
    const lock = lockMap.get(name);
    return {
      name,
      status: "ready" as string,
      position: posOf(inst.bot),
      health: inst.bot.health,
      lastCommandAt: lastCommandAt.get(name) || null,
      lock: lock ? { pid: lock.pid, agent: lock.agent, goal: lock.goal, lockedAt: lock.lockedAt } : null,
    };
  });
  for (const name of connecting) {
    entries.push({ name, status: "connecting", position: { x: 0, y: 0, z: 0 }, health: 0, lastCommandAt: null, lock: null });
  }
  return { bots: entries };
}

function killBot(name: string) {
  const inst = bots.get(name);
  if (!inst) throw new Error(`no bot named "${name}"`);
  inst.bot.quit();
  bots.delete(name);
  return { status: "killed", name };
}

function killAllBots() {
  const names = [...bots.keys()];
  for (const [, inst] of bots) inst.bot.quit();
  bots.clear();
  return { status: "killed all", names };
}

function listToolCatalog(scope?: string) {
  const normalizedScope = scope === "fleet" || scope === "bot" ? scope : null;
  const specs = normalizedScope
    ? getCommands(normalizedScope)
    : [...getCommands("fleet"), ...getCommands("bot")];

  const tools = specs
    .filter((spec) => spec.name !== "tool")
    .map((spec) => ({
      scope: spec.scope,
      family: spec.family,
      command: spec.name,
      tool: spec.tool,
      usage: spec.usage,
      summary: spec.summary,
    }));

  return { tools };
}

async function runFleetCommand(spec: CommandSpec, params: Record<string, string>): Promise<any> {
  if (spec.name === "spawn") {
    const names = params.name!.split(",").map(n => n.trim()).filter(Boolean);
    if (names.length === 0) throw new Error("need name param");
    if (names.length === 1) return spawnBot(names[0]!, params);
    // Batch spawn: connect all concurrently
    const results = await Promise.allSettled(names.map(n => spawnBot(n, params)));
    const spawned: any[] = [];
    const errors: any[] = [];
    for (const [i, r] of results.entries()) {
      if (r.status === "fulfilled") {
        spawned.push(r.value);
      } else {
        errors.push({ name: names[i]!, error: r.reason?.message || String(r.reason) });
      }
    }
    return { status: "batch", spawned, errors, total: names.length };
  }
  if (spec.name === "list") return listBots();
  if (spec.name === "kill") return killBot(params.name!);
  if (spec.name === "killall") return killAllBots();
  if (spec.name === "ping") return { status: "ok", bots: [...bots.keys()], connecting: [...connecting] };
  if (spec.name === "camera") {
    const name = params.name!;
    const { x, y, z } = params;
    let result = await spawnBot(name, params);
    const inst = bots.get(name);
    if (inst) {
      await new Promise((r) => setTimeout(r, 1000));
      inst.bot.chat(`/tp ${name} ${x} ${y} ${z}`);
      await new Promise((r) => setTimeout(r, 1000));
      result = { status: "camera placed", name, position: posOf(inst.bot) };
    }
    return result;
  }
  if (spec.name === "profile") {
    const name = params.name;
    if (!name) throw new Error("need name param");
    const profileDir = join(PROFILES_DIR, name);
    const soulPath = join(profileDir, "SOUL.md");
    const metaPath = join(profileDir, "metadata.json");

    if (params.init === "true") {
      if (existsSync(profileDir)) throw new Error(`profile already exists: ${profileDir}`);
      ensureProfile(name);
      return { status: "created", path: profileDir };
    }

    if (params.memory) {
      if (!existsSync(metaPath)) throw new Error(`no profile for "${name}". create with --init`);
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      if (!Array.isArray(meta.memories)) meta.memories = [];
      meta.memories.push(params.memory);
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
      return { status: "memory added", total: meta.memories.length };
    }

    if (!existsSync(profileDir)) return { exists: false, name };
    const result: any = { exists: true, name };
    if (existsSync(soulPath)) result.soul = readFileSync(soulPath, "utf-8");
    if (existsSync(metaPath)) result.metadata = JSON.parse(readFileSync(metaPath, "utf-8"));
    return result;
  }
  if (spec.name === "tools") return listToolCatalog(params.scope);
  if (spec.name === "locks") return { locks: getLocks() };
  if (spec.name === "lock") {
    const bot = params.name;
    if (!bot) throw new Error("need name param");
    const lock = acquireLock(bot, {
      pid: process.pid,
      agent: params.agent || "cli",
      goal: params.goal || "",
    });
    if (!lock) {
      const existing = isLocked(bot);
      throw new Error(`bot "${bot}" is locked by pid ${existing?.pid} (${existing?.agent || "unknown"})`);
    }
    return { status: "locked", lock };
  }
  if (spec.name === "unlock") {
    const bot = params.name;
    if (!bot) throw new Error("need name param");
    const released = releaseLock(bot);
    return { status: released ? "unlocked" : "not locked", bot };
  }
  if (spec.name === "tool") {
    const target = findByTool("fleet", params.tool || "");
    if (!target || target.name === "tool") {
      throw new Error(`unknown fleet tool: ${params.tool}`);
    }

    const nextParams = { ...params };
    delete nextParams.tool;
    const validationError = validateParams(target, nextParams);
    if (validationError) throw new Error(validationError);
    const result = await runFleetCommand(target, nextParams);
    return { tool: target.tool, command: target.name, result };
  }

  throw new Error(formatCommandError("fleet", spec.name));
}

async function runBotCommand(instance: BotInstance, spec: CommandSpec, params: Record<string, string>): Promise<any> {
  if (spec.name === "tool") {
    const target = findByTool("bot", params.tool || "");
    if (!target || target.name === "tool") {
      throw new Error(`unknown bot tool: ${params.tool}`);
    }

    const nextParams = { ...params };
    delete nextParams.tool;
    const validationError = validateParams(target, nextParams);
    if (validationError) throw new Error(validationError);
    const result = await handleCommand(instance, target.name, nextParams);
    return { tool: target.tool, command: target.name, result };
  }

  return handleCommand(instance, spec.name, params);
}

// --- Bot commands ---

async function handleCommand(instance: BotInstance, cmd: string, params: any): Promise<any> {
  const { bot } = instance;

  if (cmd === "status") return getStatus(bot, instance.mcData);
  if (cmd === "look") return getLook(bot);
  if (cmd === "inventory") return getInventory(bot);
  if (cmd === "block") {
    const { x, y, z } = params;
    if (!x || !y || !z) return { error: "need x, y, z params" };
    const block = bot.blockAt(new Vec3(Number(x), Number(y), Number(z)));
    if (!block) return { error: "unloaded chunk" };
    return {
      name: block.name,
      type: block.type,
      metadata: block.metadata,
      hardness: block.hardness,
      diggable: block.diggable,
      position: { x: block.position.x, y: block.position.y, z: block.position.z },
      boundingBox: block.boundingBox,
    };
  }
  if (cmd === "recipes") {
    const mcData = instance.mcData;
    const itemName = params.item;
    if (!itemName) return { error: "need item param" };
    const item = mcData.itemsByName[itemName];
    if (!item) return { error: `unknown item "${itemName}"` };
    const withoutTable = bot.recipesFor(item.id, null, 1, null);
    const table = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 32 });
    const withTable = table ? bot.recipesFor(item.id, null, 1, table) : [];
    const recipes = withoutTable.length > 0 ? withoutTable : withTable;

    // Also check all possible recipes (ignoring inventory) for ingredient info
    const allRecipes = mcData.recipes[item.id];

    if (recipes.length === 0) {
      // Show required ingredients from recipe data even when uncraftable
      if (allRecipes && allRecipes.length > 0) {
        const r = pickBestRecipe(allRecipes, mcData);
        const ingredients: Record<string, number> = {};
        const inputs = r.inShape ? r.inShape.flat() : r.ingredients || [];
        for (const ing of inputs) {
          if (!ing) continue;
          const id = typeof ing === "object" ? ing.id : ing;
          if (id < 0) continue;
          const ingName = mcData.items[id]?.name || `id:${id}`;
          ingredients[ingName] = (ingredients[ingName] || 0) + 1;
        }
        return {
          item: itemName,
          craftable: false,
          needsTable: !r.inShape || (r.inShape.length <= 2 && r.inShape[0]?.length <= 2) ? false : true,
          ingredients,
          reason: "missing ingredients or no crafting table",
        };
      }
      return { item: itemName, craftable: false, reason: "no recipe exists" };
    }

    const recipe = recipes[0];
    const ingredients: Record<string, number> = {};
    for (const row of recipe.delta) {
      if (row.count < 0) {
        const ingName = mcData.items[row.id]?.name || `id:${row.id}`;
        ingredients[ingName] = (ingredients[ingName] || 0) + Math.abs(row.count);
      }
    }
    return {
      item: itemName,
      craftable: true,
      needsTable: withoutTable.length === 0,
      ingredients,
    };
  }

  if (cmd === "execute") {
    const code = params.code;
    if (!code) return { error: "need code param (POST JSON body with {code, name?, timeout?})" };
    const name = params.name || "anonymous";
    const timeout = Number(params.timeout) || 60_000;
    const action = instance.actionQueue.push(name, code, timeout);
    return action;
  }
  if (cmd === "queue") {
    if (params.cancel === "current") {
      const cancelled = instance.actionQueue.cancelCurrent();
      return { status: cancelled ? "cancelled current" : "nothing running" };
    }
    if (params.cancel === "all") {
      const count = instance.actionQueue.clear();
      return { status: `cancelled ${count} actions` };
    }
    if (params.cancel) {
      const cancelled = instance.actionQueue.cancel(params.cancel);
      return { status: cancelled ? `cancelled ${params.cancel}` : `action ${params.cancel} not found or already finished` };
    }
    return { queue: instance.actionQueue.getState(), current: instance.actionQueue.getCurrent() };
  }
  if (cmd === "state") {
    const p = bot.entity.position;
    const v = bot.entity.velocity;
    const current = instance.actionQueue.getCurrent();
    const pending = instance.actionQueue.getState().filter((a: any) => a.status === "pending").length;
    return {
      position: posOf(bot),
      velocity: { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) },
      health: bot.health,
      food: bot.food,
      yaw: +bot.entity.yaw.toFixed(2),
      onGround: bot.entity.onGround,
      isCollidedHorizontally: bot.entity.isCollidedHorizontally,
      biome: (() => {
        const block = bot.blockAt(p);
        if (!block?.biome) return "unknown";
        const b = block.biome;
        const id = typeof b === "object" ? b.id : b;
        return instance.mcData.biomes?.[id]?.name || `biome:${id}`;
      })(),
      time: bot.time.isDay ? "day" : "night",
      currentAction: current ? { id: current.id, name: current.name, status: current.status } : null,
      queueLength: pending,
      inboxCount: instance.chatInbox.length,
      directiveCount: instance.directives.length,
    };
  }
  if (cmd === "skills") {
    return { skills: listSkills() };
  }
  if (cmd === "load_skill") {
    const name = params.name;
    if (!name) return { error: "need name param" };
    const skill = loadSkill(name);
    if (!skill) return { error: `skill "${name}" not found` };
    return { skill: skill.meta, code: skill.code };
  }
  if (cmd === "save_skill") {
    const name = params.name;
    const code = params.code;
    if (!name || !code) return { error: "need name and code params (POST JSON body)" };
    saveSkill(name, code, { description: params.description || "" });
    return { status: "saved", name };
  }
  if (cmd === "place") {
    let { x, y, z } = params;
    if (params.dir) {
      const pos = resolveRelativePos(bot, params.dir);
      if (!pos) return { error: `unknown direction "${params.dir}". use: front/back/left/right/up/down` };
      x = String(pos.x); y = String(pos.y); z = String(pos.z);
    }
    if (!x || !y || !z) return { error: "need x,y,z or --dir front/back/left/right/up/down" };
    const blockName = params.block || "cobblestone";
    const item = bot.inventory.items().find((i: any) => i.name === blockName);
    if (!item) return { error: `no ${blockName} in inventory` };
    const targetPos = new Vec3(Number(x), Number(y), Number(z));
    try {
      await withTimeout(bot.pathfinder.goto(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 4)), 15000);
    } catch (err: any) {
      bot.pathfinder.stop();
      return { error: `can't reach target: ${err.message}` };
    }
    await bot.equip(item, "hand");
    const refBlock = bot.blockAt(targetPos.offset(0, -1, 0)) || bot.blockAt(targetPos.offset(0, 0, -1));
    if (!refBlock) return { error: "no reference block to place against" };
    const faceVec = targetPos.minus(refBlock.position);
    try {
      await bot.placeBlock(refBlock, faceVec);
      return { placed: true, block: blockName, position: { x: targetPos.x, y: targetPos.y, z: targetPos.z } };
    } catch (err: any) {
      return { placed: false, error: err.message };
    }
  }
  if (cmd === "goto") {
    const { x, y, z } = params;
    if (!x || !y || !z) return { error: "need x, y, z params" };
    const goal = new GoalNear(Number(x), Number(y), Number(z), 2);
    const pathListener = (results: any) => {
      console.log(`[GOTO-DEBUG] path_update: status=${results.status} pathLen=${results.path?.length}`);
    };
    bot.on("path_update", pathListener);
    try {
      console.log(`[GOTO-DEBUG] starting goto to ${x},${y},${z}`);
      await withTimeout(bot.pathfinder.goto(goal), 30000);
    } catch (err: any) {
      console.log(`[GOTO-DEBUG] error: ${err.name}: ${err.message}`);
      bot.pathfinder.stop();
      return { error: `navigation failed: ${err.message}`, position: posOf(bot) };
    } finally {
      bot.removeListener("path_update", pathListener);
    }
    return { status: "arrived", position: posOf(bot) };
  }
  if (cmd === "follow") {
    const target = bot.players[params.player]?.entity;
    if (!target) return { error: `player "${params.player}" not found` };
    bot.pathfinder.setGoal(new GoalFollow(target, 3), true);
    return { status: `following ${params.player}` };
  }
  if (cmd === "stop") {
    bot.pathfinder.stop();
    return { status: "stopped" };
  }
  if (cmd === "chat") {
    const msg = (params.message || "").replace(/\\([!@#$?])/g, "$1");
    bot.chat(msg);
    return { status: "sent" };
  }
  if (cmd === "attack") {
    const targetName = params.target;
    const entities = Object.values(bot.entities) as any[];
    if (targetName) {
      // PvP: attack a specific player by name
      const player = entities
        .filter((e: any) => e.type === "player" && e.username?.toLowerCase() === targetName.toLowerCase())
        .sort((a: any, b: any) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
      if (!player) return { error: `player ${targetName} not found nearby` };
      const dist = player.position.distanceTo(bot.entity.position);
      if (dist > 3.6) return { error: `${targetName} is ${dist.toFixed(1)}m away, need to be within 3.6 blocks` };
      await vanillaMeleeAttack(bot, player);
      return { status: `attacked player ${player.username} (${dist.toFixed(1)}m)` };
    }
    const hostile = entities
      .filter((e: any) => e.type === "hostile" && e.position.distanceTo(bot.entity.position) < 5)
      .sort((a: any, b: any) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
    if (!hostile) return { error: "no hostile mobs within 5 blocks" };
    await vanillaMeleeAttack(bot, hostile);
    return { status: `attacked ${hostile.name}` };
  }
  if (cmd === "dig") {
    const { x, y, z } = params;
    if (!x || !y || !z) return { error: "need x, y, z params" };
    const target = bot.blockAt(new Vec3(Number(x), Number(y), Number(z)));
    if (!target || target.name === "air") return { error: "no block there" };
    await bot.dig(target);
    return { status: `dug ${target.name}` };
  }
  if (cmd === "drop") {
    const item = bot.inventory.items().find((i: any) => i.name === params.item);
    if (!item) return { error: `no ${params.item} in inventory` };
    await bot.tossStack(item);
    return { status: `dropped ${item.name} x${item.count}` };
  }
  if (cmd === "equip") {
    const item = bot.inventory.items().find((i: any) => i.name === params.item);
    if (!item) return { error: `no ${params.item} in inventory` };
    await bot.equip(item, params.slot || "hand");
    return { status: `equipped ${item.name}` };
  }
  if (cmd === "survey") {
    const radius = Number(params.radius) || 64;
    const mcData = instance.mcData;

    // Find logs
    const logIds = Object.values(mcData.blocksByName)
      .filter((b: any) => b.name.includes("log"))
      .map((b: any) => b.id);
    const logs = bot.findBlocks({ matching: logIds, maxDistance: radius, count: 1000 });

    // Find water
    const waterId = mcData.blocksByName.water?.id;
    const water = waterId ? bot.findBlocks({ matching: waterId, maxDistance: radius, count: 1000 }) : [];

    // Find lava
    const lavaId = mcData.blocksByName.lava?.id;
    const lava = lavaId ? bot.findBlocks({ matching: lavaId, maxDistance: radius, count: 1000 }) : [];

    // Find ores
    const oreIds = Object.values(mcData.blocksByName)
      .filter((b: any) => b.name.includes("ore"))
      .map((b: any) => b.id);
    const ores = bot.findBlocks({ matching: oreIds, maxDistance: radius, count: 1000 });
    // Count ore types
    const oreCounts: Record<string, number> = {};
    for (const pos of ores) {
      const block = bot.blockAt(pos);
      if (block) oreCounts[block.name] = (oreCounts[block.name] || 0) + 1;
    }

    // Nearest positions
    const p = bot.entity.position;
    const nearest = (positions: any[]) => {
      if (positions.length === 0) return null;
      const sorted = positions.sort((a: any, b: any) => a.distanceTo(p) - b.distanceTo(p));
      const pos = sorted[0];
      return { x: pos.x, y: pos.y, z: pos.z };
    };

    const nearestOre: Record<string, { x: number; y: number; z: number }> = {};
    for (const pos of ores) {
      const block = bot.blockAt(pos);
      if (block && !nearestOre[block.name]) {
        nearestOre[block.name] = { x: pos.x, y: pos.y, z: pos.z };
      }
    }

    // Count nearby entities
    const entities = Object.values(bot.entities) as any[];
    const nearby = entities.filter((e: any) => e !== bot.entity && e.position.distanceTo(p) < radius);
    const players = nearby.filter((e: any) => e.type === "player").map((e: any) => e.username || e.name);
    const hostiles = nearby.filter((e: any) => e.type === "hostile").length;
    const animals = nearby.filter((e: any) => e.type === "animal").length;

    return {
      position: posOf(bot),
      radius,
      blocks: { logs: logs.length, water: water.length, lava: lava.length, ores: oreCounts },
      nearest: {
        log: nearest(logs),
        water: nearest(water),
        lava: nearest(lava),
        ores: nearestOre,
      },
      entities: { players, hostiles, animals },
    };
  }
  if (cmd === "inbox") {
    const messages = [...instance.chatInbox];
    instance.chatInbox.length = 0;
    return { messages, count: messages.length };
  }
  if (cmd === "direct") {
    const text = params.message;
    if (!text) return { error: "need message param" };
    const interrupt = params.interrupt === "true" || params.interrupt === true;
    instance.directives.push({ text, ts: new Date().toISOString(), interrupt });
    if (instance.directives.length > 50) instance.directives.shift();
    if (interrupt) {
      bot.pathfinder.stop();
      bot.stopDigging?.();
    }
    return { status: interrupt ? "directive posted + interrupted current action" : "directive posted", pending: instance.directives.length };
  }
  if (cmd === "directives") {
    const peek = params.peek === "true" || params.peek === true;
    const clear = params.clear === "true" || params.clear === true;
    if (clear) {
      const cleared = instance.directives.length;
      instance.directives.length = 0;
      return { status: "directives cleared", cleared };
    }
    const items = [...instance.directives];
    if (!peek) instance.directives.length = 0;
    return { directives: items, count: items.length, peeked: peek };
  }
  if (cmd === "give") {
    const player = params.player;
    if (!player) return { error: "need player param" };
    const target = bot.players[player]?.entity;
    if (!target) return { error: `player "${player}" not found or not nearby` };
    const itemName = params.item;
    const items = bot.inventory.items().filter((i: any) => itemName ? i.name === itemName : i.name.includes("log"));
    if (items.length === 0) return { error: `no ${itemName || "logs"} in inventory` };
    try {
      await withTimeout(bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 2)), 15000);
    } catch (err: any) {
      bot.pathfinder.stop();
      return { error: `can't reach ${params.player}: ${err.message}` };
    }
    const given = [];
    for (const item of items) {
      await bot.tossStack(item);
      given.push({ name: item.name, count: item.count });
    }
    return { status: `gave items to ${player}`, items: given };
  }

  if (cmd === "screenshot") {
    // Kept command name for compatibility, but output is now lightweight text context (no PNG).
    const requestedSize = Number(params.size || params.radius) || 16;
    return buildTokenContext(bot, requestedSize);
  }
  if (cmd === "pov") {
    const width = Number(params.width) || 160;
    const height = Number(params.height) || 90;
    const fov = Number(params.fov) || 80;
    const maxDist = Number(params.distance) || 64;
    const scale = Number(params.scale) || 4;
    const p = bot.entity.position.offset(0, 1.62, 0);
    const yaw = bot.entity.yaw;
    const pitch = bot.entity.pitch;

    // Richer Minecraft-accurate colors
    const colorFor = (name: string): [number, number, number] => {
      if (name.includes("oak_log")) return [109, 85, 50];
      if (name.includes("birch_log")) return [216, 206, 189];
      if (name.includes("spruce_log")) return [58, 37, 16];
      if (name.includes("jungle_log")) return [149, 109, 52];
      if (name.includes("dark_oak_log")) return [60, 46, 26];
      if (name.includes("acacia_log")) return [103, 96, 86];
      if (name.includes("log")) return [109, 85, 50];
      if (name.includes("oak_leaves")) return [59, 122, 24];
      if (name.includes("birch_leaves")) return [80, 140, 47];
      if (name.includes("spruce_leaves")) return [37, 72, 37];
      if (name.includes("jungle_leaves")) return [42, 132, 12];
      if (name.includes("dark_oak_leaves")) return [30, 90, 15];
      if (name.includes("azalea_leaves")) return [72, 130, 35];
      if (name.includes("leaves")) return [55, 120, 30];
      if (name === "water" || name === "flowing_water") return [44, 100, 201];
      if (name === "lava" || name === "flowing_lava") return [207, 92, 15];
      if (name === "grass_block") return [106, 170, 64];
      if (name === "dirt" || name === "coarse_dirt") return [134, 96, 67];
      if (name === "podzol") return [91, 63, 24];
      if (name === "mycelium") return [111, 99, 107];
      if (name === "sand") return [219, 207, 163];
      if (name === "red_sand") return [190, 102, 33];
      if (name === "stone") return [125, 125, 125];
      if (name === "cobblestone") return [118, 118, 118];
      if (name === "mossy_cobblestone") return [100, 118, 95];
      if (name === "deepslate") return [80, 80, 85];
      if (name === "granite") return [149, 103, 85];
      if (name === "diorite") return [188, 182, 183];
      if (name === "andesite") return [136, 136, 136];
      if (name === "coal_ore") return [105, 105, 105];
      if (name === "iron_ore") return [136, 120, 108];
      if (name === "gold_ore") return [143, 140, 92];
      if (name === "diamond_ore") return [93, 213, 209];
      if (name === "copper_ore") return [124, 125, 100];
      if (name === "lapis_ore") return [60, 80, 165];
      if (name.includes("ore")) return [140, 130, 100];
      if (name === "gravel") return [131, 127, 126];
      if (name === "snow" || name === "snow_block") return [249, 254, 254];
      if (name === "ice" || name === "packed_ice") return [145, 183, 253];
      if (name.includes("plank")) return [162, 130, 78];
      if (name.includes("glass")) return [200, 220, 230];
      if (name.includes("wool")) return [234, 234, 234];
      if (name === "clay") return [159, 164, 177];
      if (name === "bedrock") return [85, 85, 85];
      if (name.includes("flower") || name.includes("poppy") || name.includes("dandelion")) return [200, 50, 50];
      if (name === "tall_grass" || name === "grass" || name === "fern") return [90, 155, 50];
      return [120, 110, 100];
    };

    // Sun direction (from upper-right, like Minecraft)
    const sunDir = { x: 0.5, y: 0.85, z: 0.3 };
    const sunLen = Math.sqrt(sunDir.x ** 2 + sunDir.y ** 2 + sunDir.z ** 2);
    sunDir.x /= sunLen; sunDir.y /= sunLen; sunDir.z /= sunLen;

    const fovRad = (fov * Math.PI) / 180;
    const aspectRatio = width / height;
    const imgW = width * scale;
    const imgH = height * scale;
    const pixels = Buffer.alloc(imgW * imgH * 3);

    // Sky gradient
    const skyTop: [number, number, number] = [100, 160, 235];
    const skyBottom: [number, number, number] = [170, 210, 250];

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const ndcX = (px / width) * 2 - 1;
        const ndcY = (py / height) * 2 - 1;

        const rayYaw = yaw - ndcX * (fovRad / 2) * aspectRatio;
        const rayPitch = pitch + ndcY * (fovRad / 2);

        const dx = -Math.sin(rayYaw) * Math.cos(rayPitch);
        const dy = -Math.sin(rayPitch);
        const dz = -Math.cos(rayYaw) * Math.cos(rayPitch);

        // Sky gradient based on vertical angle
        const skyT = Math.max(0, Math.min(1, (ndcY + 1) / 2));
        let color: [number, number, number] = [
          lerp(skyTop[0], skyBottom[0], skyT),
          lerp(skyTop[1], skyBottom[1], skyT),
          lerp(skyTop[2], skyBottom[2], skyT),
        ];

        // DDA ray marching for precise face detection
        const step = 0.3;
        let prevBx = -999, prevBy = -999, prevBz = -999;
        for (let t = 0.5; t < maxDist; t += step) {
          const bx = Math.floor(p.x + dx * t);
          const by = Math.floor(p.y + dy * t);
          const bz = Math.floor(p.z + dz * t);

          // Skip if same block
          if (bx === prevBx && by === prevBy && bz === prevBz) continue;
          prevBx = bx; prevBy = by; prevBz = bz;

          const block = bot.blockAt(new Vec3(bx, by, bz));
          if (block && block.name !== "air" && block.name !== "cave_air") {
            const base = colorFor(block.name);

            // Determine which face was hit based on ray entry
            const hitX = p.x + dx * t - bx;
            const hitY = p.y + dy * t - by;
            const hitZ = p.z + dz * t - bz;

            // Face normal based on entry side
            let faceBright = 0.8; // default side
            const eps = 0.05;
            if (hitY > 1 - eps && dy < 0) faceBright = 1.0;       // top face (brightest)
            else if (hitY < eps && dy > 0) faceBright = 0.5;       // bottom face (darkest)
            else if (hitX < eps || hitX > 1 - eps) faceBright = 0.7; // east/west
            else if (hitZ < eps || hitZ > 1 - eps) faceBright = 0.85; // north/south

            // Distance fog — blend toward sky
            const fogAmount = Math.pow(t / maxDist, 1.5);
            const fogColor = color; // current sky color for this pixel

            const r = base[0] * faceBright;
            const g = base[1] * faceBright;
            const b2 = base[2] * faceBright;

            color = [
              lerp(r, fogColor[0], fogAmount),
              lerp(g, fogColor[1], fogAmount),
              lerp(b2, fogColor[2], fogAmount),
            ];
            break;
          }
        }

        // Write scaled pixels
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const offset = ((py * scale + sy) * imgW + (px * scale + sx)) * 3;
            pixels[offset] = Math.floor(color[0]);
            pixels[offset + 1] = Math.floor(color[1]);
            pixels[offset + 2] = Math.floor(color[2]);
          }
        }
      }
    }

    const file = `/tmp/mcbot-${instance.name}-pov-${Date.now()}.png`;
    await sharp(pixels, { raw: { width: imgW, height: imgH, channels: 3 } })
      .png()
      .toFile(file);

    return { file };
  }
  if (cmd === "map") {
    const radius = Number(params.radius) || 32;
    const p = bot.entity.position;
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);

    // Block type to character mapping
    const charFor = (name: string) => {
      if (name.includes("log")) return "T";
      if (name.includes("leaves")) return "*";
      if (name === "water" || name === "flowing_water") return "~";
      if (name === "lava" || name === "flowing_lava") return "!";
      if (name.includes("ore")) return "o";
      if (name === "grass_block" || name === "dirt" || name === "podzol" || name === "mycelium") return ".";
      if (name === "sand" || name === "red_sand") return ":";
      if (name === "stone" || name === "deepslate" || name === "cobblestone") return "#";
      if (name === "gravel") return "%";
      if (name.includes("plank") || name.includes("fence") || name.includes("door")) return "=";
      if (name === "air" || name === "cave_air") return " ";
      return "-";
    };

    // Build top-down map by finding surface block at each x,z
    const rows: string[] = [];
    const entities = Object.values(bot.entities) as any[];

    // Header with coordinates
    rows.push(`MAP (${cx}, ${cz}) radius=${radius}  N=up`);
    rows.push(`Legend: T=tree *=leaves ~=water !=lava o=ore .=grass #=stone @=entity B=BOT`);
    rows.push("");

    for (let dz = -radius; dz <= radius; dz += 2) {
      let row = "";
      for (let dx = -radius; dx <= radius; dx += 2) {
        const x = cx + dx;
        const z = cz + dz;

        // Check if any entity is here
        const entityHere = entities.find((e: any) =>
          e !== bot.entity &&
          Math.abs(Math.floor(e.position.x) - x) < 2 &&
          Math.abs(Math.floor(e.position.z) - z) < 2
        );
        if (dx === 0 && dz === 0) {
          row += "B";
          continue;
        }
        if (entityHere) {
          row += "@";
          continue;
        }

        // Find surface block (scan down from sky)
        let ch = " ";
        for (let y = Math.min(Math.floor(p.y) + 20, 319); y >= Math.max(Math.floor(p.y) - 20, -64); y--) {
          const block = bot.blockAt(new Vec3(x, y, z));
          if (block && block.name !== "air" && block.name !== "cave_air") {
            ch = charFor(block.name);
            break;
          }
        }
        row += ch;
      }
      rows.push(row);
    }

    return { map: rows.join("\n") };
  }
  if (cmd === "render") {
    const p = bot.entity.position;
    const file = `/tmp/mcbot-${instance.name}-render-${Date.now()}.png`;

    const { stdout } = await execFileAsync("node", [
      `${import.meta.dirname}/render.cjs`,
      instance.host, String(instance.port), instance.version,
      String(p.x), String(p.y + 1.62), String(p.z),
      String(bot.entity.yaw), String(bot.entity.pitch),
      file,
    ], { timeout: 55000 });

    return { file: stdout.trim() };
  }

  return { error: `unknown command: ${cmd}` };
}

// --- Helpers ---

const DIRECTIONS: Record<string, [number, number, number]> = {
  front: [0, 0, -1], back: [0, 0, 1],
  left: [1, 0, 0], right: [-1, 0, 0],
  up: [0, 1, 0], down: [0, -1, 0],
};

function resolveRelativePos(bot: any, dir: string): { x: number; y: number; z: number } | null {
  const d = DIRECTIONS[dir];
  if (!d) return null;
  const p = bot.entity.position;
  const yaw = bot.entity.yaw;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // Rotate the direction vector by the bot's yaw
  const rx = Math.round(d[0] * cos - d[2] * sin);
  const rz = Math.round(d[0] * sin + d[2] * cos);
  return {
    x: Math.floor(p.x) + rx,
    y: Math.floor(p.y) + d[1],
    z: Math.floor(p.z) + rz,
  };
}

function posOf(bot: any) {
  const p = bot.entity.position;
  return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) };
}

function getStatus(bot: any, mcData: any) {
  let biome = "unknown";
  const block = bot.blockAt(bot.entity.position);
  if (block?.biome) {
    const b = block.biome;
    // block.biome can be an object with id/name or a numeric id
    const id = typeof b === "object" ? b.id : b;
    const lookup = mcData.biomes?.[id];
    biome = lookup?.name || (typeof b === "object" && b.name) || `biome:${id}`;
  }
  return {
    position: posOf(bot),
    health: bot.health,
    food: bot.food,
    time: bot.time.isDay ? "day" : "night",
    biome,
  };
}

function getLook(bot: any) {
  const p = bot.entity.position;
  const entities = Object.values(bot.entities) as any[];
  const nearby = entities
    .filter((e: any) => e !== bot.entity && e.position.distanceTo(p) < 20)
    .sort((a: any, b: any) => a.position.distanceTo(p) - b.position.distanceTo(p))
    .slice(0, 10)
    .map((e: any) => ({
      name: e.username || e.name || e.type,
      type: e.type,
      distance: +e.position.distanceTo(p).toFixed(1),
    }));

  const blockAt = bot.blockAtCursor(5);
  return {
    position: posOf(bot),
    lookingAt: blockAt ? blockAt.name : null,
    standingOn: bot.blockAt(p.offset(0, -1, 0))?.name || null,
    nearby,
  };
}

function getInventory(bot: any) {
  return bot.inventory.items().map((i: any) => ({
    name: i.name,
    count: i.count,
    slot: i.slot,
  }));
}

function buildTokenContext(bot: any, requestedSize: number) {
  const p = bot.entity.position;
  const cx = Math.floor(p.x);
  const cy = Math.floor(p.y);
  const cz = Math.floor(p.z);

  const size = Math.max(8, Math.min(32, Math.floor(requestedSize)));
  const half = Math.floor(size / 2);
  const topY = Math.min(cy + 10, 319);
  const bottomY = Math.max(cy - 10, -64);
  const entities = Object.values(bot.entities) as any[];

  const charFor = (name: string): string => {
    if (name.includes("log")) return "T";
    if (name.includes("leaves")) return "*";
    if (name === "water" || name === "flowing_water") return "~";
    if (name === "lava" || name === "flowing_lava") return "!";
    if (name.includes("ore")) return "o";
    if (name === "grass_block" || name === "dirt" || name === "podzol" || name === "mycelium") return ".";
    if (name === "sand" || name === "red_sand") return ":";
    if (name === "stone" || name === "deepslate" || name === "cobblestone") return "#";
    if (name === "gravel") return "%";
    if (name.includes("plank") || name.includes("fence") || name.includes("door")) return "=";
    if (name === "air" || name === "cave_air") return " ";
    return "-";
  };

  const rows: string[] = [];
  for (let dz = -half; dz < size - half; dz++) {
    let row = "";
    for (let dx = -half; dx < size - half; dx++) {
      if (dx === 0 && dz === 0) {
        row += "B";
        continue;
      }

      const x = cx + dx;
      const z = cz + dz;
      const entityHere = entities.find((e: any) =>
        e !== bot.entity &&
        Math.floor(e.position.x) === x &&
        Math.floor(e.position.z) === z
      );
      if (entityHere) {
        if (entityHere.type === "player") row += "P";
        else if (entityHere.type === "hostile") row += "H";
        else row += "@";
        continue;
      }

      let ch = " ";
      for (let y = topY; y >= bottomY; y--) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (block && block.name !== "air" && block.name !== "cave_air") {
          ch = charFor(block.name);
          break;
        }
      }
      row += ch;
    }
    rows.push(row);
  }

  return {
    mode: "text-context",
    center: { x: cx, y: cy, z: cz },
    size,
    legend: "B=bot P=player H=hostile @=entity T=log *=leaves ~=water !=lava o=ore .=soil #=stone-like :=sand %=gravel ==manmade",
    context: rows.join("\n"),
  };
}

function pickBestRecipe(allRecipes: any[], mcData: any): any {
  if (!allRecipes || allRecipes.length <= 1) return allRecipes?.[0] ?? null;

  let bestRecipe = allRecipes[0];
  let bestScore = -1;

  for (const r of allRecipes) {
    const inputs = r.inShape ? r.inShape.flat() : r.ingredients || [];
    let score = 0;
    for (const ing of inputs) {
      if (!ing) continue;
      const id = typeof ing === "object" ? ing.id : ing;
      if (id < 0) continue;
      const name = mcData.items[id]?.name;
      if (name && PREFERRED_INGREDIENTS.has(name)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRecipe = r;
    }
  }

  return bestRecipe;
}
