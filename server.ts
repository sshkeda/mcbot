import { createServer } from "node:http";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const mineflayer = require("mineflayer");
const pathfinder = require("mineflayer-pathfinder");
const { GoalNear, GoalFollow } = pathfinder.goals;
const Vec3 = require("vec3").Vec3;
const sharp = require("sharp");
import { chopNearestTree } from "./skills/chop";
import { pickupItems } from "./skills/pickup";
import { mineBlocks } from "./skills/mine";
import { craftItem } from "./skills/craft";
import { placeBlock, resolveRelativePos } from "./skills/build";
import { fightMobs } from "./skills/fight";
import { farmCrops } from "./skills/farm";
import { smeltItem, getSmeltOutput } from "./skills/smelt";
import { withTimeout } from "./lib/utils";
import {
  findByTool,
  formatCommandError,
  getCommands,
  resolveCommand,
  validateParams,
  type CommandSpec,
} from "./lib/commands";

interface BotInstance {
  bot: any;
  mcData: any;
  name: string;
  host: string;
  port: number;
  version: string;
}

const bots = new Map<string, BotInstance>();
const PORT = Number(process.env.MCBOT_API_PORT) || 3847;

const PREFERRED_INGREDIENTS = new Set([
  "cobblestone", "oak_planks", "spruce_planks", "birch_planks",
  "jungle_planks", "acacia_planks", "dark_oak_planks", "stick",
  "iron_ingot", "gold_ingot", "diamond", "copper_ingot",
  "string", "redstone", "lapis_lazuli", "coal", "flint",
  "leather", "paper", "feather",
]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  const parts = url.pathname.slice(1).split("/").filter(Boolean);
  const params = Object.fromEntries(url.searchParams);

  const json = (data: any, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  try {
    let result: any;
    const first = parts[0];
    if (!first) throw new Error("use /<command> or /<botName>/<command>");

    const fleetCommand = parts.length === 1 ? resolveCommand("fleet", first) : undefined;
    if (fleetCommand) {
      const validationError = validateParams(fleetCommand, params);
      if (validationError) throw new Error(validationError);
      result = await runFleetCommand(fleetCommand, params);
    } else {
      const botName = first;
      const cmd = parts[1] || "status";
      const instance = bots.get(botName);
      if (!instance) throw new Error(`no bot named "${botName}". spawned: [${[...bots.keys()].join(", ")}]`);
      const botCommand = resolveCommand("bot", cmd);
      if (!botCommand) throw new Error(formatCommandError("bot", cmd));
      const validationError = validateParams(botCommand, params);
      if (validationError) throw new Error(validationError);
      result = await runBotCommand(instance, botCommand, params);
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
    if (bots.has(name)) return reject(new Error(`bot "${name}" already exists`));

    const opts = {
      host: params.host || "localhost",
      port: Number(params.port) || 25565,
      username: name,
      version: params.version || "1.21.4",
    };

    const bot = mineflayer.createBot(opts);
    bot.loadPlugin(pathfinder.pathfinder);

    bot.once("spawn", () => {
      const mcData = require("minecraft-data")(bot.version);
      bot.pathfinder.setMovements(new pathfinder.Movements(bot, mcData));
      const instance: BotInstance = { bot, mcData, name, host: opts.host, port: opts.port, version: bot.version };
      bots.set(name, instance);
      console.log(`[mcbot] Spawned "${name}" on ${opts.host}:${opts.port} (${bot.version})`);
      resolve({ status: "spawned", name, ...posOf(bot) });
    });

    bot.once("error", (err: Error) => reject(err));

    bot.on("kicked", (reason: string) => {
      console.log(`[mcbot] "${name}" kicked: ${reason}`);
      bots.delete(name);
    });

    bot.on("death", () => console.log(`[mcbot] "${name}" died`));
  });
}

function listBots() {
  const entries = [...bots.entries()].map(([name, inst]) => ({
    name,
    position: posOf(inst.bot),
    health: inst.bot.health,
  }));
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
  if (spec.name === "spawn") return spawnBot(params.name!, params);
  if (spec.name === "list") return listBots();
  if (spec.name === "kill") return killBot(params.name!);
  if (spec.name === "killall") return killAllBots();
  if (spec.name === "ping") return { status: "ok", bots: [...bots.keys()] };
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
  if (spec.name === "tools") return listToolCatalog(params.scope);
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

  if (cmd === "chop") {
    const count = Number(params.count) || 1;
    const results = [];
    for (let i = 0; i < count; i++) {
      const chopped = await chopNearestTree(bot, pathfinder, Number(params.radius) || 32);
      if (chopped.length === 0) break;
      results.push(...chopped);
    }
    return { chopped: results.length, logs: results };
  }
  if (cmd === "pickup") {
    const collected = await pickupItems(bot, pathfinder, Number(params.radius) || 40);
    return { collected: collected.length, inventory: getInventory(bot) };
  }
  if (cmd === "mine") {
    const mined = await mineBlocks(bot, pathfinder, params.block || "stone", {
      radius: Number(params.radius) || 32,
      count: Number(params.count) || 1,
    });
    return { mined: mined.length, blocks: mined, inventory: getInventory(bot) };
  }
  if (cmd === "craft") {
    const result = await craftItem(bot, pathfinder, params.item || "", Number(params.count) || 1);
    return { ...result, inventory: getInventory(bot) };
  }
  if (cmd === "smelt") {
    const result = await smeltItem(bot, pathfinder, params.item || "", Number(params.count) || 1);
    return { ...result, inventory: getInventory(bot) };
  }
  if (cmd === "place") {
    let { x, y, z } = params;
    if (params.dir) {
      const pos = resolveRelativePos(bot, params.dir);
      if (!pos) return { error: `unknown direction "${params.dir}". use: front/back/left/right/up/down` };
      x = String(pos.x); y = String(pos.y); z = String(pos.z);
    }
    if (!x || !y || !z) return { error: "need x,y,z or --dir front/back/left/right/up/down" };
    const result = await placeBlock(bot, pathfinder, params.block || "cobblestone", Number(x), Number(y), Number(z));
    return result;
  }
  if (cmd === "fight") {
    const killed = await fightMobs(bot, pathfinder, {
      radius: Number(params.radius) || 16,
      count: Number(params.count) || 10,
    });
    return { killed: killed.length, mobs: killed };
  }
  if (cmd === "farm") {
    const result = await farmCrops(bot, pathfinder, Number(params.radius) || 16);
    return result;
  }
  if (cmd === "goto") {
    const { x, y, z } = params;
    if (!x || !y || !z) return { error: "need x, y, z params" };
    try {
      await withTimeout(bot.pathfinder.goto(new GoalNear(Number(x), Number(y), Number(z), 2)), 30000);
    } catch (err: any) {
      bot.pathfinder.stop();
      return { error: `navigation failed: ${err.message}`, position: posOf(bot) };
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
    bot.chat(params.message || "");
    return { status: "sent" };
  }
  if (cmd === "attack") {
    const entities = Object.values(bot.entities) as any[];
    const hostile = entities
      .filter((e: any) => e.type === "hostile" && e.position.distanceTo(bot.entity.position) < 5)
      .sort((a: any, b: any) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
    if (!hostile) return { error: "no hostile mobs within 5 blocks" };
    await bot.attack(hostile);
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

    // Count nearby entities
    const p = bot.entity.position;
    const entities = Object.values(bot.entities) as any[];
    const nearby = entities.filter((e: any) => e !== bot.entity && e.position.distanceTo(p) < radius);
    const players = nearby.filter((e: any) => e.type === "player").map((e: any) => e.username || e.name);
    const hostiles = nearby.filter((e: any) => e.type === "hostile").length;
    const animals = nearby.filter((e: any) => e.type === "animal").length;

    return {
      position: posOf(bot),
      radius,
      blocks: { logs: logs.length, water: water.length, lava: lava.length, ores: oreCounts },
      entities: { players, hostiles, animals },
    };
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
    const radius = Number(params.radius) || 64;
    const scale = Number(params.scale) || 4;
    const p = bot.entity.position;
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    const size = radius * 2 + 1;
    const imgSize = size * scale;

    const colorFor = (name: string): [number, number, number] => {
      if (name.includes("oak_log")) return [109, 85, 50];
      if (name.includes("birch_log")) return [216, 206, 189];
      if (name.includes("spruce_log")) return [58, 37, 16];
      if (name.includes("jungle_log")) return [149, 109, 52];
      if (name.includes("log")) return [109, 85, 50];
      if (name.includes("oak_leaves")) return [59, 122, 24];
      if (name.includes("birch_leaves")) return [80, 140, 47];
      if (name.includes("spruce_leaves")) return [37, 72, 37];
      if (name.includes("leaves")) return [55, 120, 30];
      if (name === "water" || name === "flowing_water") return [44, 100, 201];
      if (name === "lava" || name === "flowing_lava") return [207, 92, 15];
      if (name === "grass_block") return [106, 170, 64];
      if (name === "dirt") return [134, 96, 67];
      if (name === "sand") return [219, 207, 163];
      if (name === "stone" || name === "cobblestone") return [125, 125, 125];
      if (name === "deepslate") return [80, 80, 85];
      if (name.includes("ore")) return [140, 130, 100];
      if (name === "gravel") return [131, 127, 126];
      if (name === "snow" || name === "snow_block") return [249, 254, 254];
      if (name.includes("plank")) return [162, 130, 78];
      if (name === "air" || name === "cave_air") return [68, 130, 180];
      return [120, 110, 100];
    };

    const pixels = Buffer.alloc(imgSize * imgSize * 3);
    const entities = Object.values(bot.entities) as any[];

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        let color: [number, number, number] = [68, 130, 180];

        for (let y = Math.min(Math.floor(p.y) + 30, 319); y >= Math.max(Math.floor(p.y) - 30, -64); y--) {
          const block = bot.blockAt(new Vec3(x, y, z));
          if (block && block.name !== "air" && block.name !== "cave_air") {
            const base = colorFor(block.name);
            const heightDiff = y - Math.floor(p.y);
            const bright = Math.max(0.6, Math.min(1.1, 1 + heightDiff * 0.015));
            color = [
              Math.min(255, Math.floor(base[0] * bright)),
              Math.min(255, Math.floor(base[1] * bright)),
              Math.min(255, Math.floor(base[2] * bright)),
            ];
            break;
          }
        }

        const entityHere = entities.find((e: any) =>
          e !== bot.entity &&
          Math.floor(e.position.x) === x &&
          Math.floor(e.position.z) === z
        );
        if (entityHere) {
          if (entityHere.type === "player") color = [255, 255, 0];
          else if (entityHere.type === "hostile") color = [255, 0, 0];
          else color = [255, 165, 0];
        }
        if (dx === 0 && dz === 0) color = [255, 0, 255];

        const px = (dx + radius) * scale;
        const pz = (dz + radius) * scale;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const offset = ((pz + sy) * imgSize + (px + sx)) * 3;
            pixels[offset] = color[0];
            pixels[offset + 1] = color[1];
            pixels[offset + 2] = color[2];
          }
        }
      }
    }

    const file = `/tmp/mcbot-${instance.name}-${Date.now()}.png`;
    await sharp(pixels, { raw: { width: imgSize, height: imgSize, channels: 3 } })
      .png()
      .toFile(file);

    return { file };
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
