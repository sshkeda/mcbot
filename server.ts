import { createServer } from "node:http";
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "node:net";

const require = createRequire(import.meta.url);
const mineflayer = require("mineflayer");
const pathfinder = require("mineflayer-pathfinder");
const Vec3 = require("vec3").Vec3;
import { ActionQueue } from "./lib/action-queue";
import { type ExecuteContext } from "./lib/executor";
import { acquireLock, releaseLock, getLocks, isLocked } from "./lib/locks";
import { writeServerInfo, removeServerInfo } from "./lib/server-lifecycle";
import { runGoto, type GotoOptions } from "./lib/navigation";
import { addMemory, readAllMemories } from "./lib/memories";
import {
  findByTool,
  formatCommandError,
  getCommands,
  resolveCommand,
  validateParams,
  type CommandSpec,
} from "./lib/commands";
import { type BotInstance, posOf, GoalNear } from "./commands/_helpers";
import { handlers } from "./commands";

// ── Activity log ────────────────────────────────────────────────────
interface LogEntry {
  ts: string;
  traceId: string;
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

function newTraceId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function logActivity(entry: LogEntry) {
  activityLog.push(entry);
  if (activityLog.length > LOG_MAX) activityLog.shift();
  const line = `${entry.ts} ${entry.traceId} [${entry.bot.padEnd(12)}] ${entry.ok ? "OK" : "ERR"} ${entry.command}${Object.keys(entry.params).length ? " " + JSON.stringify(entry.params) : ""} (${entry.durationMs}ms) ${entry.summary}\n`;
  try { appendFileSync(LOG_FILE, line); } catch {}
}

// ── Preflight check ─────────────────────────────────────────────────

/** Quick TCP handshake to verify the Minecraft server is reachable. */
function checkReachable(host: string, port: number, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`connection to ${host}:${port} timed out after ${timeoutMs}ms — is the Minecraft server running?`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once("error", (err: any) => {
      clearTimeout(timer);
      socket.destroy();
      const code = err.code || "";
      reject(new Error(`cannot reach ${host}:${port} (${code}) — is the Minecraft server running?`));
    });
  });
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
  if (command === "render") return data.file || "";
  return data.status || data.message || "";
}

const bots = new Map<string, BotInstance>();
const connecting = new Set<string>(); // bots currently connecting
const lastCommandAt = new Map<string, number>(); // track last command time per bot
const PORT = Number(process.env.MCBOT_API_PORT) || 3847;

const AGENTS_DIR = join(import.meta.dirname, "agents");
const TEMPLATE_DIR = join(AGENTS_DIR, "_template");


function ensureAgent(name: string) {
  const agentDir = join(AGENTS_DIR, name);
  if (existsSync(agentDir)) return;
  if (!existsSync(TEMPLATE_DIR)) return;
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(agentDir, "memories"), { recursive: true });
  const soulTemplate = readFileSync(join(TEMPLATE_DIR, "SOUL.md"), "utf-8");
  writeFileSync(join(agentDir, "SOUL.md"), soulTemplate.replace(/\{\{NAME\}\}/g, name));
  const configTemplate = join(TEMPLATE_DIR, "agent.config.ts");
  if (existsSync(configTemplate)) {
    writeFileSync(join(agentDir, "agent.config.ts"), readFileSync(configTemplate, "utf-8"));
  }
  console.log(`[mcbot] Created agent: ${agentDir}`);
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

  const t0 = Date.now();
  const traceId = newTraceId();

  try {
    let result: any;
    const first = parts[0];
    if (!first) throw new Error("use /<command> or /<botName>/<command>");

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
        traceId,
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
        traceId,
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
    // Structured error: preserve socket/connection details
    const errMsg = err.message || err.code || "unknown error";
    const body: Record<string, any> = { error: errMsg };
    if (err.code) body.code = err.code;
    if (err.address !== undefined) body.address = err.address;
    if (err.port !== undefined) body.port = err.port;
    if (err.syscall) body.syscall = err.syscall;

    logActivity({
      ts: new Date().toISOString(),
      traceId,
      bot: parts[0] || "*",
      command: parts[1] || parts[0] || "unknown",
      params,
      ok: false,
      summary: errMsg,
      durationMs: Date.now() - t0,
    });

    json(body, 500);
  }
});

server.timeout = 255_000;
server.listen(PORT, () => {
  console.log(`[mcbot] API server on http://localhost:${PORT}`);
  writeServerInfo({ pid: process.pid, port: PORT, startedAt: new Date().toISOString(), logFile: "/tmp/mcbot-server.log" });
});

// Catch unhandled errors so socket/stream crashes don't kill the server
process.on("uncaughtException", (err) => {
  const code = (err as any).code;
  if (code === "EPIPE" || code === "ECONNRESET" || code === "ERR_STREAM_WRITE_AFTER_END") {
    console.log(`[mcbot] Caught ${code}: ${err.message}`);
    return;
  }
  console.error("[mcbot] Uncaught exception:", err);
  process.exit(1);
});

// Graceful shutdown — disconnect bots, close server, clean PID file
function gracefulShutdown(signal: string) {
  console.log(`\n[mcbot] ${signal} received, shutting down...`);
  for (const [name, inst] of bots) {
    try { inst.bot.quit(); } catch {}
    console.log(`[mcbot] Disconnected "${name}"`);
  }
  bots.clear();
  server.close();
  removeServerInfo();
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// --- Meta commands ---

async function spawnBot(name: string, params: any): Promise<any> {
  if (bots.has(name) || connecting.has(name)) throw new Error(`bot "${name}" already exists`);

  const opts = {
    host: params.host || process.env.MC_HOST || "localhost",
    port: Number(params.port) || Number(process.env.MC_PORT) || 25565,
    username: name,
    version: params.version || "1.21.11",
    worldPath: params.worldPath || process.env.MC_WORLD_PATH || "",
  };

  // Preflight: verify MC server is reachable before attempting mineflayer connect
  await checkReachable(opts.host, opts.port);

  return new Promise((resolve, reject) => {
    connecting.add(name);
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
      pausedForKnockback = true;
      releaseMovementControls();
    };

    bot.once("spawn", () => {
      connecting.delete(name);
      const mcData = require("minecraft-data")(bot.version);
      const movements = new pathfinder.Movements(bot, mcData);
      movements.allow1by1towers = true;   // pillar up to escape holes
      movements.allowParkour = true;
      movements.canDig = true;
      movements.allowSprinting = true;
      movements.maxDropDown = 4;
      movements.scafoldingBlocks = [mcData.blocksByName.dirt?.id, mcData.blocksByName.cobblestone?.id, mcData.blocksByName.oak_planks?.id].filter(Boolean);
      bot.pathfinder.thinkTimeout = 5000;     // 5s max — if path isn't found by then, give up and try another approach
      bot.pathfinder.tickTimeout = 40;         // max compute per tick (leave 10ms headroom)
      bot.pathfinder.searchRadius = 256;       // cap search to avoid 10s hangs on unreachable goals
      bot.pathfinder.enablePathShortcut = false;
      bot.pathfinder.setMovements(movements);

      // Wrap goto to handle mineflayer-pathfinder's stopPathing closure flag.
      const _origGoto = bot.pathfinder.goto.bind(bot.pathfinder);
      bot.pathfinder.goto = async (goal: any) => {
        bot.pathfinder.setGoal(null);
        await new Promise(resolve => setTimeout(resolve, 0));
        return _origGoto(goal);
      };

      const agentDir = join(AGENTS_DIR, name);
      const buildContext = (signal: AbortSignal): ExecuteContext => ({
        bot, mcData, pathfinder, Vec3,
        GoalNear, GoalFollow: pathfinder.goals.GoalFollow, GoalBlock: pathfinder.goals.GoalBlock,
        sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
        signal,
        log: () => {},
        goto: (x: number, y: number, z: number, opts?: GotoOptions, logFn?: (...a: any[]) => void, sigOverride?: AbortSignal) =>
          runGoto({ bot, Vec3, GoalNear }, { x, y, z }, opts, { signal: sigOverride || signal, log: logFn }),
        agentDir,
      });
      const actionQueue = new ActionQueue(buildContext);
      const instance: BotInstance = {
        bot,
        mcData,
        name,
        host: opts.host,
        port: opts.port,
        version: bot.version,
        worldPath: opts.worldPath || undefined,
        chatInbox: [],
        directives: [],
        actionQueue,
      };
      bots.set(name, instance);

      bot.on("chat", (username: string, message: string) => {
        if (username === name) return; // ignore self
        if (!username || username === "" || message.startsWith("[Server]")) return; // ignore server messages
        instance.chatInbox.push({ sender: username, message, ts: new Date().toISOString() });
        if (instance.chatInbox.length > 100) instance.chatInbox.shift();

        // Detect if sender is a real player (not one of our managed bots)
        const isBot = bots.has(username);
        const mentionPattern = new RegExp(`@${name}\\b`, "i");
        const isMention = mentionPattern.test(message) || /@everyone\b/i.test(message);

        if (isMention || !isBot) {
          // Real player chat or @mention → create directive so agent responds
          const directive = {
            text: isMention
              ? `[CHAT] @${name} from <${username}>: ${message} — YOU MUST reply via chat immediately.`
              : `[CHAT] <${username}>: ${message} — Reply via bot.chat() if appropriate.`,
            ts: new Date().toISOString(),
            interrupt: isMention, // only interrupt current action for direct @mentions
          };
          instance.directives.push(directive);
          if (instance.directives.length > 50) instance.directives.shift();
          if (isMention) {
            // Interrupt current action so agent sees the directive on next state poll
            bot.pathfinder.stop();
            bot.stopDigging?.();
          }
        }
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

      try { ensureAgent(name); } catch {}
      console.log(`[mcbot] Spawned "${name}" on ${opts.host}:${opts.port} (${bot.version})`);
      resolve({ status: "spawned", name, ...posOf(bot) });
    });

    bot.once("error", (err: any) => {
      connecting.delete(name);
      const msg = err.code
        ? `${err.code}: cannot connect to ${opts.host}:${opts.port}`
        : err.message || "connection failed";
      const spawnErr: any = new Error(msg);
      spawnErr.code = err.code;
      spawnErr.address = err.address;
      spawnErr.port = err.port;
      spawnErr.syscall = err.syscall;
      reject(spawnErr);
    });

    // Catch EPIPE/socket errors so the server doesn't crash on disconnect
    bot._client?.on?.("error", (err: Error) => {
      console.log(`[mcbot] "${name}" socket error: ${(err as any).code || err.message}`);
    });

    bot.on("kicked", (reason: string) => {
      connecting.delete(name);
      console.log(`[mcbot] "${name}" kicked: ${reason}`);
      logActivity({ ts: new Date().toISOString(), traceId: newTraceId(), bot: name, command: "disconnect", params: { reason: "kicked" }, ok: false, summary: `kicked: ${reason}`, durationMs: 0 });
      bots.delete(name);
    });

    bot.on("end", (reason: string) => {
      connecting.delete(name);
      if (!bots.has(name)) return; // already cleaned up by kicked handler
      console.log(`[mcbot] "${name}" disconnected: ${reason || "unknown"}`);
      logActivity({ ts: new Date().toISOString(), traceId: newTraceId(), bot: name, command: "disconnect", params: { reason: reason || "connection lost" }, ok: false, summary: `disconnected: ${reason || "connection lost"}`, durationMs: 0 });
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
    const agentDir = join(AGENTS_DIR, name);
    const soulPath = join(agentDir, "SOUL.md");

    if (params.init === "true") {
      if (existsSync(agentDir)) throw new Error(`agent already exists: ${agentDir}`);
      ensureAgent(name);
      return { status: "created", path: agentDir };
    }

    if (params.memory) {
      if (!existsSync(agentDir)) throw new Error(`no agent for "${name}". create with --init`);
      const total = addMemory(agentDir, params.memory);
      return { status: "memory added", total };
    }

    if (!existsSync(agentDir)) return { exists: false, name };
    const result: any = { exists: true, name };
    if (existsSync(soulPath)) result.soul = readFileSync(soulPath, "utf-8");
    const memories = readAllMemories(agentDir);
    if (memories) result.memories = memories;
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

// --- Bot commands (dispatched to commands/*.ts) ---

async function handleCommand(instance: BotInstance, cmd: string, params: any): Promise<any> {
  const handler = handlers[cmd];
  if (!handler) return { error: `unknown command: ${cmd}` };
  return handler(instance, params);
}
