/**
 * Mission-level helper functions injected into the execute context.
 *
 * All functions are closures over bot/mcData/etc. They never throw —
 * they return structured results with `{ ok: boolean, error?: string }`.
 * Every loop checks signal.aborted for cancellation support.
 */

import * as blueprintStore from "./blueprint-store";
import type { BlueprintEntry, BlueprintData } from "./blueprint-store";
import { takeSnapshot } from "./snapshot-core";

export interface MissionDeps {
  bot: any;
  mcData: any;
  Vec3: any;
  GoalNear: any;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
  log: (...args: any[]) => void;
  goto?: (...args: any[]) => Promise<any>;
  agentDir?: string;
}

export interface MissionResult {
  ok: boolean;
  error?: string;
  [key: string]: any;
}

export interface MissionHelpers {
  checkCraftability: (items: string[]) => any;
  navigateSafe: (x: number, y: number, z: number, opts?: any) => Promise<MissionResult>;
  gatherResource: (name: string, count: number, opts?: any) => Promise<MissionResult>;
  craftItem: (name: string, count: number, opts?: any) => Promise<MissionResult>;
  mineOre: (name: string, count: number, opts?: any) => Promise<MissionResult>;
  collectDrops: (radius?: number) => Promise<MissionResult>;
  equipBest: (category: string) => Promise<MissionResult>;
  ensureTool: (toolType: string, minTier?: string) => Promise<MissionResult>;
  progress: (msg: string) => void;
  checkpoint: (label: string, data?: any) => void;
  scanArea: (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => MissionResult;
  loadBlueprint: (name: string) => MissionResult;
  saveBlueprint: (name: string, origin: { x: number; y: number; z: number }, blocks: BlueprintEntry[]) => MissionResult;
  diffBlueprint: (nameOrData: string | { origin: any; blueprint: BlueprintEntry[] }) => MissionResult;
  buildFromBlueprint: (name: string, opts?: { maxBlocks?: number; skipWrong?: boolean; gatherMissing?: boolean }) => Promise<MissionResult>;
  snapshot: (nameOrBounds: string | { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; blueprint?: string; maxLayers?: number }) => MissionResult;
}

const TOOL_TIERS = ["netherite", "diamond", "iron", "golden", "stone", "wooden"] as const;

export function buildMissionHelpers(deps: MissionDeps): MissionHelpers {
  const { bot, mcData, Vec3, GoalNear, sleep, signal, log, goto, agentDir } = deps;

  // ── Reporting ────────────────────────────────────────────────

  function progress(msg: string): void {
    log("[PROGRESS] " + msg);
  }

  function checkpoint(label: string, data?: any): void {
    log("[CHECKPOINT] " + label + (data !== undefined ? " " + JSON.stringify(data) : ""));
  }

  // ── Inventory helpers ────────────────────────────────────────

  function invCount(name: string): number {
    return bot.inventory.items()
      .filter((i: any) => i.name === name)
      .reduce((sum: number, i: any) => sum + i.count, 0);
  }

  function invCountLike(substr: string): number {
    return bot.inventory.items()
      .filter((i: any) => i.name.includes(substr))
      .reduce((sum: number, i: any) => sum + i.count, 0);
  }

  // ── checkCraftability ────────────────────────────────────────

  function checkCraftability(items: string[]): any {
    const invCounts: Record<string, number> = {};
    for (const item of bot.inventory.items()) {
      invCounts[item.name] = (invCounts[item.name] || 0) + item.count;
    }

    const tableBlock = bot.findBlock({
      matching: mcData.blocksByName.crafting_table?.id,
      maxDistance: 32,
    });

    const results: Record<string, any> = {};
    const allMissing: string[] = [];

    for (const itemName of items) {
      if (signal.aborted) break;

      const item = mcData.itemsByName[itemName];
      if (!item) {
        results[itemName] = { ok: false, error: "unknown item" };
        continue;
      }

      // Try without table, then with table
      let recipes = bot.recipesFor(item.id, null, 1, null);
      let needsTable = false;
      if (recipes.length === 0 && tableBlock) {
        recipes = bot.recipesFor(item.id, null, 1, tableBlock);
        if (recipes.length > 0) needsTable = true;
      }

      if (recipes.length === 0) {
        // No recipe available — check if one exists but we lack ingredients
        const allRecipes = mcData.recipes?.[item.id];
        if (allRecipes && allRecipes.length > 0) {
          const r = allRecipes[0];
          const ingredients: Record<string, number> = {};
          const inputs = r.inShape ? r.inShape.flat() : r.ingredients || [];
          for (const ing of inputs) {
            if (!ing) continue;
            const id = typeof ing === "object" ? ing.id : ing;
            if (id < 0) continue;
            const name = mcData.items[id]?.name || `id:${id}`;
            ingredients[name] = (ingredients[name] || 0) + 1;
          }
          const missing: Record<string, number> = {};
          for (const [name, needed] of Object.entries(ingredients)) {
            const have = invCounts[name] || 0;
            if (have < (needed as number)) {
              missing[name] = (needed as number) - have;
              if (!allMissing.includes(name)) allMissing.push(name);
            }
          }
          const is3x3 = r.inShape && (r.inShape.length > 2 || (r.inShape[0]?.length || 0) > 2);
          results[itemName] = { ok: false, needsTable: !!is3x3, ingredients, have: invCounts, missing, reason: "missing ingredients" };
        } else {
          results[itemName] = { ok: false, reason: "no recipe" };
        }
        continue;
      }

      // We can craft it
      const recipe = recipes[0];
      const ingredients: Record<string, number> = {};
      for (const row of recipe.delta) {
        if (row.count < 0) {
          const name = mcData.items[row.id]?.name || `id:${row.id}`;
          ingredients[name] = (ingredients[name] || 0) + Math.abs(row.count);
        }
      }
      results[itemName] = { ok: true, needsTable, ingredients };
    }

    return {
      results,
      allCraftable: Object.values(results).every((r: any) => r.ok),
      missingItems: allMissing,
    };
  }

  // ── equipBest ────────────────────────────────────────────────

  async function equipBest(category: string): Promise<MissionResult> {
    try {
      const items = bot.inventory.items().filter((i: any) => i.name.includes(category));
      if (items.length === 0) return { ok: false, error: `no ${category} in inventory` };

      items.sort((a: any, b: any) => {
        const ai = TOOL_TIERS.findIndex(t => a.name.includes(t));
        const bi = TOOL_TIERS.findIndex(t => b.name.includes(t));
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });

      await bot.equip(items[0], "hand");
      return { ok: true, item: items[0].name };
    } catch (e: any) {
      return { ok: false, error: `equip failed: ${e.message}` };
    }
  }

  // ── collectDrops ─────────────────────────────────────────────

  async function collectDrops(radius?: number): Promise<MissionResult> {
    const r = radius ?? 16;
    let collected = 0;

    try {
      for (let round = 0; round < 2; round++) {
        if (signal.aborted) break;

        const drops = Object.values(bot.entities)
          .filter((e: any) => e.name === "item" && e.position.distanceTo(bot.entity.position) < r)
          .sort((a: any, b: any) =>
            a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
          .slice(0, 10) as any[];

        if (drops.length === 0) break;

        for (const drop of drops) {
          if (signal.aborted) break;
          if (!drop.isValid) continue;
          try {
            await bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 0));
            await sleep(150);
            if (!drop.isValid) collected++;
          } catch {
            try { bot.pathfinder.stop(); } catch {}
          }
        }
      }
    } catch {
      // swallow — best effort
    }

    return { ok: true, collected };
  }

  // ── navigateSafe ─────────────────────────────────────────────

  async function navigateSafe(x: number, y: number, z: number, opts?: any): Promise<MissionResult> {
    const range = opts?.range ?? 2;
    const maxRetries = opts?.maxRetries ?? 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal.aborted) return { ok: false, error: "aborted" };

      try {
        if (goto) {
          const result = await goto(x, y, z, { range, ...opts });
          if (result.arrived || result.status === "arrived") {
            return { ok: true, position: posObj() };
          }
        } else {
          await bot.pathfinder.goto(new GoalNear(x, y, z, range));
          const dist = bot.entity.position.distanceTo(new Vec3(x, y, z));
          if (dist <= range + 1) return { ok: true, position: posObj() };
        }
      } catch (e: any) {
        try { bot.pathfinder.stop(); } catch {}
        log(`navigateSafe attempt ${attempt + 1} failed: ${e.message}`);
      }

      if (attempt >= maxRetries) break;

      // Recovery: dig toward target + sprint-jump
      try {
        progress(`Navigation stuck, recovery #${attempt + 1}`);
        const p = bot.entity.position;
        // Face toward the target, not wherever the bot is currently looking
        const yaw = Math.atan2(-(x - p.x), -(z - p.z));
        await bot.look(yaw, 0);
        const frontX = Math.floor(p.x - Math.sin(yaw));
        const frontZ = Math.floor(p.z - Math.cos(yaw));
        for (let dy = 0; dy <= 1; dy++) {
          const block = bot.blockAt(new Vec3(frontX, Math.floor(p.y) + dy, frontZ));
          if (block && block.diggable && block.name !== "air") {
            try { await bot.dig(block); } catch {}
          }
        }
        bot.setControlState("forward", true);
        bot.setControlState("jump", true);
        bot.setControlState("sprint", true);
        await sleep(1500);
        bot.setControlState("forward", false);
        bot.setControlState("jump", false);
        bot.setControlState("sprint", false);
      } catch {
        // swallow recovery errors
      }
    }

    return { ok: false, error: `could not reach ${x},${y},${z} after ${maxRetries} retries`, position: posObj() };
  }

  // ── gatherResource ───────────────────────────────────────────

  async function gatherResource(name: string, count: number, opts?: any): Promise<MissionResult> {
    const radius = opts?.radius ?? 64;
    const doCollect = opts?.collectDrops !== false;
    const maxExpansions = opts?.maxSearchExpansions ?? 2;

    // Resolve matching block IDs
    const matchIds = Object.values(mcData.blocksByName)
      .filter((b: any) => b.name.includes(name))
      .map((b: any) => b.id);
    if (matchIds.length === 0) return { ok: false, gathered: 0, error: `no block type matching "${name}"` };

    // Auto-equip best tool for the block type
    if (opts?.equipBestTool !== false) {
      if (name.includes("ore") || name.includes("stone") || name.includes("cobble") || name.includes("deepslate")) {
        await equipBest("pickaxe");
      } else if (name.includes("log") || name.includes("wood")) {
        await equipBest("axe");
      } else if (name.includes("dirt") || name.includes("sand") || name.includes("gravel") || name.includes("clay")) {
        await equipBest("shovel");
      }
    }

    let gathered = 0;
    let expansions = 0;
    let searchRadius = Math.min(radius, 64);
    let consecutiveMisses = 0;

    while (gathered < count && !signal.aborted) {
      const target = bot.findBlock({ matching: matchIds, maxDistance: searchRadius });
      if (!target) {
        if (expansions < maxExpansions) {
          expansions++;
          progress(`No ${name} in ${searchRadius}b, expanding search #${expansions}`);
          // Walk in a random direction to find new chunks
          const angle = Math.random() * Math.PI * 2;
          const dx = Math.cos(angle) * 32;
          const dz = Math.sin(angle) * 32;
          const p = bot.entity.position;
          await navigateSafe(p.x + dx, p.y, p.z + dz, { range: 5 });
          continue;
        }
        return { ok: gathered > 0, gathered, error: `no more ${name} within reach` };
      }

      const nav = await navigateSafe(target.position.x, target.position.y, target.position.z, { range: 4 });
      if (!nav.ok) {
        consecutiveMisses++;
        if (consecutiveMisses >= 3) {
          progress(`Can't reach ${name} blocks, trying elsewhere`);
          const p = bot.entity.position;
          const angle = Math.random() * Math.PI * 2;
          await navigateSafe(p.x + Math.cos(angle) * 16, p.y, p.z + Math.sin(angle) * 16, { range: 5 });
          consecutiveMisses = 0;
        }
        continue;
      }

      consecutiveMisses = 0;

      // Re-check the block at target position (it may have changed since findBlock)
      const block = bot.blockAt(target.position);
      if (!block || !matchIds.includes(block.type)) continue;

      if (bot.canDigBlock(block)) {
        try {
          await bot.dig(block);
          gathered++;
          if (gathered % 5 === 0 || gathered === count) {
            progress(`Gathered ${gathered}/${count} ${name}`);
          }
        } catch (e: any) {
          log(`dig failed: ${e.message}`);
          continue;
        }

        // Collect drops periodically
        if (doCollect && gathered % 3 === 0) {
          await collectDrops(8);
        }
      }
    }

    if (doCollect) await collectDrops(12);
    return { ok: gathered >= count, gathered };
  }

  // ── craftItem ────────────────────────────────────────────────

  async function craftItem(name: string, count: number, opts?: any): Promise<MissionResult> {
    const item = mcData.itemsByName[name];
    if (!item) return { ok: false, crafted: 0, error: `unknown item "${name}"` };

    let crafted = 0;

    for (let batch = 0; batch < count; batch++) {
      if (signal.aborted) break;

      // Try without crafting table first
      let recipes = bot.recipesFor(item.id, null, 1, null);
      let table: any = null;

      if (recipes.length === 0) {
        // Find or place crafting table
        table = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 32 });

        if (!table) {
          // Try to place one from inventory
          const tableItem = bot.inventory.items().find((i: any) => i.name === "crafting_table");
          if (!tableItem) {
            // Try to craft a crafting table from planks
            const planks = bot.inventory.items().find((i: any) => i.name.includes("planks"));
            if (planks && planks.count >= 4) {
              const tableItemId = mcData.itemsByName.crafting_table?.id;
              const tableRecipes = bot.recipesFor(tableItemId, null, 1, null);
              if (tableRecipes.length > 0) {
                try {
                  await bot.craft(tableRecipes[0], 1, null);
                  log("Crafted crafting_table from planks");
                } catch (e: any) {
                  return { ok: false, crafted, error: `can't craft table: ${e.message}` };
                }
              }
            } else {
              return { ok: false, crafted, error: "no crafting table and can't craft one (need 4 planks)" };
            }

            // Now place it
            const newTableItem = bot.inventory.items().find((i: any) => i.name === "crafting_table");
            if (!newTableItem) return { ok: false, crafted, error: "crafting table vanished after crafting" };
          }

          // Place the table
          const tItem = bot.inventory.items().find((i: any) => i.name === "crafting_table");
          if (tItem) {
            const offsets = [
              [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
              [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
            ];
            for (const [dx, , dz] of offsets) {
              if (signal.aborted) break;
              const floorPos = bot.entity.position.offset(dx, -1, dz).floored();
              const abovePos = floorPos.offset(0, 1, 0);
              const floor = bot.blockAt(floorPos);
              const above = bot.blockAt(abovePos);
              if (floor && floor.boundingBox === "block" && above && above.name === "air") {
                try {
                  await bot.equip(tItem, "hand");
                  await bot.placeBlock(floor, new Vec3(0, 1, 0));
                } catch {
                  continue;
                }
                table = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 8 });
                if (table) break;
              }
            }
          }
        }

        if (!table) return { ok: false, crafted, error: "could not find/place crafting table" };

        // Navigate to table
        const nav = await navigateSafe(table.position.x, table.position.y, table.position.z, { range: 3 });
        if (!nav.ok) return { ok: false, crafted, error: `can't reach crafting table: ${nav.error}` };

        recipes = bot.recipesFor(item.id, null, 1, table);
      }

      if (recipes.length === 0) return { ok: false, crafted, error: "missing ingredients" };

      try {
        await bot.craft(recipes[0], 1, table);
        crafted++;
      } catch (e: any) {
        return { ok: false, crafted, error: `craft failed: ${e.message}` };
      }
    }

    if (crafted > 0) progress(`Crafted ${name} x${crafted}`);
    return { ok: crafted >= count, crafted };
  }

  // ── mineOre ──────────────────────────────────────────────────

  async function mineOre(name: string, count: number, opts?: any): Promise<MissionResult> {
    await equipBest("pickaxe");
    const result = await gatherResource(name, count, { ...opts, equipBestTool: false });
    return { ok: result.ok, mined: result.gathered, error: result.error };
  }

  // ── ensureTool ───────────────────────────────────────────────

  async function ensureTool(toolType: string, minTier?: string): Promise<MissionResult> {
    const tier = minTier ?? "wooden";
    const tierIdx = TOOL_TIERS.indexOf(tier as any);

    // Check if we already have a suitable tool
    const tools = bot.inventory.items().filter((i: any) => i.name.includes(toolType));
    if (tools.length > 0) {
      // Sort by tier (best first)
      tools.sort((a: any, b: any) => {
        const ai = TOOL_TIERS.findIndex(t => a.name.includes(t));
        const bi = TOOL_TIERS.findIndex(t => b.name.includes(t));
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      const bestIdx = TOOL_TIERS.findIndex(t => tools[0].name.includes(t));
      if (bestIdx !== -1 && bestIdx <= tierIdx) {
        // We have a tool at or above the required tier
        try { await bot.equip(tools[0], "hand"); } catch {}
        return { ok: true, tool: tools[0].name, crafted: false };
      }
    }

    // Need to craft — determine the material chain
    // wooden: 2 planks + 2 sticks (+ 1 plank for axe/pickaxe top row differs)
    // stone: 3 cobblestone + 2 sticks
    // iron: 3 iron_ingot + 2 sticks

    // First ensure we have sticks (2 minimum)
    if (invCount("stick") < 2) {
      // Need planks for sticks
      if (invCountLike("planks") < 2) {
        // Need logs for planks
        if (invCountLike("log") < 1) {
          progress(`Need logs to craft ${tier}_${toolType}`);
          const logResult = await gatherResource("log", 3);
          if (!logResult.ok && logResult.gathered === 0) {
            return { ok: false, error: `can't gather logs for ${tier}_${toolType}` };
          }
        }
        // Craft logs → planks
        const logItem = bot.inventory.items().find((i: any) => i.name.includes("log"));
        if (logItem) {
          const plankName = logItem.name.replace("_log", "_planks");
          const pItem = mcData.itemsByName[plankName] || mcData.itemsByName.oak_planks;
          if (pItem) {
            const r = bot.recipesFor(pItem.id, null, 1, null);
            if (r.length > 0) {
              try { await bot.craft(r[0], 2, null); } catch {}
            }
          }
        }
      }
      // Craft planks → sticks
      const stickItem = mcData.itemsByName.stick;
      if (stickItem) {
        const r = bot.recipesFor(stickItem.id, null, 1, null);
        if (r.length > 0) {
          try { await bot.craft(r[0], 1, null); } catch {}
        }
      }
    }

    // Now craft the tool material if needed
    if (tier === "stone" && invCount("cobblestone") < 3) {
      progress("Mining cobblestone for stone tool");
      await gatherResource("stone", 3, { radius: 16 });
    } else if (tier === "iron" && invCount("iron_ingot") < 3) {
      return { ok: false, error: "need 3 iron_ingot for iron tool (smelting not automated)" };
    }

    // Determine the exact item name
    const toolName = `${tier}_${toolType}`;
    const toolItem = mcData.itemsByName[toolName];
    if (!toolItem) return { ok: false, error: `unknown tool "${toolName}"` };

    // Craft it (needs crafting table for 3x3)
    const craftResult = await craftItem(toolName, 1);
    if (!craftResult.ok) return { ok: false, error: `craft ${toolName} failed: ${craftResult.error}` };

    // Equip it
    const newTool = bot.inventory.items().find((i: any) => i.name === toolName);
    if (newTool) {
      try { await bot.equip(newTool, "hand"); } catch {}
    }

    return { ok: true, tool: toolName, crafted: true };
  }

  // ── Utility ──────────────────────────────────────────────────

  function posObj(): { x: number; y: number; z: number } {
    const p = bot.entity.position;
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10 };
  }

  // ── scanArea ─────────────────────────────────────────────────
  // Reports unloaded chunks as `unknown` so remote scans don't misreport as all-air.

  function scanArea(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): MissionResult {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
    const vol = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    if (vol > 10_000) return { ok: false, error: `volume too large: ${vol} blocks (max 10000)` };

    const blocks: { x: number; y: number; z: number; name: string }[] = [];
    const counts: Record<string, number> = {};
    let air = 0;
    let unknown = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const block = bot.blockAt(new Vec3(x, y, z));
          // `blockAt` returns null in unloaded chunks; treat as unknown, not air.
          if (!block) { unknown++; continue; }
          if (block.name === "air" || block.name === "cave_air") { air++; continue; }
          blocks.push({ x, y, z, name: block.name });
          counts[block.name] = (counts[block.name] || 0) + 1;
        }
      }
    }
    return {
      ok: true,
      from: { x: minX, y: minY, z: minZ },
      to: { x: maxX, y: maxY, z: maxZ },
      volume: vol,
      filled: blocks.length,
      air,
      unknown,
      complete: unknown === 0,
      counts, blocks,
    };
  }

  // ── loadBlueprint ──────────────────────────────────────────

  function loadBlueprintHelper(name: string): MissionResult {
    if (!agentDir) return { ok: false, error: "no agent directory configured" };
    const data = blueprintStore.loadBlueprint(agentDir,name);
    if (!data) return { ok: false, error: `blueprint "${name}" not found` };
    return { ok: true, ...data };
  }

  // ── saveBlueprint ──────────────────────────────────────────

  function saveBlueprintHelper(
    name: string,
    origin: { x: number; y: number; z: number },
    blocks: BlueprintEntry[],
  ): MissionResult {
    if (!agentDir) return { ok: false, error: "no agent directory configured" };
    if (!blocks || !Array.isArray(blocks) || blocks.length === 0)
      return { ok: false, error: "blocks array is empty" };
    const data: BlueprintData = {
      name, origin, blocks,
      createdAt: new Date().toISOString(),
      source: "manual",
    };
    try {
      blueprintStore.saveBlueprint(agentDir, data);
      return { ok: true, name, blockCount: blocks.length };
    } catch (e: any) {
      return { ok: false, error: `save failed: ${e.message}` };
    }
  }

  // ── diffBlueprint ──────────────────────────────────────────

  function diffBlueprintHelper(nameOrData: string | { origin: any; blueprint: BlueprintEntry[] }): MissionResult {
    let origin: { x: number; y: number; z: number };
    let blocks: BlueprintEntry[];

    if (typeof nameOrData === "string") {
      if (!agentDir) return { ok: false, error: "no agent directory configured" };
      const data = blueprintStore.loadBlueprint(agentDir,nameOrData);
      if (!data) return { ok: false, error: `blueprint "${nameOrData}" not found` };
      origin = data.origin;
      blocks = data.blocks;
    } else {
      origin = nameOrData.origin;
      blocks = nameOrData.blueprint;
    }

    if (!origin || !blocks) return { ok: false, error: "invalid blueprint data" };

    const result = blueprintStore.diffBlueprintBlocks(bot, Vec3, origin, blocks, 50);
    return { ok: true, ...result };
  }

  // ── buildFromBlueprint ─────────────────────────────────────

  async function buildFromBlueprintHelper(
    name: string,
    opts?: { maxBlocks?: number; skipWrong?: boolean; gatherMissing?: boolean },
  ): Promise<MissionResult> {
    if (!agentDir) return { ok: false, error: "no agent directory configured" };
    const bpData = blueprintStore.loadBlueprint(agentDir,name);
    if (!bpData) return { ok: false, error: `blueprint "${name}" not found` };

    const maxBlocks = opts?.maxBlocks ?? Infinity;
    const gatherMissing = opts?.gatherMissing ?? false;

    let placedCount = 0;
    let skipped = 0;
    let failed = 0;
    const iterLimit = maxBlocks === Infinity ? 5000 : maxBlocks * 3;

    for (let iteration = 0; iteration < iterLimit; iteration++) {
      if (signal.aborted) break;
      if (placedCount >= maxBlocks) break;

      // Re-diff to get fresh candidates
      const diff = blueprintStore.diffBlueprintBlocks(bot, Vec3, bpData.origin, bpData.blocks, 50);
      if (diff.missing === 0) {
        progress(`Build complete: ${diff.progress}`);
        return {
          ok: true, placed: placedCount, skipped, failed,
          missing: 0, wrong: diff.wrong, progress: diff.progress,
        };
      }

      const candidates = diff.next;
      if (!candidates || candidates.length === 0) {
        return {
          ok: placedCount > 0, placed: placedCount, skipped, failed,
          missing: diff.missing, wrong: diff.wrong, progress: diff.progress,
          error: placedCount > 0 ? undefined : "no placeable candidates (all missing blocks lack support below)",
        };
      }

      const target = candidates[0]!;

      // Check inventory for the needed block
      let haveItem = bot.inventory.items().find((i: any) => i.name === target.expected);
      if (!haveItem) {
        if (gatherMissing) {
          progress(`Need ${target.expected}, gathering...`);
          const gatherResult = await gatherResource(target.expected, Math.min(16, diff.missing), { radius: 64 });
          if (!gatherResult.ok && gatherResult.gathered === 0) {
            skipped++;
            continue;
          }
          haveItem = bot.inventory.items().find((i: any) => i.name === target.expected);
          if (!haveItem) { skipped++; continue; }
        } else {
          skipped++;
          continue;
        }
      }

      // Navigate
      const nav = await navigateSafe(target.x, target.y, target.z, { range: 4 });
      if (!nav.ok) {
        log(`buildFromBlueprint: can't reach ${target.x},${target.y},${target.z}: ${nav.error}`);
        failed++;
        continue;
      }

      // Place the block
      try {
        const item = bot.inventory.items().find((i: any) => i.name === target.expected);
        if (!item) { skipped++; continue; }
        await bot.equip(item, "hand");

        const targetPos = new Vec3(target.x, target.y, target.z);
        const offsets = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
        let didPlace = false;
        for (const [dx, dy, dz] of offsets) {
          const refBlock = bot.blockAt(targetPos.offset(dx, dy, dz));
          if (refBlock && refBlock.boundingBox === "block") {
            try {
              await bot.placeBlock(refBlock, new Vec3(-dx!, -dy!, -dz!));
              didPlace = true;
              break;
            } catch { continue; }
          }
        }

        if (didPlace) {
          placedCount++;
          if (placedCount % 5 === 0 || placedCount >= maxBlocks) {
            const freshDiff = blueprintStore.diffBlueprintBlocks(bot, Vec3, bpData.origin, bpData.blocks);
            progress(`Building "${name}": placed ${placedCount}, ${freshDiff.progress}`);
          }
        } else {
          failed++;
          log(`buildFromBlueprint: no reference face at ${target.x},${target.y},${target.z}`);
        }
      } catch (e: any) {
        failed++;
        log(`buildFromBlueprint: place error at ${target.x},${target.y},${target.z}: ${e.message}`);
      }
    }

    const finalDiff = blueprintStore.diffBlueprintBlocks(bot, Vec3, bpData.origin, bpData.blocks);
    return {
      ok: placedCount > 0,
      placed: placedCount, skipped, failed,
      missing: finalDiff.missing, wrong: finalDiff.wrong, progress: finalDiff.progress,
    };
  }

  // ── snapshot ──────────────────────────────────────────────────

  function snapshotHelper(
    nameOrBounds: string | { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; blueprint?: string; maxLayers?: number },
  ): MissionResult {
    let bounds: { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number } | null = null;
    let opts: { blueprint?: string; maxLayers?: number } = {};

    if (typeof nameOrBounds === "string") {
      // Treat as blueprint name
      opts.blueprint = nameOrBounds;
    } else {
      bounds = { x1: nameOrBounds.x1, y1: nameOrBounds.y1, z1: nameOrBounds.z1, x2: nameOrBounds.x2, y2: nameOrBounds.y2, z2: nameOrBounds.z2 };
      if (nameOrBounds.blueprint) opts.blueprint = nameOrBounds.blueprint;
      if (nameOrBounds.maxLayers !== undefined) opts.maxLayers = nameOrBounds.maxLayers;
    }

    return takeSnapshot(bot, Vec3, bounds, agentDir, opts);
  }

  // ── Export ───────────────────────────────────────────────────

  return {
    checkCraftability,
    navigateSafe,
    gatherResource,
    craftItem,
    mineOre,
    collectDrops,
    equipBest,
    ensureTool,
    progress,
    checkpoint,
    scanArea,
    loadBlueprint: loadBlueprintHelper,
    saveBlueprint: saveBlueprintHelper,
    diffBlueprint: diffBlueprintHelper,
    buildFromBlueprint: buildFromBlueprintHelper,
    snapshot: snapshotHelper,
  };
}
