import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ActionQueue } from "../lib/action-queue";
import { withTimeout } from "../lib/utils";
import { vanillaMeleeAttack } from "../lib/combat";
import { runGoto, type GotoOptions } from "../lib/navigation";
import { listSkills, loadSkill, saveSkill } from "../lib/skill-manager";

export { withTimeout, vanillaMeleeAttack, runGoto, listSkills, loadSkill, saveSkill };
export type { GotoOptions };

export const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
export const pathfinder = require("mineflayer-pathfinder");
export const { GoalNear, GoalFollow, GoalBlock } = pathfinder.goals;
export const Vec3 = require("vec3").Vec3;
export const sharp = require("sharp");

// ── Types ──────────────────────────────────────────────────────────

export interface ChatMessage {
  sender: string;
  message: string;
  ts: string;
}

export interface Directive {
  text: string;
  ts: string;
  interrupt?: boolean;
}

export interface BotInstance {
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

// ── Constants ──────────────────────────────────────────────────────

export const PREFERRED_INGREDIENTS = new Set([
  "cobblestone", "oak_planks", "spruce_planks", "birch_planks",
  "jungle_planks", "acacia_planks", "dark_oak_planks", "stick",
  "iron_ingot", "gold_ingot", "diamond", "copper_ingot",
  "string", "redstone", "lapis_lazuli", "coal", "flint",
  "leather", "paper", "feather",
]);

const DIRECTIONS: Record<string, [number, number, number]> = {
  front: [0, 0, -1], back: [0, 0, 1],
  left: [1, 0, 0], right: [-1, 0, 0],
  up: [0, 1, 0], down: [0, -1, 0],
};

// ── Helpers ────────────────────────────────────────────────────────

export function posOf(bot: any) {
  const p = bot.entity.position;
  return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) };
}

export function resolveRelativePos(bot: any, dir: string): { x: number; y: number; z: number } | null {
  const d = DIRECTIONS[dir];
  if (!d) return null;
  const p = bot.entity.position;
  const yaw = bot.entity.yaw;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const rx = Math.round(d[0] * cos - d[2] * sin);
  const rz = Math.round(d[0] * sin + d[2] * cos);
  return {
    x: Math.floor(p.x) + rx,
    y: Math.floor(p.y) + d[1],
    z: Math.floor(p.z) + rz,
  };
}

/** Check if the chunk at (x, z) is loaded. */
export function isChunkLoaded(bot: any, x: number, z: number): boolean {
  try {
    const col = bot.world.getColumnAt(new Vec3(x, 0, z));
    return col != null;
  } catch { return false; }
}

/** Calculate fraction of chunks loaded within a radius of the bot. */
export function chunkCoverage(bot: any, radius: number): { loaded: number; total: number; fraction: number } {
  const p = bot.entity.position;
  const cx = Math.floor(p.x);
  const cz = Math.floor(p.z);
  const seen = new Set<string>();
  let loaded = 0;
  let total = 0;
  for (let dx = -radius; dx <= radius; dx += 16) {
    for (let dz = -radius; dz <= radius; dz += 16) {
      const chunkX = (cx + dx) >> 4;
      const chunkZ = (cz + dz) >> 4;
      const key = `${chunkX},${chunkZ}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total++;
      if (isChunkLoaded(bot, chunkX * 16, chunkZ * 16)) loaded++;
    }
  }
  return { loaded, total, fraction: total > 0 ? +(loaded / total).toFixed(2) : 0 };
}

export function getStatus(bot: any, mcData: any) {
  let biome = "unknown";
  const block = bot.blockAt(bot.entity.position);
  if (block?.biome) {
    const b = block.biome;
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

export function getLook(bot: any) {
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
  const chunks = chunkCoverage(bot, 20);
  return {
    position: posOf(bot),
    lookingAt: blockAt ? blockAt.name : null,
    standingOn: bot.blockAt(p.offset(0, -1, 0))?.name || null,
    nearby,
    chunks,
  };
}

export function getInventory(bot: any) {
  return bot.inventory.items().map((i: any) => ({
    name: i.name,
    count: i.count,
    slot: i.slot,
  }));
}

export function pickBestRecipe(allRecipes: any[], mcData: any): any {
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
